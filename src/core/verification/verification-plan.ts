import { z } from "zod";
import type { ProjectInspection } from "../schemas/discovery.js";
import type { TaskClassification } from "../schemas/task.js";

export const VerificationPlanItemSchema = z.object({
  verifierId: z.enum(["verify.files", "verify.lint", "verify.typecheck", "verify.test", "verify.build"]),
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

export function resolveVerificationPlan(
  inspection: ProjectInspection,
  classification: TaskClassification,
): VerificationPlanItem[] {
  const plan: VerificationPlanItem[] = [
    {
      verifierId: "verify.files",
      required: true,
      available: true,
      packagePath: ".",
      script: null,
      riskReduced: "Invalid project assumptions and missing structural inputs.",
      evidenceProduced: "Presence check for the concrete files required by the task.",
      reason: "Every task must verify the structural inputs it relied on.",
    },
  ];

  if (classification.risk === "trivial") return plan;

  const highRisk = classification.risk === "high-risk" || classification.risk === "critical";
  const requiredCapabilities = new Set<string>();
  if (classification.type === "business_behavior" || classification.type === "bugfix") requiredCapabilities.add("test");
  if (inspection.matchedProfiles.includes("profile.typescript")) requiredCapabilities.add("typecheck");
  if (highRisk) ["lint", "typecheck", "test", "build"].forEach((id) => requiredCapabilities.add(id));
  if (classification.type === "ui_style") requiredCapabilities.add("build");

  for (const id of ["lint", "typecheck", "test", "build"] as const) {
    const capability = inspection.capabilities.find((candidate) => candidate.id === id);
    const script = inspection.scripts.find((candidate) => {
      if (id === "typecheck") return candidate.name === "typecheck" || candidate.name === "check:types" || candidate.name.includes("typecheck");
      return candidate.name === id || candidate.name.startsWith(`${id}:`);
    });
    const available = capability?.state === "detected" && Boolean(script);
    const required = requiredCapabilities.has(id);
    if (!available && !required) continue;

    plan.push({
      verifierId: `verify.${id}`,
      required,
      available,
      packagePath: script?.packagePath ?? null,
      script: script?.name ?? null,
      riskReduced: CAPABILITY_RISK[id],
      evidenceProduced: available ? `Result of package script ${script?.name ?? id}.` : `Explicit unresolved ${id} capability.`,
      reason: available
        ? `${id} was discovered from project scripts${required ? " and is required for this task risk" : ""}.`
        : `${id} is required by the task risk but no deterministic project script was discovered.`,
    });
  }

  return plan.map((item) => VerificationPlanItemSchema.parse(item));
}
