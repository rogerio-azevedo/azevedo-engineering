import { createHash } from "node:crypto";
import { z } from "zod";
import { ProjectRelativePathSchema } from "../exploration/exploration-artifact.js";
import { ContextManifestSchema } from "../knowledge/knowledge-unit.js";
import { PersistedAcceptanceCriterionSchema } from "../planning/plan-revision.js";
import { SubjectRevisionSchema } from "../schemas/evidence.js";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const EvidenceIdSchema = z.string().regex(/^review-evidence-[a-f0-9]{12}$/);
const TrustBoundaryIdSchema = z.string().regex(/^trust-boundary-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/);
const CandidateFindingIdSchema = z.string().regex(/^finding-candidate-[a-f0-9]{12}$/);
const FindingIdSchema = z.string().regex(/^review-finding-[a-f0-9]{12}$/);

export const ReviewEvidenceQualitySchema = z.enum([
  "direct",
  "corroborated",
  "indirect",
  "insufficient",
]);

export const ReviewEvidenceSchema = z.object({
  id: EvidenceIdSchema,
  kind: z.enum(["artifact", "diff", "code", "verification", "test", "contract", "counterevidence"]),
  sourceReference: z.string().min(1),
  path: ProjectRelativePathSchema.nullable(),
  line: z.number().int().positive().nullable(),
  statement: z.string().min(1),
  digest: DigestSchema.nullable(),
}).strict();

export const ReviewChangeSchema = z.object({
  path: ProjectRelativePathSchema,
  kind: z.enum(["created", "modified", "removed", "renamed"]),
  previousPath: ProjectRelativePathSchema.nullable(),
  diffDigest: DigestSchema,
  acceptanceCriterionIds: z.array(PersistedAcceptanceCriterionSchema.shape.id),
  planStepIds: z.array(z.string().min(1)),
  executionEvidenceIds: z.array(z.string().min(1)),
  withinAuthorizedScope: z.boolean(),
}).strict();

export const ReviewChangeSetSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^change-set-[a-f0-9]{12}$/),
  source: z.enum(["execution-checkpoints", "git-range", "working-tree"]),
  baseRevision: SubjectRevisionSchema,
  targetRevision: SubjectRevisionSchema,
  exactExecutionMatch: z.boolean(),
  mismatchReasons: z.array(z.string().min(1)),
  files: z.array(ReviewChangeSchema),
  diffDigest: DigestSchema,
}).strict().superRefine((changeSet, context) => {
  if (changeSet.exactExecutionMatch === (changeSet.mismatchReasons.length > 0)) context.addIssue({
    code: "custom",
    path: ["mismatchReasons"],
    message: "Only a non-exact execution change set can declare mismatch reasons.",
  });
});

export const TrustBoundarySchema = z.object({
  id: TrustBoundaryIdSchema,
  kind: z.string().regex(/^[a-z][a-z0-9-]*$/),
  from: z.string().min(1),
  to: z.string().min(1),
  description: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
}).strict();

export const SecurityRiskDomainSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  selected: z.boolean(),
  reasons: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(EvidenceIdSchema),
  trustBoundaryIds: z.array(TrustBoundaryIdSchema),
}).strict().superRefine((domain, context) => {
  if (domain.selected && domain.evidenceIds.length === 0) context.addIssue({
    code: "custom",
    path: ["evidenceIds"],
    message: "A selected security domain requires concrete selection evidence.",
  });
});

