import { createHash } from "node:crypto";
import { z } from "zod";
import { ExplorationArtifactSchema, ProjectRelativePathSchema } from "../exploration/exploration-artifact.js";
import { ContextManifestSchema } from "../knowledge/knowledge-unit.js";
import { EngineeringPlanRevisionSchema, PersistedAcceptanceCriterionSchema } from "../planning/plan-revision.js";
import { EvidenceRecordSchema, SubjectRevisionSchema } from "../schemas/evidence.js";
import { FeatureSpecificationSchema } from "../specification/feature-specification.js";

const PortableReferenceSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  return !value.replaceAll("\\", "/").split("/").includes("..");
}, "References must be project-relative and contained.");

export const ExecutionUnknownSchema = z.object({
  category: z.enum(["product-decision", "technical-unknown", "external-dependency"]),
  question: z.string().min(1),
  disposition: z.enum(["block", "investigate", "observe"]),
  basis: z.string().min(1),
  affectedAcceptanceCriteria: z.array(PersistedAcceptanceCriterionSchema.shape.id),
  evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)),
  sourceReferences: z.array(PortableReferenceSchema).min(1),
}).strict();

export const ExecutionReadinessSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["ready", "blocked"]),
  reasons: z.array(z.object({
    code: z.enum([
      "artifacts-invalid",
      "acceptance-missing",
      "exploration-blocked",
      "scope-insufficient",
      "scope-quality-insufficient",
      "product-decision-open",
      "external-dependency-blocked",
      "source-revision-changed",
      "verification-unavailable",
      "dirty-human-work",
      "write-not-authorized",
      "isolation-required",
      "context-budget-insufficient",
    ]),
    message: z.string().min(1),
    blocking: z.boolean(),
  }).strict()),
  unknowns: z.array(ExecutionUnknownSchema),
  requiredVerificationTargetIds: z.array(z.string().min(1)),
}).strict().superRefine((readiness, context) => {
  const blocked = readiness.reasons.some((reason) => reason.blocking);
  if ((readiness.status === "blocked") !== blocked) context.addIssue({
    code: "custom",
    path: ["status"],
    message: "Readiness is blocked if and only if a blocking reason exists.",
  });
});

export const GitStatusEntrySchema = z.object({
  index: z.string().length(1),
  worktree: z.string().length(1),
  path: ProjectRelativePathSchema,
  originalPath: ProjectRelativePathSchema.nullable(),
  harnessOwned: z.boolean(),
}).strict();

export const ProjectCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  head: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  gitMode: z.enum(["primary-worktree", "linked-worktree", "not-git"]),
  status: z.array(GitStatusEntrySchema),
  subjectRevision: SubjectRevisionSchema,
  workspaceIdentity: z.object({
    projectRootDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    gitDirectoryDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
    gitCommonDirectoryDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  }).strict().nullable().optional(),
}).strict();

export const ExecutionPermissionSchema = z.object({
  sourceWrite: z.enum(["denied", "isolated-worktree-only"]),
  allowedPaths: z.array(ProjectRelativePathSchema),
  excludedCandidatePaths: z.array(ProjectRelativePathSchema),
  requiredEnvironmentVariables: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  allowNetwork: z.boolean(),
  allowCommit: z.literal(false),
  allowPush: z.literal(false),
  allowedActions: z.array(z.enum(["read", "write-authorized-scope", "create-tests", "run-authorized-verification", "investigate-technical-unknown", "propose-scope-expansion"])),
  deniedActions: z.array(z.enum(["invent-product-decision", "change-acceptance-criteria", "reduce-risk", "erase-human-work", "commit", "push", "write-outside-project", "read-unnecessary-secrets", "mutate-external-infrastructure"])),
}).strict();

const EvidenceReferenceSchema = z.object({
  id: z.string().regex(/^evidence-[a-f0-9]{12}$/),
  path: ProjectRelativePathSchema,
  reason: z.string().min(1),
}).strict();

export const ContextBudgetSchema = z.object({
  defaultEstimatedTokens: z.number().int().positive(),
  requestedEstimatedTokens: z.number().int().positive().nullable(),
  requiredCoreEstimatedTokens: z.number().int().nonnegative(),
  maxEstimatedTokens: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  selectionReason: z.enum(["default", "explicit", "required-core-auto-expansion"]),
  truncated: z.boolean(),
  omittedReferences: z.array(PortableReferenceSchema),
}).strict();

