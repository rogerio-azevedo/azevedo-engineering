import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectInspectResult } from "../inspection/inspect-result.js";
import { classifyTask } from "../risk/classify-task.js";
import { ProjectTopologySchema } from "../schemas/discovery.js";
import {
  RiskClassSchema,
  RiskSignalSchema,
  TaskClassificationSchema,
  TaskTypeSchema,
} from "../schemas/task.js";
import {
  VerificationPlanItemSchema,
  resolveVerificationPlan,
} from "../verification/verification-plan.js";

const PortablePathSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  const segments = value.replaceAll("\\", "/").split("/");
  return !segments.includes("..");
}, "Path must be project-relative and contained.");

export const PlanEvidenceSchema = z.object({
  kind: z.enum(["inspection", "manifest", "config", "task-signal"]),
  source: PortablePathSchema,
  statement: z.string().min(1),
}).strict();

export const PlanStepKindSchema = z.enum([
  "research",
  "implementation",
  "test",
  "review",
  "verification",
  "documentation",
]);

export const PlanStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: PlanStepKindSchema,
  description: z.string().min(1),
  required: z.boolean(),
}).strict();

export const PlanVerificationRequirementSchema = VerificationPlanItemSchema.extend({
  scope: PortablePathSchema,
  packagePath: PortablePathSchema.nullable(),
}).strict();

export const EngineeringPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^plan-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/),
  task: z.object({
    description: z.string().trim().min(1),
    type: TaskTypeSchema,
  }).strict(),
  project: z.object({
    root: z.literal("."),
    topology: ProjectTopologySchema,
    technologies: z.array(z.string().min(1)),
  }).strict(),
  scope: z.object({
    affectedPaths: z.array(PortablePathSchema),
    targetScopes: z.array(PortablePathSchema),
  }).strict(),
  risk: z.object({
    class: RiskClassSchema,
    reasons: z.array(z.string().min(1)).min(1),
    signals: z.array(RiskSignalSchema),
  }).strict(),
  understanding: z.object({
    summary: z.string().min(1),
    evidence: z.array(PlanEvidenceSchema).min(1),
    assumptions: z.array(z.string().min(1)),
    unknowns: z.array(z.string().min(1)),
  }).strict(),
  steps: z.array(PlanStepSchema).min(1),
  verification: z.array(PlanVerificationRequirementSchema).min(1),
  governance: z.object({
    tdd: TaskClassificationSchema.shape.tdd,
    architectReviewRequired: z.boolean(),
    securityReviewRequired: z.boolean(),
  }).strict(),
  decisions: z.object({
    required: z.boolean(),
    items: z.array(z.string().min(1)),
  }).strict(),
  status: z.literal("planned"),
}).strict().superRefine((plan, context) => {
  const stepIds = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    if (stepIds.has(step.id)) {
      context.addIssue({ code: "custom", path: ["steps", index, "id"], message: "Plan step ids must be unique." });
    }
    stepIds.add(step.id);
  }

  const implementationIndex = plan.steps.findIndex((step) => step.kind === "implementation");
  if (implementationIndex < 0) {
    context.addIssue({ code: "custom", path: ["steps"], message: "A change plan requires an implementation step." });
  }
  if (plan.understanding.unknowns.length > 0) {
    const researchIndex = plan.steps.findIndex((step) => step.kind === "research");
    if (researchIndex < 0 || (implementationIndex >= 0 && researchIndex > implementationIndex)) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Plans with unknowns require a research step before implementation.",
      });
    }
  }
  if (plan.decisions.required !== (plan.decisions.items.length > 0)) {
    context.addIssue({
      code: "custom",
      path: ["decisions", "required"],
      message: "Decision requirement must match the presence of decision items.",
    });
  }
});

export type EngineeringPlan = z.infer<typeof EngineeringPlanSchema>;
export type PlanEvidence = z.infer<typeof PlanEvidenceSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

function canonicalIdentity(value: unknown): string {
  return JSON.stringify(value);
}

function taskSlug(task: string): string {
  const slug = task
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "task";
}

export function createPlanId(
  task: string,
  topology: "single-repo" | "monorepo",
  targetScopes: readonly string[],
): string {
  const description = task.trim();
  const digest = createHash("sha256")
    .update(canonicalIdentity({ description, topology, targetScopes: [...targetScopes].sort() }))
    .digest("hex")
    .slice(0, 8);
  return `plan-${taskSlug(description)}-${digest}`;
}

function compareEvidence(left: PlanEvidence, right: PlanEvidence): number {
  return `${left.kind}:${left.source}:${left.statement}`.localeCompare(`${right.kind}:${right.source}:${right.statement}`);
}