export const ReviewContextSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("review-context"),
  id: z.string().regex(/^review-context-[a-f0-9]{12}$/),
  taskId: z.string().min(1),
  specificationId: z.string().min(1),
  planId: z.string().min(1),
  revisionId: z.string().min(1),
  explorationId: z.string().min(1),
  executionId: z.string().min(1),
  executionSnapshotId: z.string().min(1),
  acceptanceCriteria: z.array(PersistedAcceptanceCriterionSchema).min(1),
  changeSet: ReviewChangeSetSchema,
  evidence: z.array(ReviewEvidenceSchema),
  trustBoundaries: z.array(TrustBoundarySchema),
  securityDomains: z.array(SecurityRiskDomainSchema),
  requiredLenses: z.array(z.enum(["change", "acceptance", "security"])).min(2),
  knowledgeManifest: ContextManifestSchema,
}).strict().superRefine((review, context) => {
  const evidenceIds = new Set(review.evidence.map((evidence) => evidence.id));
  if (evidenceIds.size !== review.evidence.length) context.addIssue({
    code: "custom", path: ["evidence"], message: "Review evidence ids must be unique.",
  });
  const boundaryIds = new Set(review.trustBoundaries.map((boundary) => boundary.id));
  for (const [index, boundary] of review.trustBoundaries.entries()) for (const id of boundary.evidenceIds) {
    if (!evidenceIds.has(id)) context.addIssue({
      code: "custom", path: ["trustBoundaries", index, "evidenceIds"], message: `Unknown review evidence: ${id}`,
    });
  }
  for (const [index, domain] of review.securityDomains.entries()) {
    for (const id of domain.evidenceIds) if (!evidenceIds.has(id)) context.addIssue({
      code: "custom", path: ["securityDomains", index, "evidenceIds"], message: `Unknown review evidence: ${id}`,
    });
    for (const id of domain.trustBoundaryIds) if (!boundaryIds.has(id)) context.addIssue({
      code: "custom", path: ["securityDomains", index, "trustBoundaryIds"], message: `Unknown trust boundary: ${id}`,
    });
  }
  const securityRequired = review.securityDomains.some((domain) => domain.selected);
  if (securityRequired !== review.requiredLenses.includes("security")) context.addIssue({
    code: "custom", path: ["requiredLenses"], message: "Security is required if and only if an evidence-backed risk domain is selected.",
  });
});

export const ReviewPreparationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("review-preparation"),
  id: z.string().regex(/^review-preparation-[a-f0-9]{12}$/),
  status: z.enum(["ready", "blocked"]),
  reasons: z.array(z.object({
    code: z.enum([
      "artifacts-invalid",
      "change-set-missing",
      "source-drift",
      "execution-evidence-missing",
      "acceptance-missing",
    ]),
    message: z.string().min(1),
    blocking: z.boolean(),
  }).strict()),
  context: ReviewContextSchema,
}).strict().superRefine((preparation, context) => {
  const blocked = preparation.reasons.some((reason) => reason.blocking);
  if ((preparation.status === "blocked") !== blocked) context.addIssue({
    code: "custom", path: ["status"], message: "Review preparation is blocked if and only if a blocking reason exists.",
  });
});

export const FindingFailureScenarioSchema = z.object({
  preconditions: z.array(z.string().min(1)).min(1),
  action: z.string().min(1),
  observableFailure: z.string().min(1),
  affectedParty: z.string().min(1),
}).strict();

export const FindingRootCauseSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:[.:/-][a-z0-9]+)*$/),
  category: z.string().regex(/^[a-z][a-z0-9-]*$/),
  violatedInvariant: z.string().min(1),
  primaryPath: ProjectRelativePathSchema,
  trustBoundaryId: TrustBoundaryIdSchema.nullable(),
}).strict();

export const ReviewFindingCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  id: CandidateFindingIdSchema,
  status: z.literal("candidate"),
  source: z.object({
    reviewerId: z.string().min(1),
    lens: z.enum(["change", "acceptance", "security"]),
  }).strict(),
  category: z.enum(["code", "security", "architecture", "acceptance", "test", "scope"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  title: z.string().min(1),
  locations: z.array(z.object({
    path: ProjectRelativePathSchema,
    line: z.number().int().positive().nullable(),
    symbol: z.string().min(1).nullable(),
  }).strict()).min(1),
  failureScenario: FindingFailureScenarioSchema,
  impact: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  acceptanceCriterionIds: z.array(PersistedAcceptanceCriterionSchema.shape.id),
  planStepIds: z.array(z.string().min(1)),
  executionChangePaths: z.array(ProjectRelativePathSchema),
  trustBoundaryIds: z.array(TrustBoundaryIdSchema),
  evidenceQuality: ReviewEvidenceQualitySchema,
  rootCause: FindingRootCauseSchema,
  attribution: z.enum(["introduced", "exposed", "pre-existing-unrelated", "unknown"]),
  recommendedAction: z.string().min(1),
  proposedVerification: z.string().min(1),
}).strict();

