import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PersistedAcceptanceCriterionSchema,
  type PersistedAcceptanceCriterion,
} from "../planning/plan-revision.js";
import type { EngineeringPlan } from "../planning/engineering-plan.js";

const PortableReferenceSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  return !value.replaceAll("\\", "/").split("/").includes("..");
}, "Specification references must be portable and project-relative.");

export const SpecificationSourceSchema = z.object({
  kind: z.enum(["user", "product-document", "issue", "conversation", "engineering-plan"]),
  reference: PortableReferenceSchema.nullable(),
  revision: z.string().min(1).nullable(),
}).strict();

export const SpecificationScenarioSchema = z.object({
  id: z.string().regex(/^scenario-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
}).strict();

const SpecificationContentFields = {
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable().default(null),
  context: z.string().trim().min(1).nullable().default(null),
  expectedBehaviors: z.array(z.string().min(1)).default([]),
  businessRules: z.array(z.string().min(1)).default([]),
  scenarios: z.array(SpecificationScenarioSchema).default([]),
  edgeCases: z.array(z.string().min(1)).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  constraints: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(PersistedAcceptanceCriterionSchema).default([]),
  outOfScope: z.array(z.string().min(1)).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
  provenance: z.object({ sources: z.array(SpecificationSourceSchema).min(1) }).strict(),
};

const SpecificationContentObjectSchema = z.object(SpecificationContentFields).strict();

function validateSpecificationContent(
  specification: z.infer<typeof SpecificationContentObjectSchema>,
  context: z.RefinementCtx,
): void {
  const scenarioIds = new Set<string>();
  for (const [index, scenario] of specification.scenarios.entries()) {
    if (scenarioIds.has(scenario.id)) context.addIssue({
      code: "custom",
      path: ["scenarios", index, "id"],
      message: "Specification scenario ids must be unique.",
    });
    scenarioIds.add(scenario.id);
  }
  const criterionIds = new Set<string>();
  for (const [index, criterion] of specification.acceptanceCriteria.entries()) {
    if (criterionIds.has(criterion.id)) context.addIssue({
      code: "custom",
      path: ["acceptanceCriteria", index, "id"],
      message: "Specification acceptance criterion ids must be unique.",
    });
    criterionIds.add(criterion.id);
  }
}

const SpecificationContentSchema = SpecificationContentObjectSchema.superRefine(validateSpecificationContent);

export const FeatureSpecificationInputSchema = SpecificationContentSchema;

export const FeatureSpecificationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("feature-specification"),
  id: z.string().regex(/^spec-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/),
  status: z.literal("supplied"),
  ...SpecificationContentFields,
}).strict().superRefine(validateSpecificationContent);

export type FeatureSpecificationInput = z.input<typeof FeatureSpecificationInputSchema>;
export type FeatureSpecification = z.infer<typeof FeatureSpecificationSchema>;

function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").filter(Boolean)
    .slice(0, 6).join("-").slice(0, 48).replace(/-+$/g, "") || "feature";
}

export function createFeatureSpecification(raw: FeatureSpecificationInput): FeatureSpecification {
  const content = FeatureSpecificationInputSchema.parse(raw);
  const digest = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 8);
  return FeatureSpecificationSchema.parse({
    schemaVersion: 1,
    kind: "feature-specification",
    id: `spec-${slug(content.title)}-${digest}`,
    status: "supplied",
    ...content,
  });
}

export function createTaskSpecification(plan: EngineeringPlan): FeatureSpecification {
  return createFeatureSpecification({
    title: plan.task.description,
    objective: plan.task.description,
    description: null,
    context: null,
    expectedBehaviors: [],
    businessRules: [],
    scenarios: [],
    edgeCases: [],
    decisions: [],
    constraints: [],
    acceptanceCriteria: [],
    outOfScope: [],
    openQuestions: [],
    provenance: {
      sources: [{ kind: "engineering-plan", reference: `.azevedo/plans/${plan.id}.json`, revision: null }],
    },
  });
}

export function parseFeatureSpecification(value: unknown): FeatureSpecification {
  const canonical = FeatureSpecificationSchema.safeParse(value);
  if (canonical.success) {
    const { schemaVersion: _schemaVersion, kind: _kind, id: _id, status: _status, ...content } = canonical.data;
    const rebuilt = createFeatureSpecification(content);
    if (rebuilt.id !== canonical.data.id) throw new Error("Specification id does not match its canonical content.");
    return canonical.data;
  }
  return createFeatureSpecification(FeatureSpecificationInputSchema.parse(value));
}

export function serializeFeatureSpecification(specification: FeatureSpecification): string {
  return `${JSON.stringify(FeatureSpecificationSchema.parse(specification), null, 2)}\n`;
}

export function specificationAcceptanceCriteria(
  specification: FeatureSpecification,
): PersistedAcceptanceCriterion[] {
  return specification.acceptanceCriteria.map((criterion) => PersistedAcceptanceCriterionSchema.parse(criterion));
}
