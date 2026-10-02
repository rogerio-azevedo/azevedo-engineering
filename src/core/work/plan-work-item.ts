import type { RepositoryEngineeringPlan, RepositoryExploration, WorkItemPointer } from "./contracts.js";
import { CoordinatedWorkPlanSchema, RepositoryEngineeringPlanSchema } from "./contracts.js";
import { WorkItemError } from "./errors.js";
import { coordinatedPlanIdentity, repositoryPlanIdentity } from "./identity.js";
import { resolveRepositoryRoot } from "./explore-work-item.js";
import {
  loadExploration,
  loadSpecification,
  loadWorkItem,
  saveCoordinatedPlan,
  saveRepositoryPlan,
  writeWorkPointer,
} from "./store.js";
import { captureSubjectRevision } from "../verification/subject-revision.js";
import { loadProject } from "../project/registry.js";
import type { SubjectRevision } from "../schemas/evidence.js";

export type PlanWorkItemResult = {
  outcome: "created" | "unchanged" | "blocked";
  reason: "unresolved-relevance" | "needs-product-decision" | "insufficient-evidence" | "stale-exploration" | null;
  statement: string;
  pointer: WorkItemPointer;
  coordinatedPlanId: string | null;
};

export function planWorkItem(input: { workspace: string; workItemId: string }): PlanWorkItemResult {
  const loaded = loadWorkItem(input.workspace, input.workItemId);
  if (!loaded) throw new WorkItemError(`Work item was not found: ${input.workItemId}`);
  const blocked = (reason: PlanWorkItemResult["reason"], statement: string): PlanWorkItemResult => ({
    outcome: "blocked",
    reason,
    statement,
    pointer: loaded.pointer,
    coordinatedPlanId: null,
  });
  const unresolved = loaded.pointer.repositories.find((repository) => repository.relevance.state === "UNKNOWN");
  if (unresolved) {
    return blocked(
      "unresolved-relevance",
      `Repository ${unresolved.repositoryId} is UNKNOWN (${unresolvedReason(unresolved.relevance)}). No engineering plan was written.`,
    );
  }
  if (!loaded.pointer.specificationId) {
    return blocked("needs-product-decision", "A specification is required before an engineering plan. No plan was written.");
  }
  const specification = loadSpecification(
    input.workspace,
    loaded.item.projectId,
    loaded.item.id,
    loaded.pointer.specificationId,
  );
  if (specification.acceptanceCriteria.length === 0) {
    return blocked(
      "needs-product-decision",
      "The specification has no acceptance criteria. No empty engineering plan was written.",
    );
  }
  if (specification.openQuestions.length > 0) {
    return blocked(
      "needs-product-decision",
      "The specification has unresolved open questions. No engineering plan was written.",
    );
  }
  const project = loadProject(input.workspace, loaded.item.projectId);
  const explorations: RepositoryExploration[] = [];
  for (const repository of loaded.pointer.repositories) {
    if (!repository.explorationId) throw new WorkItemError(`Missing exploration for ${repository.repositoryId}.`);
    const exploration = loadExploration(
      input.workspace,
      loaded.item.projectId,
      loaded.item.id,
      repository.repositoryId,
      repository.explorationId,
    );
    if (
      exploration.specificationId !== specification.id
      || exploration.projectId !== loaded.item.projectId
      || exploration.workItemId !== loaded.item.id
      || exploration.repositoryId !== repository.repositoryId
      || exploration.id !== repository.explorationId
    ) {
      throw new WorkItemError(`Exploration ${exploration.id} is not a basis for ${repository.repositoryId}.`);
    }
    if (exploration.relevance.state === "NOT_RELEVANT" && !exploration.coverage.complete) {
      throw new WorkItemError(`Exploration ${exploration.id} concludes NOT_RELEVANT without complete coverage.`);
    }
    const root = resolveRepositoryRoot(project.binding, repository.repositoryId);
    if (!root || !sameRevision(captureSubjectRevision(root), exploration.sourceRevision)) {
      return blocked(
        "stale-exploration",
        `Exploration ${exploration.id} for ${repository.repositoryId} does not match the current checkout. No engineering plan was written.`,
      );
    }
    explorations.push(exploration);
  }
  const relevant = explorations.filter((exploration) => exploration.relevance.state === "RELEVANT");
  if (relevant.length === 0) {
    return blocked(
      "insufficient-evidence",
      "No repository is RELEVANT. No engineering plan was written.",
    );
  }
  const unsustainable = relevant.find((exploration) => sustainingEvidence(exploration).length === 0);
  if (unsustainable) {
    return blocked(
      "insufficient-evidence",
      `Repository ${unsustainable.repositoryId} is RELEVANT without sustaining evidence. No engineering plan was written.`,
    );
  }
  const repositoryPlans = relevant.map((exploration) => repositoryPlan(loaded.item.objective, specification.id, exploration));
  const coordinatedRepositories = loaded.pointer.repositories.map((repository) => {
    const exploration = explorations.find((item) => item.repositoryId === repository.repositoryId);
    const plan = repositoryPlans.find((item) => item.basis.repositoryId === repository.repositoryId);
    if (!exploration || exploration.relevance.state === "UNKNOWN") {
      throw new WorkItemError(`Repository ${repository.repositoryId} is not decided.`);
    }
    return {
      repositoryId: repository.repositoryId,
      relevance: exploration.relevance.state,
      explorationId: exploration.id,
      repositoryPlanId: plan?.id ?? null,
    };
  });
  const coordinatedBody = {
    projectId: loaded.item.projectId,
    workItemId: loaded.item.id,
    specificationId: specification.id,
    repositories: coordinatedRepositories,
  };
  const coordinated = CoordinatedWorkPlanSchema.parse({
    schemaVersion: 1,
    kind: "work-coordinated-plan",
    id: coordinatedPlanIdentity(coordinatedBody),
    ...coordinatedBody,
  });
  let created = false;
  for (const plan of repositoryPlans) {
    if (saveRepositoryPlan(input.workspace, plan, loaded.item.projectId, loaded.item.id) === "create") created = true;
  }
  if (saveCoordinatedPlan(input.workspace, coordinated) === "create") created = true;
  const pointer: WorkItemPointer = {
    ...loaded.pointer,
    coordinatedPlanId: coordinated.id,
    repositories: loaded.pointer.repositories.map((repository) => ({
      ...repository,
      repositoryPlanId: repositoryPlans.find((plan) => plan.basis.repositoryId === repository.repositoryId)?.id ?? null,
    })),
  };
  const pointerResult = writeWorkPointer(input.workspace, pointer);
  return {
    outcome: created || pointerResult === "create" ? "created" : "unchanged",
    reason: null,
    statement: "Coordinated and repository engineering plans were persisted.",
    pointer,
    coordinatedPlanId: coordinated.id,
  };
}

