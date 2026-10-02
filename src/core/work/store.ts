import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { assertNoPersistedSecrets } from "../execution/execution-contracts.js";
import { writeImmutableJson } from "../project/registry.js";
import { evidenceId } from "./contracts.js";
import {
  CoordinatedWorkPlanSchema,
  RepositoryEngineeringPlanSchema,
  RepositoryExplorationSchema,
  WorkItemPointerSchema,
  WorkItemSchema,
  WorkItemSpecificationSchema,
  type CoordinatedWorkPlan,
  type RepositoryEngineeringPlan,
  type RepositoryExploration,
  type WorkItem,
  type WorkItemPointer,
  type WorkItemSpecification,
} from "./contracts.js";
import { WorkItemError } from "./errors.js";
import {
  coordinatedPlanIdentity,
  repositoryExplorationIdentity,
  repositoryPlanIdentity,
  workItemIdentity,
  workSpecificationIdentity,
} from "./identity.js";

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function assertPortableArtifact(value: unknown): void {
  const visit = (current: unknown): void => {
    if (typeof current === "string") {
      if (/^(?:\/|[A-Za-z]:[\\/])/.test(current)) {
        throw new WorkItemError("A portable work artifact contains an absolute path.");
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (current && typeof current === "object") Object.values(current).forEach(visit);
  };
  visit(value);
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith(`..${sep}`) && resolve(root, value) === candidate;
}

function assertContainedStorePath(workspaceRoot: string, absolutePath: string): void {
  const root = realpathSync(workspaceRoot);
  const lexical = relative(root, absolutePath);
  if (lexical.startsWith("..") || lexical === "..") throw new WorkItemError("Work item store path is unsafe.");
  let current = root;
  for (const segment of lexical.split(sep)) {
    if (!segment || segment === ".") continue;
    current = join(current, segment);
    if (!existsSync(current)) return;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) throw new WorkItemError("Work item store path is unsafe.");
    const real = realpathSync(current);
    if (!isWithin(root, real)) throw new WorkItemError("Work item store path is unsafe.");
    if (current !== absolutePath && !stats.isDirectory()) throw new WorkItemError("Work item store path is unsafe.");
  }
}

function readRegularJson(workspaceRoot: string, path: string): unknown {
  assertContainedStorePath(workspaceRoot, path);
  if (!existsSync(path)) throw new WorkItemError("Work item store path is missing.");
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new WorkItemError("Work item store path is unsafe.");
  return readJson(path);
}

function sameRepositorySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  if (new Set(right).size !== right.length) return false;
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return orderedLeft.every((value, index) => value === orderedRight[index]);
}

function assertWorkItemIntegrity(item: WorkItem): void {
  if (item.id !== workItemIdentity(item.projectId, item.objective)) {
    throw new WorkItemError(`Work item content does not match ${item.id}.`);
  }
}

function assertSpecificationIntegrity(specification: WorkItemSpecification, projectId: string, workItemId: string): void {
  const { schemaVersion: _schemaVersion, kind: _kind, id: _id, ...content } = specification;
  if (specification.id !== workSpecificationIdentity(content)) {
    throw new WorkItemError(`Specification content does not match ${specification.id}.`);
  }
  if (specification.provenance.projectId !== projectId || specification.provenance.workItemId !== workItemId) {
    throw new WorkItemError(`Specification identity does not match ${specification.id}.`);
  }
}

