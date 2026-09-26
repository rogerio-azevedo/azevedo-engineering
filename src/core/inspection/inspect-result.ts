import { readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { inspectProject } from "../discovery/inspect-project.js";
import { ProjectInspectionSchema } from "../schemas/discovery.js";

const GROUP_IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

const StableProjectInspectionSchema = ProjectInspectionSchema.omit({ inspectedAt: true });

export const ProjectInspectResultSchema = StableProjectInspectionSchema.extend({
  kind: z.literal("project"),
});

export type ProjectInspectResult = z.infer<typeof ProjectInspectResultSchema>;

export const ProjectGroupEntrySchema = z.object({
  relativePath: z.string().min(1),
  inspection: ProjectInspectResultSchema,
});

export const ProjectGroupInspectResultSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("project-group"),
  root: z.string().min(1),
  projects: z.array(ProjectGroupEntrySchema).min(1),
});

export type ProjectGroupInspectResult = z.infer<typeof ProjectGroupInspectResultSchema>;

export const InspectionTargetResultSchema = z.discriminatedUnion("kind", [
  ProjectInspectResultSchema,
  ProjectGroupInspectResultSchema,
]);

export type InspectionTargetResult = z.infer<typeof InspectionTargetResultSchema>;

// Backwards-compatible name for the unpublished v0.2 API.
export const InspectResultSchema = InspectionTargetResultSchema;
export type InspectResult = InspectionTargetResult;

function createProjectInspectResult(projectRoot: string): ProjectInspectResult {
  const inspection = StableProjectInspectionSchema.parse(inspectProject(projectRoot));
  return ProjectInspectResultSchema.parse({ ...inspection, kind: "project" });
}

function isRecognizableProject(result: ProjectInspectResult): boolean {
  return result.topology.state !== "unknown";
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Inspects one target without mutating it. A recognized root remains a project.
 * Only an unrecognized root triggers a shallow scan of immediate child
 * directories for independently recognizable projects.
 */
export function createInspectResult(projectRoot: string): InspectionTargetResult {
  const rootInspection = createProjectInspectResult(projectRoot);
  if (isRecognizableProject(rootInspection)) return rootInspection;

  const projects = readdirSync(rootInspection.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !GROUP_IGNORED_DIRECTORIES.has(entry.name))
    .sort((left, right) => compareNames(left.name, right.name))
    .flatMap((entry) => {
      const inspection = createProjectInspectResult(join(rootInspection.root, entry.name));
      return isRecognizableProject(inspection)
        ? [{ relativePath: entry.name, inspection }]
        : [];
    });

  if (projects.length === 0) return rootInspection;

  return ProjectGroupInspectResultSchema.parse({
    schemaVersion: 1,
    kind: "project-group",
    root: rootInspection.root,
    projects,
  });
}
