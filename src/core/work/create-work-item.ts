import { loadProject } from "../project/registry.js";
import { WorkItemSchema, type WorkItem, type WorkItemPointer } from "./contracts.js";
import { WorkItemError } from "./errors.js";
import { workItemIdentity } from "./identity.js";
import { loadWorkItem, saveWorkItem, writeWorkPointer } from "./store.js";

export type CreateWorkItemInput = {
  workspace: string;
  projectId: string;
  objective: string;
  repositoryIds?: readonly string[];
};

export type CreateWorkItemResult = {
  outcome: "created" | "unchanged";
  item: WorkItem;
  pointer: WorkItemPointer;
};

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createWorkItem(input: CreateWorkItemInput): CreateWorkItemResult {
  const objective = input.objective.trim();
  if (!objective) throw new WorkItemError("Work item objective must not be empty.");
  const loaded = loadProject(input.workspace, input.projectId);
  const known = loaded.definition.repositories.map((repository) => repository.repositoryId).sort();
  const requested = [...(input.repositoryIds ?? known)].sort();
  if (requested.length === 0) throw new WorkItemError("A work item needs at least one repository.");
  const id = workItemIdentity(input.projectId, objective);
  const existing = loadWorkItem(input.workspace, id);
  if (existing) {
    if (existing.item.projectId !== input.projectId || existing.item.objective !== objective) {
      throw new WorkItemError(`Work item identity conflict for ${id}.`, "conflict");
    }
    if (!sameSet(existing.item.repositoryIds, requested)) {
      throw new WorkItemError(
        `Work item ${id} already exists with a different repository set. The stored set was not changed.`,
        "conflict",
      );
    }
    return { outcome: "unchanged", item: existing.item, pointer: existing.pointer };
  }
  const unknown = requested.filter((repositoryId) => !known.includes(repositoryId));
  if (unknown.length > 0) {
    throw new WorkItemError(`Unknown repository for ${input.projectId}: ${unknown.join(", ")}.`);
  }
  const item = WorkItemSchema.parse({
    schemaVersion: 1,
    kind: "work-item",
    id,
    projectId: input.projectId,
    objective,
    repositoryIds: requested,
  });
  saveWorkItem(input.workspace, item);
  const pointer = {
    schemaVersion: 1 as const,
    projectId: input.projectId,
    workItemId: id,
    specificationId: null,
    coordinatedPlanId: null,
    repositories: requested.map((repositoryId) => ({
      repositoryId,
      relevance: { state: "UNKNOWN" as const, cause: "not-explored" as const },
      explorationId: null,
      repositoryPlanId: null,
    })),
  };
  writeWorkPointer(input.workspace, pointer);
  return { outcome: "created", item, pointer };
}
