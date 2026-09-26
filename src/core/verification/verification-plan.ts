import { posix } from "node:path";
import { z } from "zod";
import type { ProjectInspection } from "../schemas/discovery.js";
import type { TaskClassification } from "../schemas/task.js";
import { ComponentIdSchema } from "../schemas/component.js";

export const VerificationTargetSchema = z.object({
  verifierId: ComponentIdSchema,
  scope: z.string().min(1),
});

export type VerificationTarget = z.infer<typeof VerificationTargetSchema>;

export const VerificationPlanItemSchema = VerificationTargetSchema.extend({
  targetId: z.string().min(1),
  required: z.boolean(),
  available: z.boolean(),
  packagePath: z.string().nullable(),
  script: z.string().nullable(),
  riskReduced: z.string().min(1),
  evidenceProduced: z.string().min(1),
  reason: z.string().min(1),
});

export type VerificationPlanItem = z.infer<typeof VerificationPlanItemSchema>;

const CAPABILITY_RISK: Record<"lint" | "typecheck" | "test" | "build", string> = {
  lint: "Static defects and repository policy drift.",
  typecheck: "Type contract regressions across changed boundaries.",
  test: "Behavioral regressions and unmet acceptance criteria.",
  build: "Integration, bundling, and production compilation failures.",
};

function normalizeProjectPath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/$/, "");
  return normalized === "" ? "." : normalized;
}

function containsPath(scope: string, path: string): boolean {
  return scope === "." || path === scope || path.startsWith(`${scope}/`);
}

function resolveAffectedScopes(
  inspection: ProjectInspection,
  affectedPaths: readonly string[],
  targetScopes: readonly string[],
): string[] {
  const packages = inspection.packages
    .map(normalizeProjectPath)
    .filter((path) => path !== ".")
    .sort((left, right) => right.length - left.length);

  if (affectedPaths.length === 0 && targetScopes.length === 0) {
    return inspection.topology.value === "monorepo" && packages.length > 0 ? [...packages].sort() : ["."];
  }

  return [...new Set([
    ...affectedPaths.map((rawPath) => {
      const path = normalizeProjectPath(rawPath);
      return packages.find((candidate) => containsPath(candidate, path)) ?? ".";
    }),
    ...targetScopes.map(normalizeProjectPath),
  ])].sort();
}

function scriptMatchesCapability(name: string, capability: "lint" | "typecheck" | "test" | "build"): boolean {
  if (capability === "typecheck") return name === "typecheck" || name === "check:types" || name.includes("typecheck");
  return name === capability || name.startsWith(`${capability}:`);
}

function findScopedScript(
  inspection: ProjectInspection,
  capability: "lint" | "typecheck" | "test" | "build",
  scope: string,
): ProjectInspection["scripts"][number] | undefined {
  const candidates = inspection.scripts.filter((script) => scriptMatchesCapability(script.name, capability));
  return candidates.find((script) => normalizeProjectPath(script.packagePath) === scope);
}

export function verificationTargetId(target: VerificationTarget): string {
  return `${target.verifierId}::${normalizeProjectPath(target.scope)}`;
}

export function resolveVerificationPlan(
  inspection: ProjectInspection,
  classification: TaskClassification,
): VerificationPlanItem[] {
  const scopes = resolveAffectedScopes(inspection, classification.affectedPaths, classification.targetScopes);
  const plan: VerificationPlanItem[] = scopes.map((scope) => ({
    targetId: verificationTargetId({ verifierId: "verify.files", scope }),
    verifierId: "verify.files",
    scope,
    required: true,
    available: true,
    packagePath: scope,
    script: null,
    riskReduced: "Invalid project assumptions and missing structural inputs.",
    evidenceProduced: `Presence check for concrete task inputs under ${scope}.`,
    reason: "Every affected scope must verify the structural inputs it relied on.",
  }));

  if (classification.risk === "trivial") return plan.map((item) => VerificationPlanItemSchema.parse(item));

  const highRisk = classification.risk === "high-risk" || classification.risk === "critical";
  const requiredCapabilities = new Set<string>();
  if (classification.type === "business_behavior" || classification.type === "bugfix") requiredCapabilities.add("test");
  if (inspection.matchedProfiles.includes("profile.typescript")) requiredCapabilities.add("typecheck");
  if (highRisk) ["lint", "typecheck", "test", "build"].forEach((id) => requiredCapabilities.add(id));
  if (classification.type === "ui_style") requiredCapabilities.add("build");

  for (const scope of scopes) {
    for (const id of ["lint", "typecheck", "test", "build"] as const) {
      const script = findScopedScript(inspection, id, scope);
      const available = Boolean(script);
      const required = requiredCapabilities.has(id);
      if (!available && !required) continue;

      const target = { verifierId: `verify.${id}` as const, scope };
      plan.push({
        ...target,
        targetId: verificationTargetId(target),
        required,
        available,
        packagePath: script?.packagePath ?? null,
        script: script?.name ?? null,
        riskReduced: CAPABILITY_RISK[id],
        evidenceProduced: available
          ? `Result of ${script?.packagePath ?? scope}/package.json#scripts.${script?.name ?? id} for scope ${scope}.`
          : `Explicit unresolved ${id} capability for scope ${scope}.`,
        reason: available
          ? `${id} was resolved for affected scope ${scope}${required ? " and is required by task risk" : ""}.`
          : `${id} is required for affected scope ${scope}, but no script is declared by that package.`,
      });
    }
  }

  return plan.map((item) => VerificationPlanItemSchema.parse(item));
}