export const FindingVerificationSchema = z.object({
  candidateId: CandidateFindingIdSchema,
  verifierId: z.string().min(1),
  outcome: z.enum(["confirmed", "rejected", "insufficient-evidence"]),
  attemptedRefutation: z.string().min(1),
  contraryEvidenceIds: z.array(EvidenceIdSchema),
  rationale: z.string().min(1),
  evidenceQuality: ReviewEvidenceQualitySchema,
}).strict().superRefine((verification, context) => {
  if (verification.outcome === "rejected" && verification.contraryEvidenceIds.length === 0) context.addIssue({
    code: "custom",
    path: ["contraryEvidenceIds"],
    message: "Rejected findings require explicit contrary evidence.",
  });
  if (verification.outcome === "confirmed" && verification.evidenceQuality === "insufficient") context.addIssue({
    code: "custom",
    path: ["evidenceQuality"],
    message: "A confirmed finding cannot have insufficient evidence.",
  });
});

export const AcceptanceCriterionReviewSchema = z.object({
  criterionId: PersistedAcceptanceCriterionSchema.shape.id,
  status: z.enum([
    "satisfied",
    "partially-satisfied",
    "contradicted",
    "insufficient-evidence",
    "not-applicable",
  ]),
  evidenceIds: z.array(EvidenceIdSchema),
  candidateFindingIds: z.array(CandidateFindingIdSchema),
  rationale: z.string().min(1),
}).strict().superRefine((review, context) => {
  if (["satisfied", "not-applicable"].includes(review.status) && review.evidenceIds.length === 0) context.addIssue({
    code: "custom",
    path: ["evidenceIds"],
    message: `${review.status} acceptance requires direct evidence.`,
  });
});

export const ReviewerRunSchema = z.object({
  reviewerId: z.string().min(1),
  lens: z.enum(["change", "acceptance", "security"]),
  provider: z.string().min(1),
  reviewedEvidenceIds: z.array(EvidenceIdSchema).min(1),
  completed: z.boolean(),
}).strict();

export const ReviewSubmissionSchema = z.object({
  contextId: ReviewContextSchema.shape.id,
  reviewerRuns: z.array(ReviewerRunSchema),
  acceptanceReviews: z.array(AcceptanceCriterionReviewSchema),
  candidates: z.array(ReviewFindingCandidateSchema),
  findingVerifications: z.array(FindingVerificationSchema),
  residualUnknowns: z.array(z.string().min(1)),
}).strict();

export const ConsolidatedFindingSchema = z.object({
  id: FindingIdSchema,
  rootCause: FindingRootCauseSchema,
  title: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: z.enum(["open", "accepted-risk", "deferred", "resolved"]),
  blocking: z.boolean(),
  attribution: z.enum(["introduced", "exposed", "pre-existing-unrelated", "unknown"]),
  candidateIds: z.array(CandidateFindingIdSchema).min(1),
  verificationOutcomes: z.array(FindingVerificationSchema).min(1),
  sourceReviewers: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  acceptanceCriterionIds: z.array(PersistedAcceptanceCriterionSchema.shape.id),
  planStepIds: z.array(z.string().min(1)),
  executionChangePaths: z.array(ProjectRelativePathSchema),
  trustBoundaryIds: z.array(TrustBoundaryIdSchema),
  locations: z.array(z.object({
    path: ProjectRelativePathSchema,
    line: z.number().int().positive().nullable(),
    symbol: z.string().min(1).nullable(),
  }).strict()).min(1),
  failureScenarios: z.array(FindingFailureScenarioSchema).min(1),
  impacts: z.array(z.string().min(1)).min(1),
  recommendedAction: z.string().min(1),
  proposedVerifications: z.array(z.string().min(1)).min(1),
}).strict();