function buildEvidence(
  inspection: ProjectInspectResult,
  taskType: z.infer<typeof TaskTypeSchema>,
  signals: readonly string[],
): PlanEvidence[] {
  const evidence: PlanEvidence[] = [{
    kind: "config",
    source: "azevedo.config.yaml",
    statement: "The project declares schemaVersion 1 and the Codex engineering adapter.",
  }];

  for (const item of inspection.topology.evidence) evidence.push({
    kind: item.includes("package.json") ? "manifest" : "inspection",
    source: item.split("#")[0] || "inspection",
    statement: `Repository topology is ${inspection.topology.value ?? "unknown"}.`,
  });
  for (const technology of inspection.technologies) {
    for (const source of technology.evidence) evidence.push({
      kind: source.includes("package.json") ? "manifest" : "inspection",
      source: source.split("#")[0] || "inspection",
      statement: `${technology.id} is detected by project inspection.`,
    });
  }
  evidence.push({
    kind: "task-signal",
    source: "task.description",
    statement: `Task classified as ${taskType}.`,
  });
  for (const signal of signals) evidence.push({
    kind: "task-signal",
    source: "task.description",
    statement: `Task signal detected: ${signal}.`,
  });
  return evidence.map((item) => PlanEvidenceSchema.parse(item)).sort(compareEvidence);
}

function buildSteps(
  inspection: ProjectInspectResult,
  risk: z.infer<typeof RiskClassSchema>,
  taskType: z.infer<typeof TaskClassificationSchema>["type"],
): PlanStep[] {
  const steps: PlanStep[] = [{
    id: "research-current-implementation",
    kind: "research",
    description: "Explore the repository to identify the exact implementation files and current behavior relevant to the task.",
    required: true,
  }, {
    id: "implement-requested-change",
    kind: "implementation",
    description: "Implement the requested behavior only in files supported by repository exploration.",
    required: true,
  }];

  if (inspection.capabilities.some((capability) => capability.id === "test" && capability.state === "detected")) {
    steps.push({
      id: "test-requested-change",
      kind: "test",
      description: "Run the detected project test capability for the affected scope.",
      required: true,
    });
  }
  if (risk !== "trivial") steps.push({
    id: "review-resulting-change",
    kind: "review",
    description: "Review the resulting diff for correctness, scope, regressions, and blocking findings.",
    required: true,
  });
  steps.push({
    id: "verify-required-capabilities",
    kind: "verification",
    description: "Collect evidence for every required verification target without inventing unavailable commands.",
    required: true,
  });
  if (taskType === "docs") steps.push({
    id: "document-requested-change",
    kind: "documentation",
    description: "Update the requested documentation while preserving existing project decisions.",
    required: true,
  });
  return steps.map((step) => PlanStepSchema.parse(step));
}

export function buildEngineeringPlan(inspection: ProjectInspectResult, rawTask: string): EngineeringPlan {
  const task = rawTask.trim();
  if (!task) throw new Error("Task description must not be empty.");
  if (inspection.topology.state === "unknown" || !inspection.topology.value) {
    throw new Error("There is not enough evidence of a recognizable project to build a plan.");
  }

  const targetScopes = inspection.topology.value === "single-repo" ? ["."] : [];
  const id = createPlanId(task, inspection.topology.value, targetScopes);
  const classification = classifyTask({
    taskId: id,
    title: task,
    description: "",
    affectedPaths: [],
    targetScopes,
    signals: [],
  });
  const verificationClassification = classification.targetScopes.length === 0
    ? { ...classification, targetScopes: ["."] }
    : classification;
  const verification = resolveVerificationPlan(inspection, verificationClassification)
    .map((requirement) => PlanVerificationRequirementSchema.parse(requirement));
  const unknowns = ["Exact implementation files require repository exploration."];
  if (inspection.topology.value === "monorepo") {
    unknowns.push("The affected package scope requires repository exploration.");
  }
  for (const capability of inspection.capabilities) {
    if (capability.state === "unknown") unknowns.push(`No ${capability.id} command was detected by inspection.`);
  }

  const decisions: string[] = [];
  if (classification.architectRequired) decisions.push("Architecture review is required before implementation.");
  if (classification.securityReviewRequired) decisions.push("Security review is required before completion.");

  return EngineeringPlanSchema.parse({
    schemaVersion: 1,
    id,
    task: { description: task, type: classification.type },
    project: {
      root: ".",
      topology: inspection.topology.value,
      technologies: inspection.technologies.map((technology) => technology.id).sort(),
    },
    scope: { affectedPaths: [], targetScopes },
    risk: {
      class: classification.risk,
      reasons: [`task-type:${classification.type}`, ...classification.signals, ...classification.rationale],
      signals: classification.signals,
    },
    understanding: {
      summary: `Plan the requested change conservatively: ${task}`,
      evidence: buildEvidence(inspection, classification.type, classification.signals),
      assumptions: ["The task description is the authoritative initial statement of intent."],
      unknowns,
    },
    steps: buildSteps(inspection, classification.risk, classification.type),
    verification,
    governance: {
      tdd: classification.tdd,
      architectReviewRequired: classification.architectRequired,
      securityReviewRequired: classification.securityReviewRequired,
    },
    decisions: { required: decisions.length > 0, items: decisions },
    status: "planned",
  });
}

export function serializeEngineeringPlan(plan: EngineeringPlan): string {
  return `${JSON.stringify(EngineeringPlanSchema.parse(plan), null, 2)}\n`;
}
