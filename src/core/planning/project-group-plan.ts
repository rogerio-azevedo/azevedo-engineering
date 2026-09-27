import { createHash } from "node:crypto";
import { z } from "zod";
import { ProjectGroupInspectResultSchema, type ProjectGroupInspectResult } from "../inspection/inspect-result.js";
import { FeatureSpecificationSchema, type FeatureSpecification } from "../specification/feature-specification.js";
import { buildEngineeringPlan, EngineeringPlanSchema } from "./engineering-plan.js";

const ProjectScopePathSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  return value.replaceAll("\\", "/").split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}, "Project scope paths must be portable and group-relative.");

export const CoordinatedEngineeringPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("coordinated-engineering-plan"),
  id: z.string().regex(/^project-group-plan-[a-f0-9]{12}$/),
  planId: EngineeringPlanSchema.shape.id,
  specificationId: FeatureSpecificationSchema.shape.id,
  objective: z.string().min(1),
  scopes: z.array(z.object({
    id: z.string().regex(/^project-scope-[a-f0-9]{10}$/),
    projectPath: ProjectScopePathSchema,
    required: z.boolean(),
    plan: EngineeringPlanSchema,
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  const paths = new Set<string>();
  for (const [index, scope] of value.scopes.entries()) {
    if (paths.has(scope.projectPath)) context.addIssue({
      code: "custom", path: ["scopes", index, "projectPath"], message: "Project scope paths must be unique.",
    });
    paths.add(scope.projectPath);
    if (scope.plan.task.description !== value.objective) context.addIssue({
      code: "custom", path: ["scopes", index, "plan", "task", "description"], message: "Every project scope must preserve the shared human intent.",
    });
  }
});

export type CoordinatedEngineeringPlan = z.infer<typeof CoordinatedEngineeringPlanSchema>;

function sharedPlanId(objective: string): string {
  const slug = objective.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").filter(Boolean)
    .slice(0, 6).join("-").slice(0, 48).replace(/-+$/g, "") || "feature";
  const digest = createHash("sha256").update(JSON.stringify({ objective: objective.trim() })).digest("hex").slice(0, 8);
  return `plan-${slug}-${digest}`;
}

export function buildCoordinatedEngineeringPlan(
  rawInspection: ProjectGroupInspectResult,
  rawSpecification: FeatureSpecification,
  options: { requiredProjectPaths?: readonly string[] } = {},
): CoordinatedEngineeringPlan {
  const inspection = ProjectGroupInspectResultSchema.parse(rawInspection);
  const specification = FeatureSpecificationSchema.parse(rawSpecification);
  const requested = options.requiredProjectPaths
    ? new Set(options.requiredProjectPaths.map((path) => path.replaceAll("\\", "/")))
    : null;
  if (requested) for (const path of requested) if (!inspection.projects.some((project) => project.relativePath === path)) {
    throw new Error(`Required project scope was not discovered: ${path}`);
  }
  const scopes = inspection.projects.filter((project) => !requested || requested.has(project.relativePath))
    .map((project) => {
      const plan = buildEngineeringPlan(project.inspection, specification.objective);
      return {
        id: `project-scope-${createHash("sha256").update(JSON.stringify({
          specificationId: specification.id,
          projectPath: project.relativePath,
          planId: plan.id,
        })).digest("hex").slice(0, 10)}`,
        projectPath: project.relativePath,
        required: true,
        plan,
      };
    }).sort((left, right) => left.projectPath.localeCompare(right.projectPath));
  if (scopes.length === 0) throw new Error("A coordinated plan requires at least one selected project scope.");
  const scopePlanIds = new Set(scopes.map((scope) => scope.plan.id));
  const planId = scopePlanIds.size === 1 ? scopes[0]!.plan.id : sharedPlanId(specification.objective);
  return CoordinatedEngineeringPlanSchema.parse({
    schemaVersion: 1,
    kind: "coordinated-engineering-plan",
    id: `project-group-plan-${createHash("sha256").update(JSON.stringify({
      planId,
      specificationId: specification.id,
      scopes: scopes.map((scope) => scope.projectPath),
    })).digest("hex").slice(0, 12)}`,
    planId,
    specificationId: specification.id,
    objective: specification.objective,
    scopes,
  });
}
