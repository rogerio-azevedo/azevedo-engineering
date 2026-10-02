import { existsSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_CATALOG } from "../knowledge/catalog.js";
import { resolveContextManifest } from "../knowledge/resolve-context.js";
import { buildProjectContext } from "../project/project-context.js";
import { loadProject } from "../project/registry.js";
import { classifyTask } from "../risk/classify-task.js";
import { captureSubjectRevision } from "../verification/subject-revision.js";
import type { WorkItemPointer } from "./contracts.js";
import { WorkItemError } from "./errors.js";
import { exploreBoundRepository, type ExplorationLimits } from "./explore-repository.js";
import { loadSpecification, loadWorkItem, saveExploration, writeWorkPointer } from "./store.js";

export function exploreWorkItem(input: {
  workspace: string;
  workItemId: string;
  limits?: ExplorationLimits;
}): { outcome: "created" | "unchanged"; pointer: WorkItemPointer } {
  const loaded = loadWorkItem(input.workspace, input.workItemId);
  if (!loaded) throw new WorkItemError(`Work item was not found: ${input.workItemId}`);
  if (!loaded.pointer.specificationId) throw new WorkItemError("Specification is required before exploration.");
  const specification = loadSpecification(
    input.workspace,
    loaded.item.projectId,
    loaded.item.id,
    loaded.pointer.specificationId,
  );
  const project = loadProject(input.workspace, loaded.item.projectId);
  const context = buildProjectContext(input.workspace, loaded.item.projectId);
  const classification = classifyTask({
    taskId: loaded.item.id,
    title: specification.objective,
    description: specification.objective,
    affectedPaths: [],
  });
  const manifest = resolveContextManifest(KNOWLEDGE_CATALOG, {
    phase: "research",
    taskType: classification.type,
    riskClass: classification.risk,
    signals: classification.signals,
    technologies: [],
    capabilities: [],
    affectedPaths: [],
    contextSources: ["project-context"],
  });
  const contextUnits = manifest.selected.map((selection) => selection.id);
  const explorations = loaded.item.repositoryIds.map((repositoryId) => {
    const root = resolveRepositoryRoot(project.binding, repositoryId);
    if (!root) return { repositoryId, exploration: null };
    const sourceRevision = captureSubjectRevision(root);
    return {
      repositoryId,
      exploration: exploreBoundRepository({
        projectId: loaded.item.projectId,
        workItemId: loaded.item.id,
        repositoryId,
        root,
        specification,
        context,
        sourceRevision,
        contextUnits,
        ...(input.limits ? { limits: input.limits } : {}),
      }),
    };
  });
  let created = false;
  for (const item of explorations) {
    if (!item.exploration) continue;
    const result = saveExploration(input.workspace, item.exploration);
    if (result === "create") created = true;
  }
  const pointer: WorkItemPointer = {
    ...loaded.pointer,
    coordinatedPlanId: null,
    repositories: explorations.map((item) => {
      if (!item.exploration) {
        return {
          repositoryId: item.repositoryId,
          relevance: {
            state: "UNKNOWN" as const,
            cause: "binding-unavailable" as const,
            statement: `Repository ${item.repositoryId} has no available local binding. No path was invented.`,
          },
          explorationId: null,
          repositoryPlanId: null,
        };
      }
      return {
        repositoryId: item.repositoryId,
        relevance: item.exploration.relevance,
        explorationId: item.exploration.id,
        repositoryPlanId: null,
      };
    }),
  };
  const pointerResult = writeWorkPointer(input.workspace, pointer);
  return { outcome: created || pointerResult === "create" ? "created" : "unchanged", pointer };
}

export function resolveRepositoryRoot(
  binding: { root: string; repositories: readonly { repositoryId: string; path: string }[] } | null,
  repositoryId: string,
): string | null {
  if (!binding || !existsSync(binding.root)) return null;
  const relativePath = binding.repositories.find((repository) => repository.repositoryId === repositoryId)?.path;
  if (!relativePath) return null;
  const absolute = join(binding.root, relativePath === "." ? "" : relativePath);
  return existsSync(absolute) ? absolute : null;
}