export const ExecutionContextSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("execution-context"),
  id: z.string().regex(/^execution-context-[a-f0-9]{12}$/),
  planId: EngineeringPlanRevisionSchema.shape.planId,
  revisionId: EngineeringPlanRevisionSchema.shape.id,
  specificationId: FeatureSpecificationSchema.shape.id,
  explorationId: ExplorationArtifactSchema.shape.id,
  intent: z.object({
    title: z.string().min(1),
    objective: z.string().min(1),
    businessRules: z.array(z.string().min(1)),
    decisions: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)),
    outOfScope: z.array(z.string().min(1)),
  }).strict(),
  acceptanceCriteria: z.array(PersistedAcceptanceCriterionSchema).min(1),
  scope: z.object({
    initialPaths: z.array(ProjectRelativePathSchema).min(1),
    entryPoints: z.array(ProjectRelativePathSchema),
    integrationSurfaces: z.array(z.object({
      capability: z.string().min(1),
      candidatePaths: z.array(ProjectRelativePathSchema).min(1),
      acceptanceCriterionIds: z.array(PersistedAcceptanceCriterionSchema.shape.id).min(1),
    }).strict()),
    contracts: z.array(ProjectRelativePathSchema),
    testPaths: z.array(ProjectRelativePathSchema),
    flows: z.array(z.object({
      from: ProjectRelativePathSchema,
      to: ProjectRelativePathSchema,
      relation: z.string().min(1),
    }).strict()),
    omittedReferences: z.array(PortableReferenceSchema),
  }).strict(),
  knownPatterns: z.array(z.object({
    path: ProjectRelativePathSchema,
    pattern: z.string().min(1),
    differences: z.array(z.string().min(1)),
  }).strict()),
  risks: ExplorationArtifactSchema.shape.risk,
  technicalUnknowns: z.array(ExecutionUnknownSchema),
  verification: EngineeringPlanRevisionSchema.shape.planSnapshot.shape.verification,
  knowledgeManifest: ContextManifestSchema,
  evidence: z.array(EvidenceReferenceSchema),
  permissions: ExecutionPermissionSchema,
  stopConditions: z.array(z.string().min(1)).min(1),
  budget: ContextBudgetSchema,
}).strict();

export const ScopeExpansionSchema = z.object({
  path: ProjectRelativePathSchema,
  reason: z.string().min(1),
  basis: z.enum(["implementation-dependency", "contract-consumer", "test-coverage", "verification-fix"]),
  evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)).min(1),
}).strict();

export const ExecutionFailureCategorySchema = z.enum([
  "implementation-error",
  "test-failure",
  "typecheck-failure",
  "build-failure",
  "environment-failure",
  "missing-dependency",
  "scope-discovery",
  "product-ambiguity",
  "external-service",
  "command-side-effect",
  "workspace-mismatch",
]);

export const ExecutionAttemptSchema = z.object({
  sequence: z.number().int().positive(),
  objective: z.string().min(1),
  outcome: z.enum(["succeeded", "failed", "blocked"]),
  failureCategory: ExecutionFailureCategorySchema.nullable(),
  diagnosis: z.string().min(1).nullable(),
  changedPaths: z.array(ProjectRelativePathSchema),
  verificationEvidenceIds: z.array(z.string().min(1)),
}).strict().superRefine((attempt, context) => {
  if (attempt.outcome !== "succeeded" && !attempt.failureCategory) context.addIssue({
    code: "custom", path: ["failureCategory"], message: "Failed and blocked attempts require a failure category.",
  });
});

export const ExecutionChangeSchema = z.object({
  path: ProjectRelativePathSchema,
  kind: z.enum(["created", "modified", "removed", "renamed"]),
  attempt: z.number().int().positive(),
  evidenceIds: z.array(z.string().min(1)),
}).strict();

export const AcceptanceCoverageSchema = z.object({
  criterionId: PersistedAcceptanceCriterionSchema.shape.id,
  state: z.enum(["implemented", "verified", "implemented-but-unverified", "blocked"]),
  changedPaths: z.array(ProjectRelativePathSchema),
  evidenceIds: z.array(z.string().min(1)),
  note: z.string().min(1),
}).strict().superRefine((coverage, context) => {
  if (coverage.state === "verified" && coverage.evidenceIds.length === 0) context.addIssue({
    code: "custom", path: ["evidenceIds"], message: "Verified acceptance requires verification evidence.",
  });
});