function assertExplorationIntegrity(
  exploration: RepositoryExploration,
  expected: { projectId: string; workItemId: string; repositoryId: string; explorationId: string },
): void {
  if (
    exploration.id !== expected.explorationId
    || exploration.projectId !== expected.projectId
    || exploration.workItemId !== expected.workItemId
    || exploration.repositoryId !== expected.repositoryId
  ) {
    throw new WorkItemError(`Repository exploration identity does not match ${expected.explorationId}.`);
  }
  if (exploration.id !== repositoryExplorationIdentity(exploration)) {
    throw new WorkItemError(`Repository exploration content does not match ${exploration.id}.`);
  }
  for (const item of exploration.evidence) {
    if (item.repositoryId !== exploration.repositoryId || item.id !== evidenceId({
      repositoryId: item.repositoryId,
      path: item.path,
      relation: item.relation,
      reason: item.reason,
    })) {
      throw new WorkItemError(`Exploration evidence does not match ${exploration.id}.`);
    }
  }
  if ("explorationId" in exploration.relevance && exploration.relevance.explorationId !== exploration.id) {
    throw new WorkItemError(`Repository exploration relevance does not match ${exploration.id}.`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function pointerPath(workspace: string, projectId: string, workItemId: string): string {
  return join(realpathSync(workspace), "var", "projects", projectId, "work-items", workItemId, "current.json");
}

export function loadWorkItem(workspace: string, workItemId: string): { item: WorkItem; pointer: WorkItemPointer } | null {
  const projects = join(realpathSync(workspace), "var", "projects");
  if (!existsSync(projects)) return null;
  for (const projectId of readdirSync(projects).sort()) {
    const directory = join(projects, projectId);
    if (!lstatSync(directory).isDirectory()) continue;
    const itemPath = join(directory, "work-items", workItemId, "item.json");
    if (!existsSync(itemPath)) continue;
    const item = WorkItemSchema.parse(readRegularJson(workspace, itemPath));
    assertWorkItemIntegrity(item);
    if (item.id !== workItemId || item.projectId !== projectId) {
      throw new WorkItemError(`Work item identity does not match ${workItemId}.`);
    }
    const pointer = WorkItemPointerSchema.parse(readRegularJson(workspace, pointerPath(workspace, projectId, workItemId)));
    if (pointer.workItemId !== workItemId || pointer.projectId !== projectId) {
      throw new WorkItemError(`Work item pointer does not match ${workItemId}.`);
    }
    if (!sameRepositorySet(item.repositoryIds, pointer.repositories.map((repository) => repository.repositoryId))) {
      throw new WorkItemError(`Work item pointer repositories do not match ${workItemId}.`);
    }
    return { item, pointer };
  }
  return null;
}

export function persistWorkBlob(workspace: string, relativePath: string, value: unknown): "create" | "unchanged" | "conflict" {
  assertPortableArtifact(value);
  assertNoPersistedSecrets(value);
  const result = writeImmutableJson(workspace, relativePath, value);
  if (result === "conflict") throw new WorkItemError(`Work artifact conflict: ${relativePath}`, "conflict");
  return result;
}

export function writeWorkPointer(
  workspace: string,
  pointer: WorkItemPointer,
): "create" | "unchanged" {
  const parsed = WorkItemPointerSchema.parse(pointer);
  assertPortableArtifact(parsed);
  assertNoPersistedSecrets(parsed);
  const root = realpathSync(workspace);
  const destination = pointerPath(workspace, parsed.projectId, parsed.workItemId);
  assertContainedStorePath(root, destination);
  const directory = dirname(destination);
  const directoryStats = lstatSync(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new WorkItemError("Work item store path is unsafe.");
  }
  const next = serialize(parsed);
  if (existsSync(destination)) {
    const stats = lstatSync(destination);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new WorkItemError("Work item pointer is unsafe.");
    if (readFileSync(destination, "utf8") === next) return "unchanged";
  }
  const temp = join(directory, `.current.${process.pid}.tmp`);
  writeFileSync(temp, next, { flag: "wx" });
  try {
    renameSync(temp, destination);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  if (lstatSync(destination).isSymbolicLink() || readFileSync(destination, "utf8") !== next) {
    throw new WorkItemError("Work item pointer did not persist.");
  }
  return "create";
}

export function saveWorkItem(workspace: string, item: WorkItem): "create" | "unchanged" {
  const parsed = WorkItemSchema.parse(item);
  return persistWorkBlob(workspace, `var/projects/${parsed.projectId}/work-items/${parsed.id}/item.json`, parsed) === "unchanged"
    ? "unchanged" : "create";
}

export function saveSpecification(workspace: string, specification: WorkItemSpecification): "create" | "unchanged" {
  const parsed = WorkItemSpecificationSchema.parse(specification);
  const relativePath = `var/projects/${parsed.provenance.projectId}/work-items/${parsed.provenance.workItemId}/specifications/${parsed.id}.json`;
  return persistWorkBlob(workspace, relativePath, parsed) === "unchanged" ? "unchanged" : "create";
}

export function loadSpecification(workspace: string, projectId: string, workItemId: string, specificationId: string): WorkItemSpecification {
  const path = join(realpathSync(workspace), "var", "projects", projectId, "work-items", workItemId, "specifications", `${specificationId}.json`);
  const specification = WorkItemSpecificationSchema.parse(readRegularJson(workspace, path));
  assertSpecificationIntegrity(specification, projectId, workItemId);
  if (specification.id !== specificationId) throw new WorkItemError(`Specification identity does not match ${specificationId}.`);
  return specification;
}

export function saveExploration(workspace: string, exploration: RepositoryExploration): "create" | "unchanged" {
  const parsed = RepositoryExplorationSchema.parse(exploration);
  const relativePath = `var/projects/${parsed.projectId}/work-items/${parsed.workItemId}/explorations/${parsed.repositoryId}/${parsed.id}.json`;
  return persistWorkBlob(workspace, relativePath, parsed) === "unchanged" ? "unchanged" : "create";
}

export function loadExploration(
  workspace: string,
  projectId: string,
  workItemId: string,
  repositoryId: string,
  explorationId: string,
): RepositoryExploration {
  const path = join(
    realpathSync(workspace), "var", "projects", projectId, "work-items", workItemId,
    "explorations", repositoryId, `${explorationId}.json`,
  );
  if (!existsSync(path)) throw new WorkItemError(`Repository exploration is missing: ${explorationId}`);
  const exploration = RepositoryExplorationSchema.parse(readRegularJson(workspace, path));
  assertExplorationIntegrity(exploration, { projectId, workItemId, repositoryId, explorationId });
  return exploration;
}

export function saveRepositoryPlan(workspace: string, plan: RepositoryEngineeringPlan, projectId: string, workItemId: string): "create" | "unchanged" {
  const parsed = RepositoryEngineeringPlanSchema.parse(plan);
  const relativePath = `var/projects/${projectId}/work-items/${workItemId}/repositories/${parsed.basis.repositoryId}/plans/${parsed.id}.json`;
  return persistWorkBlob(workspace, relativePath, parsed) === "unchanged" ? "unchanged" : "create";
}

export function saveCoordinatedPlan(workspace: string, plan: CoordinatedWorkPlan): "create" | "unchanged" {
  const parsed = CoordinatedWorkPlanSchema.parse(plan);
  const relativePath = `var/projects/${parsed.projectId}/work-items/${parsed.workItemId}/coordinated/${parsed.id}.json`;
  return persistWorkBlob(workspace, relativePath, parsed) === "unchanged" ? "unchanged" : "create";
}

export function loadRepositoryPlan(
  workspace: string,
  projectId: string,
  workItemId: string,
  repositoryId: string,
  planId: string,
  objective: string,
): RepositoryEngineeringPlan {
  const path = join(
    realpathSync(workspace), "var", "projects", projectId, "work-items", workItemId,
    "repositories", repositoryId, "plans", `${planId}.json`,
  );
  const plan = RepositoryEngineeringPlanSchema.parse(readRegularJson(workspace, path));
  const { schemaVersion: _schemaVersion, kind: _kind, id: _id, ...body } = plan;
  if (
    plan.id !== planId
    || plan.basis.projectId !== projectId
    || plan.basis.workItemId !== workItemId
    || plan.basis.repositoryId !== repositoryId
    || plan.id !== repositoryPlanIdentity({ objective, plan: body })
  ) {
    throw new WorkItemError(`Repository plan content does not match ${planId}.`);
  }
  return plan;
}

export function loadCoordinatedPlan(
  workspace: string,
  projectId: string,
  workItemId: string,
  planId: string,
): CoordinatedWorkPlan {
  const path = join(
    realpathSync(workspace), "var", "projects", projectId, "work-items", workItemId, "coordinated", `${planId}.json`,
  );
  const plan = CoordinatedWorkPlanSchema.parse(readRegularJson(workspace, path));
  const { schemaVersion: _schemaVersion, kind: _kind, id: _id, ...body } = plan;
  if (
    plan.id !== planId
    || plan.projectId !== projectId
    || plan.workItemId !== workItemId
    || plan.id !== coordinatedPlanIdentity(body)
  ) {
    throw new WorkItemError(`Coordinated plan content does not match ${planId}.`);
  }
  return plan;
}
