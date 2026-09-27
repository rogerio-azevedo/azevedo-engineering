import { lstatSync, mkdirSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { createExclusiveVerifiedFile } from "../filesystem/safe-create.js";
import {
  EngineeringPlanRevisionSchema,
  serializeEngineeringPlanRevision,
  type EngineeringPlanRevision,
} from "./plan-revision.js";

export const PlanRevisionArtifactOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), artifact: z.string().min(1), content: z.string().min(1) }),
  z.object({ action: z.literal("unchanged"), artifact: z.string().min(1) }),
  z.object({ action: z.literal("conflict"), artifact: z.string().min(1), reason: z.string().min(1) }),
]);

export type PlanRevisionArtifactOperation = z.infer<typeof PlanRevisionArtifactOperationSchema>;

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith(`..${sep}`) && resolve(root, value) === candidate;
}

function relativeArtifact(revision: EngineeringPlanRevision): string {
  return `.azevedo/plans/${revision.planId}/revisions/${revision.id}.json`;
}

function inspectDirectoryChain(root: string, destination: string): string | null {
  let current = dirname(destination);
  const chain: string[] = [];
  while (current !== root) {
    chain.push(current);
    current = dirname(current);
  }
  for (const directory of chain.reverse()) {
    const stats = lstatOrNull(directory);
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isDirectory()) return `${relative(root, directory)} exists with an unsafe filesystem type.`;
    if (!isWithin(root, realpathSync(directory))) return `${relative(root, directory)} escapes the project root.`;
  }
  return null;
}

export function buildPlanRevisionArtifactOperation(
  projectRoot: string,
  rawRevision: EngineeringPlanRevision,
): PlanRevisionArtifactOperation {
  const revision = EngineeringPlanRevisionSchema.parse(rawRevision);
  const root = realpathSync(projectRoot);
  const artifact = relativeArtifact(revision);
  const destination = join(root, artifact);
  if (!isWithin(root, destination)) throw new Error(`Plan revision artifact escapes the project root: ${artifact}`);
  const unsafeDirectory = inspectDirectoryChain(root, destination);
  if (unsafeDirectory) return PlanRevisionArtifactOperationSchema.parse({
    action: "conflict",
    artifact,
    reason: unsafeDirectory,
  });

  const stats = lstatOrNull(destination);
  if (!stats) return PlanRevisionArtifactOperationSchema.parse({
    action: "create",
    artifact,
    content: serializeEngineeringPlanRevision(revision),
  });
  if (stats.isSymbolicLink() || !stats.isFile()) return PlanRevisionArtifactOperationSchema.parse({
    action: "conflict",
    artifact,
    reason: "The plan revision artifact exists with an unsafe filesystem type.",
  });
  const expected = Buffer.from(serializeEngineeringPlanRevision(revision), "utf8");
  return readFileSync(destination).equals(expected)
    ? PlanRevisionArtifactOperationSchema.parse({ action: "unchanged", artifact })
    : PlanRevisionArtifactOperationSchema.parse({
      action: "conflict",
      artifact,
      reason: "Different content already exists for this immutable plan revision id.",
    });
}

function ensureDirectoryChain(root: string, destination: string): void {
  let current = root;
  const relativeParent = relative(root, dirname(destination));
  for (const segment of relativeParent.split(sep)) {
    current = join(current, segment);
    const stats = lstatOrNull(current);
    if (!stats) mkdirSync(current);
    const resulting = lstatSync(current);
    if (resulting.isSymbolicLink() || !resulting.isDirectory() || !isWithin(root, realpathSync(current))) {
      throw new Error(`Unsafe plan revision directory: ${current}`);
    }
  }
}

export function applyPlanRevisionArtifactOperation(projectRoot: string, operation: PlanRevisionArtifactOperation): void {
  if (operation.action === "conflict") throw new Error("A conflicting plan revision artifact cannot be applied.");
  if (operation.action === "unchanged") return;
  const root = realpathSync(projectRoot);
  const destination = join(root, operation.artifact);
  if (!isWithin(root, destination)) throw new Error(`Plan revision artifact escapes the project root: ${operation.artifact}`);
  ensureDirectoryChain(root, destination);
  createExclusiveVerifiedFile(root, destination, operation.content);
}