export const ExecutionSessionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("execution-session"),
  id: z.string().regex(/^execution-[1-9][0-9]*-[a-f0-9]{10}$/),
  snapshotSequence: z.number().int().positive(),
  parentSnapshotId: z.string().regex(/^execution-snapshot-[1-9][0-9]*-[a-f0-9]{10}$/).nullable(),
  snapshotId: z.string().regex(/^execution-snapshot-[1-9][0-9]*-[a-f0-9]{10}$/),
  revisionId: EngineeringPlanRevisionSchema.shape.id,
  planId: EngineeringPlanRevisionSchema.shape.planId,
  specificationId: FeatureSpecificationSchema.shape.id,
  explorationId: ExplorationArtifactSchema.shape.id,
  contextId: ExecutionContextSchema.shape.id,
  status: z.enum(["prepared", "in-progress", "blocked", "failed", "completed"]),
  maxAttempts: z.literal(3),
  before: ProjectCheckpointSchema,
  after: ProjectCheckpointSchema.nullable(),
  attempts: z.array(ExecutionAttemptSchema),
  changes: z.array(ExecutionChangeSchema),
  scopeExpansions: z.array(ScopeExpansionSchema),
  verificationEvidence: z.array(EvidenceRecordSchema),
  requiredVerificationTargetIds: z.array(z.string().min(1)),
  acceptanceCoverage: z.array(AcceptanceCoverageSchema),
  decisions: z.array(z.string().min(1)),
}).strict().superRefine((session, context) => {
  if (session.attempts.length > session.maxAttempts) context.addIssue({
    code: "custom", path: ["attempts"], message: "Execution exceeded its bounded recovery attempts.",
  });
  if ((session.snapshotSequence === 1) !== (session.parentSnapshotId === null)) context.addIssue({
    code: "custom", path: ["parentSnapshotId"], message: "Only the first session snapshot has no parent.",
  });
  if (session.status === "completed") {
    if (!session.after) context.addIssue({ code: "custom", path: ["after"], message: "Completed execution requires an after checkpoint." });
    if (session.acceptanceCoverage.some((item) => item.state !== "verified")) context.addIssue({
      code: "custom", path: ["acceptanceCoverage"], message: "Completed execution requires every acceptance criterion to be verified.",
    });
    if (session.attempts.length === 0 || session.attempts.at(-1)?.outcome !== "succeeded") context.addIssue({
      code: "custom", path: ["attempts"], message: "Completed execution requires a successful final implementation attempt.",
    });
    const passingTargets = new Set(session.verificationEvidence
      .filter((item) => item.status === "pass")
      .map((item) => `${item.verifierId}::${item.scope}`));
    for (const targetId of session.requiredVerificationTargetIds) if (!passingTargets.has(targetId)) context.addIssue({
      code: "custom", path: ["verificationEvidence"], message: `Completed execution lacks passing evidence for ${targetId}.`,
    });
    if (session.after) for (const [index, evidence] of session.verificationEvidence.entries()) {
      const sameRevision = evidence.subjectRevision.head === session.after.subjectRevision.head &&
        evidence.subjectRevision.worktreeDigest === session.after.subjectRevision.worktreeDigest &&
        evidence.subjectRevision.dirty === session.after.subjectRevision.dirty;
      if (!sameRevision) context.addIssue({
        code: "custom", path: ["verificationEvidence", index, "subjectRevision"], message: "Completion evidence must verify the final project revision.",
      });
    }
    const evidenceIds = new Set(session.verificationEvidence.map((item) => item.id));
    for (const [index, coverage] of session.acceptanceCoverage.entries()) for (const id of coverage.evidenceIds) {
      if (!evidenceIds.has(id)) context.addIssue({
        code: "custom", path: ["acceptanceCoverage", index, "evidenceIds"], message: `Unknown verification evidence: ${id}.`,
      });
    }
  }
});

export const ExecutionPreparationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("execution-preparation"),
  id: z.string().regex(/^preparation-[a-f0-9]{12}$/),
  mode: z.literal("prepare"),
  writeAuthorized: z.boolean(),
  mutationAuthorized: z.boolean(),
  authorizationReasons: z.array(z.enum([
    "readiness-blocked",
    "write-not-authorized",
    "isolation-required",
    "checkpoint-not-captured",
  ])),
  contextBudget: ContextBudgetSchema,
  readiness: ExecutionReadinessSchema,
  contextId: ExecutionContextSchema.shape.id.nullable(),
  sessionId: ExecutionSessionSchema.shape.id.nullable(),
}).strict();

export type ExecutionUnknown = z.infer<typeof ExecutionUnknownSchema>;
export type ExecutionReadiness = z.infer<typeof ExecutionReadinessSchema>;
export type ProjectCheckpoint = z.infer<typeof ProjectCheckpointSchema>;
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
export type ExecutionPermission = z.infer<typeof ExecutionPermissionSchema>;
export type ScopeExpansion = z.infer<typeof ScopeExpansionSchema>;
export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
export type ExecutionPreparation = z.infer<typeof ExecutionPreparationSchema>;

export function stableDigest(value: unknown, length = 12): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

export function assertNoPersistedSecrets(value: unknown): void {
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) return current.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!current || typeof current !== "object") {
      if (typeof current === "string" && (
        /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b\s*=\s*\S+/i.test(current) ||
        /\bsk-[A-Za-z0-9_-]{8,}\b/.test(current)
      )) {
        throw new Error(`Refusing to persist a secret assignment at ${path}.`);
      }
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (/^(?:token|secret|password|apiKey|api_key|credential)$/i.test(key) && child !== null) {
        throw new Error(`Refusing to persist secret field ${path}.${key}.`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "$ ".trim());
}
