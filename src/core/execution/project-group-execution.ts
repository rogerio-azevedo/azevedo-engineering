import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { ExplorationArtifactSchema } from "../exploration/exploration-artifact.js";
import { exploreProject } from "../exploration/explore-project.js";
import { ProjectGroupInspectResultSchema, type ProjectGroupInspectResult } from "../inspection/inspect-result.js";
import { EngineeringPlanRevisionSchema } from "../planning/plan-revision.js";
import {
  buildCoordinatedEngineeringPlan,
  CoordinatedEngineeringPlanSchema,
} from "../planning/project-group-plan.js";
import { FeatureSpecificationSchema, type FeatureSpecification } from "../specification/feature-specification.js";
import { ExecutionReadinessSchema } from "./execution-contracts.js";
import { assessExecutionReadiness } from "./prepare-execution.js";
import { captureProjectCheckpoint } from "./project-checkpoint.js";

export const CoordinatedExecutionPreparationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("coordinated-execution-preparation"),
  id: z.string().regex(/^project-group-preparation-[a-f0-9]{12}$/),
  plan: CoordinatedEngineeringPlanSchema,
  scopes: z.array(z.object({
    scopeId: z.string().regex(/^project-scope-[a-f0-9]{10}$/),
    projectPath: z.string().min(1),
    exploration: ExplorationArtifactSchema,
    revision: EngineeringPlanRevisionSchema,
    readiness: ExecutionReadinessSchema,
  }).strict()).min(1),
  readiness: z.object({
    status: z.enum(["ready", "blocked"]),
    blockedScopeIds: z.array(z.string().regex(/^project-scope-[a-f0-9]{10}$/)),
    reasons: z.array(z.object({
      scopeId: z.string().regex(/^project-scope-[a-f0-9]{10}$/),
      code: z.string().min(1),
      message: z.string().min(1),
    }).strict()),
  }).strict(),
}).strict();

export type CoordinatedExecutionPreparation = z.infer<typeof CoordinatedExecutionPreparationSchema>;

export function prepareProjectGroupExecution(
  projectGroupRoot: string,
  rawInspection: ProjectGroupInspectResult,
  rawSpecification: FeatureSpecification,
  options: { requiredProjectPaths?: readonly string[]; maxFilesInspected?: number } = {},
): CoordinatedExecutionPreparation {
  const inspection = ProjectGroupInspectResultSchema.parse(rawInspection);
  const specification = FeatureSpecificationSchema.parse(rawSpecification);
  const plan = buildCoordinatedEngineeringPlan(inspection, specification, options);
  const inspectionByPath = new Map(inspection.projects.map((project) => [project.relativePath, project.inspection]));
  const scopes = plan.scopes.map((scope) => {
    const projectInspection = inspectionByPath.get(scope.projectPath);
    if (!projectInspection) throw new Error(`Missing inspection for coordinated scope ${scope.projectPath}.`);
    const projectRoot = resolve(projectGroupRoot, scope.projectPath);
    const explored = exploreProject(projectRoot, projectInspection, scope.plan, specification, {
      ...(options.maxFilesInspected ? { maxFilesInspected: options.maxFilesInspected } : {}),
    });
    if (!explored.revision) throw new Error(`Exploration did not produce a formal revision for ${scope.projectPath}.`);
    const checkpoint = captureProjectCheckpoint(projectRoot);
    const readiness = assessExecutionReadiness({
      inspection: projectInspection,
      revision: explored.revision,
      specification,
      exploration: explored.artifact,
      checkpoint,
      writeAuthorized: false,
      requireIsolation: false,
    });
    return {
      scopeId: scope.id,
      projectPath: scope.projectPath,
      exploration: explored.artifact,
      revision: explored.revision,
      readiness,
    };
  });
  const blockedScopeIds = scopes.filter((scope) => scope.readiness.status === "blocked").map((scope) => scope.scopeId);
  const reasons = scopes.flatMap((scope) => scope.readiness.reasons.filter((reason) => reason.blocking).map((reason) => ({
    scopeId: scope.scopeId,
    code: reason.code,
    message: reason.message,
  })));
  const readiness = {
    status: blockedScopeIds.length > 0 ? "blocked" as const : "ready" as const,
    blockedScopeIds,
    reasons,
  };
  return CoordinatedExecutionPreparationSchema.parse({
    schemaVersion: 1,
    kind: "coordinated-execution-preparation",
    id: `project-group-preparation-${createHash("sha256").update(JSON.stringify({
      coordinatedPlanId: plan.id,
      scopeExplorationIds: scopes.map((scope) => [scope.scopeId, scope.exploration.id]),
      readiness,
    })).digest("hex").slice(0, 12)}`,
    plan,
    scopes,
    readiness,
  });
}