export const ReviewReadinessSchema = z.object({
  status: z.enum(["PASS", "PASS_WITH_FINDINGS", "BLOCKED"]),
  reasons: z.array(z.object({
    code: z.enum([
      "preparation-blocked",
      "required-review-missing",
      "acceptance-not-satisfied",
      "finding-not-verified",
      "blocking-finding",
      "residual-unknown",
    ]),
    message: z.string().min(1),
    blocking: z.boolean(),
  }).strict()),
}).strict();

export const CorrectionPolicySchema = z.object({
  enabled: z.boolean(),
  maxAttempts: z.number().int().min(1).max(3),
  requiresExplicitWriteAuthorization: z.literal(true),
  requiresFreshReview: z.literal(true),
  stopOnRepeatedRootCause: z.literal(true),
  rationale: z.string().min(1),
}).strict();

export const CorrectionAttemptSchema = z.object({
  sequence: z.number().int().positive(),
  findingIds: z.array(FindingIdSchema).min(1),
  executionId: z.string().min(1),
  outcome: z.enum(["corrected", "failed", "blocked"]),
  evidenceIds: z.array(z.string().min(1)),
}).strict();

export const ReviewReportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("review-report"),
  id: z.string().regex(/^review-report-[1-9][0-9]*-[a-f0-9]{12}$/),
  sequence: z.number().int().positive(),
  parentReportId: z.string().regex(/^review-report-[1-9][0-9]*-[a-f0-9]{12}$/).nullable(),
  contextId: ReviewContextSchema.shape.id,
  initial: z.boolean(),
  readiness: ReviewReadinessSchema,
  acceptanceReviews: z.array(AcceptanceCriterionReviewSchema),
  candidateFindings: z.array(ReviewFindingCandidateSchema),
  findingVerifications: z.array(FindingVerificationSchema),
  findings: z.array(ConsolidatedFindingSchema),
  rejectedCandidateIds: z.array(CandidateFindingIdSchema),
  insufficientCandidateIds: z.array(CandidateFindingIdSchema),
  reviewerRuns: z.array(ReviewerRunSchema),
  residualUnknowns: z.array(z.string().min(1)),
  correctionPolicy: CorrectionPolicySchema.nullable(),
  correctionAttempts: z.array(CorrectionAttemptSchema),
}).strict().superRefine((report, context) => {
  if ((report.sequence === 1) !== (report.parentReportId === null && report.initial)) context.addIssue({
    code: "custom", path: ["parentReportId"], message: "Only the immutable first report is initial and has no parent.",
  });
  if (report.correctionPolicy && report.correctionAttempts.length > report.correctionPolicy.maxAttempts) context.addIssue({
    code: "custom", path: ["correctionAttempts"], message: "Correction attempts exceeded the explicit policy limit.",
  });
});

export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
export type ReviewChangeSet = z.infer<typeof ReviewChangeSetSchema>;
export type ReviewContext = z.infer<typeof ReviewContextSchema>;
export type ReviewPreparation = z.infer<typeof ReviewPreparationSchema>;
export type ReviewFindingCandidate = z.infer<typeof ReviewFindingCandidateSchema>;
export type FindingVerification = z.infer<typeof FindingVerificationSchema>;
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>;
export type ConsolidatedFinding = z.infer<typeof ConsolidatedFindingSchema>;
export type ReviewReadiness = z.infer<typeof ReviewReadinessSchema>;
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

function canonicalReviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalReviewValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalReviewValue(item)]),
  );
  return value;
}

export function reviewDigest(value: unknown, length = 12): string {
  return createHash("sha256").update(JSON.stringify(canonicalReviewValue(value))).digest("hex").slice(0, length);
}
