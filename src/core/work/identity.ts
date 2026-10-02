import { canonicalDigest } from "../filesystem/canonical-digest.js";
import type { SubjectRevision } from "../schemas/evidence.js";
import type {
  CoordinatedWorkPlan,
  ExplorationCoverage,
  RepositoryEngineeringPlan,
  RepositoryExploration,
  RepositoryRelevance,
  WorkEvidence,
} from "./contracts.js";

export function workSlug(value: string): string {
  const slug = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").filter(Boolean)
    .slice(0, 6).join("-").slice(0, 48).replace(/-+$/g, "");
  return slug || "work";
}

export function workItemIdentity(projectId: string, objective: string): string {
  return `work-${workSlug(objective)}-${canonicalDigest({ objective: objective.trim(), projectId }, 12)}`;
}

export function workSpecificationIdentity(content: unknown): string {
  const title = typeof content === "object" && content !== null && "title" in content && typeof content.title === "string"
    ? content.title : "specification";
  return `work-spec-${workSlug(title)}-${canonicalDigest(content, 8)}`;
}

export function repositoryExplorationIdentity(input: {
  projectId: string;
  workItemId: string;
  repositoryId: string;
  specificationId: string;
  sourceRevision: SubjectRevision;
  orientation: RepositoryExploration["orientation"];
  contextUnits: readonly string[];
  coverage: ExplorationCoverage;
  evidence: readonly WorkEvidence[];
  stopReason: RepositoryExploration["stopReason"];
  relevance: RepositoryRelevance;
}): string {
  return `exploration-${canonicalDigest({
    projectId: input.projectId,
    workItemId: input.workItemId,
    repositoryId: input.repositoryId,
    specificationId: input.specificationId,
    sourceRevision: input.sourceRevision,
    orientation: input.orientation,
    contextUnits: input.contextUnits,
    coverage: input.coverage,
    evidence: input.evidence,
    stopReason: input.stopReason,
    relevance: relevanceMaterial(input.relevance),
  }, 12)}`;
}

export function repositoryPlanIdentity(input: {
  objective: string;
  plan: Omit<RepositoryEngineeringPlan, "schemaVersion" | "kind" | "id">;
}): string {
  return `repository-plan-${workSlug(input.objective)}-${canonicalDigest(input.plan, 8)}`;
}

export function coordinatedPlanIdentity(input: Omit<CoordinatedWorkPlan, "schemaVersion" | "kind" | "id">): string {
  return `coordinated-plan-${canonicalDigest(input, 12)}`;
}

function relevanceMaterial(relevance: RepositoryRelevance): unknown {
  if (!("explorationId" in relevance)) return relevance;
  const { explorationId: _explorationId, ...rest } = relevance;
  return rest;
}
