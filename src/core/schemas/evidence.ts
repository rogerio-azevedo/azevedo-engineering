import { z } from "zod";
import { ComponentIdSchema } from "./component.js";

export const EvidenceStatusSchema = z.enum([
  "pass",
  "fail",
  "skipped",
  "waived",
  "not_applicable",
]);

export const SubjectRevisionSchema = z.object({
  head: z.string().min(1).nullable(),
  worktreeDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  dirty: z.boolean(),
});

export type SubjectRevision = z.infer<typeof SubjectRevisionSchema>;

export const CommandEffectSchema = z.enum([
  "read-only",
  "may-mutate",
  "mutating",
  "unknown",
]);

export const CommandEffectAssessmentSchema = z.object({
  declared: CommandEffectSchema,
  basis: z.array(z.string().min(1)).min(1),
  observed: z.enum(["not-run", "unchanged", "changed", "unavailable"]),
  unexpected: z.boolean(),
  affectedPaths: z.array(z.string().min(1)),
  before: SubjectRevisionSchema,
  after: SubjectRevisionSchema.nullable(),
}).strict().superRefine((assessment, context) => {
  if ((assessment.observed === "changed") !== (assessment.affectedPaths.length > 0)) {
    context.addIssue({
      code: "custom",
      path: ["affectedPaths"],
      message: "Changed command effects require affected paths, and unchanged effects cannot list them.",
    });
  }
  if (assessment.unexpected && assessment.observed !== "changed") {
    context.addIssue({
      code: "custom",
      path: ["unexpected"],
      message: "Only an observed change can be unexpected.",
    });
  }
});

export type CommandEffect = z.infer<typeof CommandEffectSchema>;
export type CommandEffectAssessment = z.infer<typeof CommandEffectAssessmentSchema>;

export const EvidenceRecordSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    verifierId: ComponentIdSchema,
    phase: z.enum(["verification", "tdd-red", "tdd-green", "review"]),
    status: EvidenceStatusSchema,
    scope: z.string().min(1),
    command: z.array(z.string()).nullable(),
    startedAt: z.iso.datetime(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    subjectRevision: SubjectRevisionSchema,
    outputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    summary: z.string().min(1),
    reason: z.string().min(1).nullable(),
    waiverId: z.string().min(1).nullable(),
    commandEffect: CommandEffectAssessmentSchema.nullable().default(null),
  })
  .superRefine((record, context) => {
    if (["skipped", "waived", "not_applicable"].includes(record.status) && !record.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: `${record.status} evidence requires a reason`,
      });
    }
    if (record.status === "waived" && !record.waiverId) {
      context.addIssue({
        code: "custom",
        path: ["waiverId"],
        message: "waived evidence requires a waiverId",
      });
    }
  });

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: z.enum(["code", "security", "architecture"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
  title: z.string().min(1),
  location: z
    .object({
      path: z.string().min(1),
      line: z.number().int().positive().nullable(),
      symbol: z.string().min(1).nullable(),
    })
    .nullable(),
  failureMode: z.string().min(1),
  impact: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  status: z.enum(["open", "resolved", "accepted", "false_positive"]),
});

export type Finding = z.infer<typeof FindingSchema>;

export const WaiverSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  targetId: z.string().min(1),
  reason: z.string().min(1),
  approvedBy: z.string().min(1),
  scope: z.string().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
});

export type Waiver = z.infer<typeof WaiverSchema>;

export const TddDecisionSchema = z
  .object({
    taskId: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["applied", "not_applicable", "waived"]),
    expectation: z.enum(["required", "recommended", "domain_verification", "not_applicable"]),
    reason: z.string().min(1),
    redEvidenceId: z.string().min(1).nullable(),
    greenEvidenceId: z.string().min(1).nullable(),
    waiverId: z.string().min(1).nullable(),
  })
  .superRefine((decision, context) => {
    if (decision.status === "waived" && !decision.waiverId) {
      context.addIssue({ code: "custom", path: ["waiverId"], message: "A waived TDD decision requires a waiverId." });
    }
    if (decision.status === "not_applicable" && decision.expectation === "required") {
      context.addIssue({ code: "custom", path: ["status"], message: "Required TDD must be applied or explicitly waived." });
    }
    if (decision.status === "applied" && (!decision.redEvidenceId || !decision.greenEvidenceId)) {
      context.addIssue({ code: "custom", path: ["redEvidenceId"], message: "Applied TDD needs RED and GREEN evidence." });
    }
  });

export type TddDecision = z.infer<typeof TddDecisionSchema>;
