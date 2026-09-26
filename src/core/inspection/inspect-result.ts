import { z } from "zod";
import { inspectProject } from "../discovery/inspect-project.js";
import { ProjectInspectionSchema } from "../schemas/discovery.js";

export const InspectResultSchema = ProjectInspectionSchema.omit({ inspectedAt: true });

export type InspectResult = z.infer<typeof InspectResultSchema>;

/**
 * Produces the deterministic, machine-facing inspection contract.
 * ProjectInspection remains the discovery source of truth; only its volatile
 * observation timestamp is omitted from this comparable representation.
 */
export function createInspectResult(projectRoot: string): InspectResult {
  return InspectResultSchema.parse(inspectProject(projectRoot));
}
