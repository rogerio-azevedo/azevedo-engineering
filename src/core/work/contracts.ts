import { z } from "zod";
import { ExplorationStopReasonSchema } from "../exploration/exploration-artifact.js";
import { canonicalDigest } from "../filesystem/canonical-digest.js";
import { ProjectIdSchema, PortablePathSchema, RepositoryIdSchema } from "../project/contracts.js";
import { SubjectRevisionSchema } from "../schemas/evidence.js";

export const WorkItemIdSchema = z.string().regex(/^work-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{12}$/);
export const WorkSpecificationIdSchema = z.string().regex(/^work-spec-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/);
export const RepositoryExplorationIdSchema = z.string().regex(/^exploration-[a-f0-9]{12}$/);
export const WorkEvidenceIdSchema = z.string().regex(/^evidence-[a-f0-9]{12}$/);
export const CoordinatedWorkPlanIdSchema = z.string().regex(/^coordinated-plan-[a-f0-9]{12}$/);
export const RepositoryPlanIdSchema = z.string().regex(/^repository-plan-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/);

const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^ac-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  statement: z.string().min(1),
}).strict();

export const WorkItemSpecificationContentSchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema),
  openQuestions: z.array(z.string().min(1)),
  provenance: z.object({
    projectId: ProjectIdSchema,
    workItemId: WorkItemIdSchema,
    sources: z.array(z.object({
      kind: z.enum(["work-item", "user", "product-document", "issue", "conversation"]),
      reference: z.string().min(1).nullable(),
    }).strict()).min(1),
  }).strict(),
}).strict();

export const WorkItemSpecificationSchema = WorkItemSpecificationContentSchema.extend({
  schemaVersion: z.literal(1),
  kind: z.literal("work-item-specification"),
  id: WorkSpecificationIdSchema,
}).strict();

export const WorkItemSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("work-item"),
  id: WorkItemIdSchema,
  projectId: ProjectIdSchema,
  objective: z.string().trim().min(1),
  repositoryIds: z.array(RepositoryIdSchema).min(1),
}).strict().superRefine((item, context) => {
  const seen = new Set<string>();
  for (const [index, repositoryId] of item.repositoryIds.entries()) {
    if (seen.has(repositoryId)) context.addIssue({
      code: "custom", path: ["repositoryIds", index], message: "Work item repository ids must be unique.",
    });
    seen.add(repositoryId);
  }
  const ordered = [...item.repositoryIds].sort();
  if (item.repositoryIds.some((repositoryId, index) => repositoryId !== ordered[index])) {
    context.addIssue({ code: "custom", path: ["repositoryIds"], message: "Work item repository ids must be sorted." });
  }
});

const UnknownRelevanceSchema = z.discriminatedUnion("cause", [
  z.object({
    state: z.literal("UNKNOWN"),
    cause: z.literal("not-explored"),
  }).strict(),
  z.object({
    state: z.literal("UNKNOWN"),
    cause: z.literal("binding-unavailable"),
    statement: z.string().min(1),
  }).strict(),
  z.object({
    state: z.literal("UNKNOWN"),
    cause: z.literal("exploration"),
    stopReason: ExplorationStopReasonSchema,
    statement: z.string().min(1),
    explorationId: RepositoryExplorationIdSchema,
  }).strict(),
]);

const DecidedRelevanceSchema = z.object({
  state: z.enum(["RELEVANT", "NOT_RELEVANT"]),
  statement: z.string().min(1),
  explorationId: RepositoryExplorationIdSchema,
  evidenceIds: z.array(WorkEvidenceIdSchema).min(1),
}).strict();

export const RepositoryRelevanceSchema = z.union([UnknownRelevanceSchema, DecidedRelevanceSchema]);

export const WorkItemPointerSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  workItemId: WorkItemIdSchema,
  specificationId: WorkSpecificationIdSchema.nullable(),
  coordinatedPlanId: CoordinatedWorkPlanIdSchema.nullable(),
  repositories: z.array(z.object({
    repositoryId: RepositoryIdSchema,
    relevance: RepositoryRelevanceSchema,
    explorationId: RepositoryExplorationIdSchema.nullable(),
    repositoryPlanId: RepositoryPlanIdSchema.nullable(),
  }).strict()).min(1),
}).strict();

