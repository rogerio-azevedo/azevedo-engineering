import { lstatSync, mkdirSync, realpathSync, type Stats } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { createExclusiveVerifiedFile } from "../filesystem/safe-create.js";
import type { InitOperation, InitPlan, ProjectInitPlan } from "./init-plan.js";
import { resolveContainedInitPath } from "./init-plan.js";

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function projectPlans(plan: InitPlan): ProjectInitPlan[] {
  return plan.kind === "project" ? [plan] : plan.projects.map((project) => project.plan);
}

function assertRealDirectoryWithinRoot(projectRoot: string, directory: string): void {
  const rootRealPath = realpathSync(projectRoot);
  const directoryRealPath = realpathSync(directory);
  const relativeDirectory = relative(rootRealPath, directoryRealPath);
  if (
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${sep}`) ||
    resolve(rootRealPath, relativeDirectory) !== directoryRealPath
  ) {
    throw new Error(`Initialization parent escapes the project root: ${directory}`);
  }
}

function validateParentChain(projectRoot: string, operation: InitOperation): void {
  const normalizedProjectRoot = resolve(projectRoot);
  const destination = resolveContainedInitPath(normalizedProjectRoot, operation.path);
  let current = dirname(destination);
  const pending: string[] = [];

  while (current !== normalizedProjectRoot) {
    pending.push(current);
    current = dirname(current);
  }

  for (const directory of pending.reverse()) {
    const stats = lstatOrNull(directory);
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Initialization parent is not a safe directory: ${directory}`);
    }
    assertRealDirectoryWithinRoot(normalizedProjectRoot, directory);
  }
}

function preflightProjectPlan(plan: ProjectInitPlan): void {
  const rootStats = lstatSync(plan.root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Initialization root is not a safe directory: ${plan.root}`);
  }
  for (const operation of plan.operations) {
    resolveContainedInitPath(plan.root, operation.path);
    if (operation.action !== "create") continue;
    validateParentChain(plan.root, operation);
    if (lstatOrNull(resolveContainedInitPath(plan.root, operation.path))) {
      throw new Error(`Initialization target changed after planning: ${operation.path}`);
    }
  }
}

function ensureParentDirectories(projectRoot: string, operation: Extract<InitOperation, { action: "create" }>): void {
  const destination = resolveContainedInitPath(projectRoot, operation.path);
  const parent = dirname(destination);
  if (parent === projectRoot) return;

  const relativeParent = relative(projectRoot, parent);
  let current = projectRoot;
  for (const segment of relativeParent.split(sep)) {
    current = resolve(current, segment);
    const stats = lstatOrNull(current);
    if (!stats) {
      mkdirSync(current);
      continue;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Initialization parent is not a safe directory: ${current}`);
    }
    assertRealDirectoryWithinRoot(projectRoot, current);
  }
}

function applyProjectPlan(plan: ProjectInitPlan): void {
  for (const operation of plan.operations) {
    if (operation.action !== "create") continue;
    ensureParentDirectories(plan.root, operation);
    const destination = resolveContainedInitPath(plan.root, operation.path);
    createExclusiveVerifiedFile(plan.root, destination, operation.content);
  }
}

export function applyInitPlan(plan: InitPlan): void {
  if (plan.blocked) throw new Error("A blocked initialization plan cannot be applied.");
  const projects = projectPlans(plan);

  // Global preflight provides logical atomicity for groups before the first write.
  for (const project of projects) preflightProjectPlan(project);
  for (const project of projects) applyProjectPlan(project);
}
