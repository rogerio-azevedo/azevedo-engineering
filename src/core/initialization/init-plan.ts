import { lstatSync, readFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { InspectionTargetResult, ProjectInspectResult } from "../inspection/inspect-result.js";
import { InitializationArtifactSchema, type InitializationArtifact } from "./artifacts.js";

export const InitOwnershipSchema = z.enum(["azevedo-managed", "adapter-managed"]);

export const InitOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    path: z.string().min(1),
    ownership: InitOwnershipSchema,
    content: z.string().min(1),
  }),
  z.object({
    action: z.literal("unchanged"),
    path: z.string().min(1),
    ownership: InitOwnershipSchema,
  }),
  z.object({
    action: z.literal("conflict"),
    path: z.string().min(1),
    ownership: InitOwnershipSchema,
    reason: z.string().min(1),
  }),
]);

export type InitOperation = z.infer<typeof InitOperationSchema>;

export const ProjectInitPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("project"),
  root: z.string().min(1),
  operations: z.array(InitOperationSchema),
  blocked: z.boolean(),
});

export type ProjectInitPlan = z.infer<typeof ProjectInitPlanSchema>;

export const GroupProjectInitPlanSchema = z.object({
  relativePath: z.string().min(1),
  plan: ProjectInitPlanSchema,
});

export const GroupInitPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("project-group"),
  root: z.string().min(1),
  projects: z.array(GroupProjectInitPlanSchema).min(1),
  blocked: z.boolean(),
});

export type GroupInitPlan = z.infer<typeof GroupInitPlanSchema>;

export const InitPlanSchema = z.discriminatedUnion("kind", [
  ProjectInitPlanSchema,
  GroupInitPlanSchema,
]);

export type InitPlan = z.infer<typeof InitPlanSchema>;

export class UnrecognizedInitTargetError extends Error {}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function resolveContainedInitPath(projectRoot: string, artifactPath: string): string {
  if (artifactPath.includes("\0") || isAbsolute(artifactPath)) {
    throw new Error(`Initialization artifact path must be relative: ${artifactPath}`);
  }
  const destination = resolve(projectRoot, artifactPath);
  const relativeDestination = relative(projectRoot, destination);
  if (
    relativeDestination === "" ||
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${sep}`) ||
    isAbsolute(relativeDestination)
  ) {
    throw new Error(`Initialization artifact escapes the project root: ${artifactPath}`);
  }
  return destination;
}

function parentConflictReason(projectRoot: string, artifactPath: string): string | null {
  const parent = dirname(artifactPath);
  if (parent === ".") return null;

  let current = projectRoot;
  for (const segment of parent.split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    current = resolve(current, segment);
    const stats = lstatOrNull(current);
    if (!stats) return null;
    if (stats.isSymbolicLink()) return `Parent path ${parent} contains a symlink.`;
    if (!stats.isDirectory()) return `Parent path ${parent} is not a directory.`;
  }
  return null;
}

function planArtifact(projectRoot: string, artifact: InitializationArtifact): InitOperation {
  const destination = resolveContainedInitPath(projectRoot, artifact.path);
  const parentConflict = parentConflictReason(projectRoot, artifact.path);
  if (parentConflict) {
    return {
      action: "conflict",
      path: artifact.path,
      ownership: artifact.ownership,
      reason: parentConflict,
    };
  }

  const stats = lstatOrNull(destination);
  if (!stats) {
    return {
      action: "create",
      path: artifact.path,
      ownership: artifact.ownership,
      content: artifact.content,
    };
  }
  if (stats.isSymbolicLink()) {
    return {
      action: "conflict",
      path: artifact.path,
      ownership: artifact.ownership,
      reason: "The managed target is a symlink.",
    };
  }
  if (!stats.isFile()) {
    return {
      action: "conflict",
      path: artifact.path,
      ownership: artifact.ownership,
      reason: "The managed target exists with an incompatible filesystem type.",
    };
  }

  const existing = readFileSync(destination);
  if (existing.equals(Buffer.from(artifact.content, "utf8"))) {
    return { action: "unchanged", path: artifact.path, ownership: artifact.ownership };
  }
  return {
    action: "conflict",
    path: artifact.path,
    ownership: artifact.ownership,
    reason: "Existing content differs from the Azevedo Engineering initialization artifact.",
  };
}

function buildProjectInitPlan(
  inspection: ProjectInspectResult,
  artifacts: readonly InitializationArtifact[],
): ProjectInitPlan {
  if (inspection.topology.state === "unknown") {
    throw new UnrecognizedInitTargetError(
      `Cannot initialize ${inspection.root}: there is not enough evidence of a recognizable project.`,
    );
  }

  const operations = artifacts.map((artifact) => planArtifact(inspection.root, artifact));
  return ProjectInitPlanSchema.parse({
    schemaVersion: 1,
    kind: "project",
    root: inspection.root,
    operations,
    blocked: operations.some((operation) => operation.action === "conflict"),
  });
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeArtifacts(artifacts: readonly InitializationArtifact[]): InitializationArtifact[] {
  const parsed = artifacts.map((artifact) => InitializationArtifactSchema.parse(artifact));
  const paths = new Set<string>();
  for (const artifact of parsed) {
    if (paths.has(artifact.path)) throw new Error(`Duplicate initialization artifact: ${artifact.path}`);
    paths.add(artifact.path);
  }
  return parsed.sort((left, right) => left.order - right.order || compareStrings(left.path, right.path));
}

export function buildInitPlan(
  inspection: InspectionTargetResult,
  artifacts: readonly InitializationArtifact[],
): InitPlan {
  const normalizedArtifacts = normalizeArtifacts(artifacts);
  // Validate every configured path before reading any target state.
  for (const artifact of normalizedArtifacts) resolveContainedInitPath(inspection.root, artifact.path);

  if (inspection.kind === "project") {
    return buildProjectInitPlan(inspection, normalizedArtifacts);
  }

  const projects = [...inspection.projects]
    .sort((left, right) => compareStrings(left.relativePath, right.relativePath))
    .map((project) => ({
      relativePath: project.relativePath,
      plan: buildProjectInitPlan(project.inspection, normalizedArtifacts),
    }));
  return GroupInitPlanSchema.parse({
    schemaVersion: 1,
    kind: "project-group",
    root: inspection.root,
    projects,
    blocked: projects.some((project) => project.plan.blocked),
  });
}
