import { createHash } from "node:crypto";
import type { ProjectInspectResult } from "../inspection/inspect-result.js";
import type { ExecutionSession } from "../execution/execution-contracts.js";
import { ExecutionSessionSchema } from "../execution/execution-contracts.js";
import type { ExplorationArtifact } from "../exploration/exploration-artifact.js";
import { ExplorationArtifactSchema } from "../exploration/exploration-artifact.js";
import { KNOWLEDGE_CATALOG } from "../knowledge/catalog.js";
import { resolveContextManifest } from "../knowledge/resolve-context.js";
import type { EngineeringPlanRevision } from "../planning/plan-revision.js";
import { EngineeringPlanRevisionSchema } from "../planning/plan-revision.js";
import type { FeatureSpecification } from "../specification/feature-specification.js";
import { FeatureSpecificationSchema } from "../specification/feature-specification.js";
import { identifyTrustBoundaries, selectSecurityDomains } from "./risk-selection.js";
import {
  ReviewContextSchema,
  ReviewPreparationSchema,
  reviewDigest,
  type ReviewChangeSet,
  type ReviewEvidence,
  type ReviewPreparation,
} from "./review-contracts.js";

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function evidenceId(source: unknown): string {
  return `review-evidence-${reviewDigest(source)}`;
}

export type PrepareReviewInput = {
  inspection: ProjectInspectResult;
  specification: FeatureSpecification;
  revision: EngineeringPlanRevision;
  exploration: ExplorationArtifact;
  execution: ExecutionSession;
  changeSet: ReviewChangeSet;
};

export function prepareReview(rawInput: PrepareReviewInput): ReviewPreparation {
  const specification = FeatureSpecificationSchema.parse(rawInput.specification);
  const revision = EngineeringPlanRevisionSchema.parse(rawInput.revision);
  const exploration = ExplorationArtifactSchema.parse(rawInput.exploration);
  const execution = ExecutionSessionSchema.parse(rawInput.execution);
  const reasons: ReviewPreparation["reasons"] = [];

  if (
    revision.planId !== exploration.planId ||
    exploration.specificationId !== specification.id ||
    execution.planId !== revision.planId ||
    execution.revisionId !== revision.id ||
    execution.specificationId !== specification.id ||
    execution.explorationId !== exploration.id
  ) reasons.push({
    code: "artifacts-invalid",
    message: "Specification, plan revision, exploration, and execution do not form one provenance chain.",
    blocking: true,
  });
  if (revision.acceptanceCriteria.length === 0) reasons.push({
    code: "acceptance-missing",
    message: "Review requires persisted acceptance criteria from the authoritative specification.",
    blocking: true,
  });
  if (rawInput.changeSet.files.length === 0) reasons.push({
    code: "change-set-missing",
    message: "Review requires a concrete changed-file set and diff digest.",
    blocking: true,
  });
  if (!rawInput.changeSet.exactExecutionMatch) reasons.push({
    code: "source-drift",
    message: `The review subject is not provably identical to the execution snapshot: ${rawInput.changeSet.mismatchReasons.join(" ")}`,
    blocking: true,
  });
  if (execution.verificationEvidence.length === 0) reasons.push({
    code: "execution-evidence-missing",
    message: "The execution session has no command or behavioral verification evidence.",
    blocking: true,
  });

  const evidenceBySourceId = new Map<string, ReviewEvidence>();
  const evidence: ReviewEvidence[] = exploration.evidence.map((item) => {
    const reviewEvidence = {
      id: evidenceId({ explorationId: exploration.id, evidenceId: item.id }),
      kind: item.kind === "test" ? "test" as const : item.kind === "contract" ? "contract" as const : "code" as const,
      sourceReference: `.azevedo/explorations/${exploration.id}.json#${item.id}`,
      path: item.path,
      line: item.location?.startLine ?? null,
      statement: `${item.reason} ${item.taskRelation}`,
      digest: digest(item),
    };
    evidenceBySourceId.set(item.id, reviewEvidence);
    return reviewEvidence;
  });
  for (const item of rawInput.changeSet.files) evidence.push({
    id: evidenceId({ changeSetId: rawInput.changeSet.id, path: item.path }),
    kind: "diff",
    sourceReference: `${rawInput.changeSet.id}#${item.path}`,
    path: item.path,
    line: null,
    statement: `${item.kind} file in the captured review change set.`,
    digest: item.diffDigest,
  });
  for (const item of execution.verificationEvidence) evidence.push({
    id: evidenceId({ executionId: execution.id, verificationEvidenceId: item.id }),
    kind: item.verifierId === "verify.test" ? "test" : "verification",
    sourceReference: `${execution.snapshotId}#${item.id}`,
    path: null,
    line: null,
    statement: `${item.verifierId}::${item.scope} ${item.status}: ${item.summary}`,
    digest: item.outputDigest,
  });
  evidence.push({
    id: evidenceId({ specificationId: specification.id }),
    kind: "artifact",
    sourceReference: `.azevedo/specifications/${specification.id}.json`,
    path: null,
    line: null,
    statement: "Authoritative feature specification and acceptance criteria.",
    digest: digest(specification),
  }, {
    id: evidenceId({ revisionId: revision.id }),
    kind: "artifact",
    sourceReference: `${revision.planId}/revisions/${revision.id}.json`,
    path: null,
    line: null,
    statement: "Immutable engineering plan revision used by execution.",
    digest: digest(revision),
  }, {
    id: evidenceId({ executionSnapshotId: execution.snapshotId }),
    kind: "artifact",
    sourceReference: `${execution.id}/sessions/${execution.snapshotId}.json`,
    path: null,
    line: null,
    statement: "Append-only terminal execution snapshot.",
    digest: digest(execution),
  });

  const trustBoundaries = identifyTrustBoundaries(exploration, evidenceBySourceId);
  const securityDomains = selectSecurityDomains(exploration, evidenceBySourceId, trustBoundaries);
  const knowledgeManifest = resolveContextManifest(KNOWLEDGE_CATALOG, {
    phase: "review",
    taskType: revision.planSnapshot.task.type,
    riskClass: revision.planSnapshot.risk.class,
    signals: revision.planSnapshot.risk.signals,
    technologies: rawInput.inspection.technologies.map((technology) => technology.id),
    capabilities: exploration.integrationSurfaces.map((surface) => surface.capability),
    affectedPaths: rawInput.changeSet.files.map((file) => file.path),
  });
  const contextSeed = {
    schemaVersion: 1 as const,
    kind: "review-context" as const,
    taskId: revision.planId,
    specificationId: specification.id,
    planId: revision.planId,
    revisionId: revision.id,
    explorationId: exploration.id,
    executionId: execution.id,
    executionSnapshotId: execution.snapshotId,
    acceptanceCriteria: revision.acceptanceCriteria,
    changeSet: rawInput.changeSet,
    evidence: evidence.sort((left, right) => left.id.localeCompare(right.id)),
    trustBoundaries,
    securityDomains,
    requiredLenses: [
      "change" as const,
      "acceptance" as const,
      ...(securityDomains.length > 0 ? ["security" as const] : []),
    ],
    knowledgeManifest,
  };
  const context = ReviewContextSchema.parse({
    ...contextSeed,
    id: `review-context-${reviewDigest(contextSeed)}`,
  });
  const seed = {
    schemaVersion: 1 as const,
    kind: "review-preparation" as const,
    status: reasons.some((reason) => reason.blocking) ? "blocked" as const : "ready" as const,
    reasons,
    context,
  };
  return ReviewPreparationSchema.parse({
    ...seed,
    id: `review-preparation-${reviewDigest(seed)}`,
  });
}