function sustainingEvidence(exploration: RepositoryExploration): string[] {
  return exploration.evidence
    .filter((evidence) => evidence.relation === "direct" || evidence.relation === "analogous")
    .map((evidence) => evidence.id);
}

function repositoryPlan(
  objective: string,
  specificationId: string,
  exploration: RepositoryExploration,
): RepositoryEngineeringPlan {
  const unknowns = [
    "New implementation files are not identified. Integration evidence is not an affected path.",
  ];
  if (exploration.evidence.some((evidence) => evidence.relation === "candidate")) {
    unknowns.push("A lexical candidate was found and is not a requirement.");
  }
  const body = {
    basis: {
      projectId: exploration.projectId,
      workItemId: exploration.workItemId,
      repositoryId: exploration.repositoryId,
      specificationId,
      explorationIds: [exploration.id],
    },
    affectedPaths: [] as string[],
    integrationEvidenceIds: exploration.evidence.filter((evidence) => evidence.relation === "direct").map((evidence) => evidence.id),
    analogousEvidenceIds: exploration.evidence.filter((evidence) => evidence.relation === "analogous").map((evidence) => evidence.id),
    candidateEvidenceIds: exploration.evidence.filter((evidence) => evidence.relation === "candidate").map((evidence) => evidence.id),
    unknowns,
    status: "planned" as const,
  };
  return RepositoryEngineeringPlanSchema.parse({
    schemaVersion: 1,
    kind: "repository-engineering-plan",
    id: repositoryPlanIdentity({ objective, plan: body }),
    ...body,
  });
}

function sameRevision(left: SubjectRevision, right: SubjectRevision): boolean {
  return left.head === right.head && left.worktreeDigest === right.worktreeDigest && left.dirty === right.dirty;
}

function unresolvedReason(relevance: WorkItemPointer["repositories"][number]["relevance"]): string {
  if (relevance.state !== "UNKNOWN") return relevance.state;
  if (relevance.cause === "not-explored") return "not explored";
  if (relevance.cause === "binding-unavailable") return relevance.statement;
  return `${relevance.stopReason}: ${relevance.statement}`;
}