export const WorkEvidenceSchema = z.object({
  id: WorkEvidenceIdSchema,
  repositoryId: RepositoryIdSchema,
  path: PortablePathSchema,
  relation: z.enum(["direct", "analogous", "candidate", "examined"]),
  reason: z.string().min(1),
}).strict();

export const ExplorationCoverageSchema = z.object({
  complete: z.boolean(),
  budgetLimited: z.boolean(),
  examined: z.array(PortablePathSchema),
  unexamined: z.array(PortablePathSchema),
}).strict();

export const RepositoryExplorationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("repository-exploration"),
  id: RepositoryExplorationIdSchema,
  projectId: ProjectIdSchema,
  workItemId: WorkItemIdSchema,
  repositoryId: RepositoryIdSchema,
  specificationId: WorkSpecificationIdSchema,
  sourceRevision: SubjectRevisionSchema,
  orientation: z.object({
    factIds: z.array(z.string().regex(/^fact-[a-f0-9]{12}$/)),
    boundaries: z.object({
      authorizesMutation: z.literal(false),
      replacesExploration: z.literal(false),
      reviewTrust: z.literal("untrusted-context"),
    }).strict(),
  }).strict(),
  contextUnits: z.array(z.string().min(1)),
  coverage: ExplorationCoverageSchema,
  evidence: z.array(WorkEvidenceSchema),
  relevance: RepositoryRelevanceSchema,
  stopReason: ExplorationStopReasonSchema,
}).strict();

export const PlanBasisSchema = z.object({
  projectId: ProjectIdSchema,
  workItemId: WorkItemIdSchema,
  repositoryId: RepositoryIdSchema,
  specificationId: WorkSpecificationIdSchema,
  explorationIds: z.array(RepositoryExplorationIdSchema).min(1),
}).strict();

export const RepositoryEngineeringPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("repository-engineering-plan"),
  id: RepositoryPlanIdSchema,
  basis: PlanBasisSchema,
  affectedPaths: z.array(PortablePathSchema),
  integrationEvidenceIds: z.array(WorkEvidenceIdSchema),
  analogousEvidenceIds: z.array(WorkEvidenceIdSchema),
  candidateEvidenceIds: z.array(WorkEvidenceIdSchema),
  unknowns: z.array(z.string().min(1)),
  status: z.literal("planned"),
}).strict();

export const CoordinatedWorkPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("work-coordinated-plan"),
  id: CoordinatedWorkPlanIdSchema,
  projectId: ProjectIdSchema,
  workItemId: WorkItemIdSchema,
  specificationId: WorkSpecificationIdSchema,
  repositories: z.array(z.object({
    repositoryId: RepositoryIdSchema,
    relevance: z.enum(["RELEVANT", "NOT_RELEVANT"]),
    explorationId: RepositoryExplorationIdSchema,
    repositoryPlanId: RepositoryPlanIdSchema.nullable(),
  }).strict()).min(1),
}).strict();

export type WorkItem = z.infer<typeof WorkItemSchema>;
export type WorkItemPointer = z.infer<typeof WorkItemPointerSchema>;
export type WorkItemSpecification = z.infer<typeof WorkItemSpecificationSchema>;
export type WorkItemSpecificationContent = z.infer<typeof WorkItemSpecificationContentSchema>;
export type RepositoryExploration = z.infer<typeof RepositoryExplorationSchema>;
export type RepositoryRelevance = z.infer<typeof RepositoryRelevanceSchema>;
export type RepositoryEngineeringPlan = z.infer<typeof RepositoryEngineeringPlanSchema>;
export type CoordinatedWorkPlan = z.infer<typeof CoordinatedWorkPlanSchema>;
export type WorkEvidence = z.infer<typeof WorkEvidenceSchema>;
export type ExplorationCoverage = z.infer<typeof ExplorationCoverageSchema>;

export function evidenceId(evidence: Omit<WorkEvidence, "id">): string {
  return `evidence-${canonicalDigest(evidence, 12)}`;
}
