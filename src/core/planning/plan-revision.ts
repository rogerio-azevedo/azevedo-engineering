import { createHash } from "node:crypto";
import { z } from "zod";
import { ComponentIdSchema } from "../schemas/component.js";
import { SubjectRevisionSchema } from "../schemas/evidence.js";
import { EngineeringPlanSchema, createPlanId, type EngineeringPlan } from "./engineering-plan.js";

const PortableReferenceSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  return !value.replaceAll("\\", "/").split("/").includes("..");
}, "References must be project-relative and contained.");

export const PersistedAcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^ac-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  source: z.object({
    kind: z.enum(["user", "product-artifact", "assumption"]),
    reference: PortableReferenceSchema.nullable(),
  }).strict(),
  statement: z.string().min(1),
  scenario: z.object({
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
  }).strict(),
  prohibitedEffects: z.array(z.string().min(1)).default([]),
  verificationMethod: z.string().min(1),
  priority: z.enum(["required", "optional"]),
}).strict();

export const EngineeringPlanRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("engineering-plan-revision"),
  id: z.string().regex(/^plan-revision-[1-9][0-9]*-[a-f0-9]{8}$/),
  planId: EngineeringPlanSchema.shape.id,
  sequence: z.number().int().positive(),
  parentRevisionId: z.string().regex(/^plan-revision-[1-9][0-9]*-[a-f0-9]{8}$/).nullable(),
  basis: z.object({
    subjectRevision: SubjectRevisionSchema,
    sourceArtifactIds: z.array(PortableReferenceSchema),
    knowledgeUnitIds: z.array(ComponentIdSchema),
  }).strict(),
  acceptanceCriteria: z.array(PersistedAcceptanceCriterionSchema),
  planSnapshot: EngineeringPlanSchema,
  changeSummary: z.array(z.string().min(1)).min(1),
  status: z.literal("proposed"),
}).strict().superRefine((revision, context) => {
  if (revision.planSnapshot.id !== revision.planId) {
    context.addIssue({ code: "custom", path: ["planSnapshot", "id"], message: "A revision must retain the original plan identity." });
  }
  const expectedPlanId = createPlanId(
    revision.planSnapshot.task.description,
    revision.planSnapshot.project.topology,
    revision.planSnapshot.scope.targetScopes,
  );
  if (revision.planId !== expectedPlanId) {
    context.addIssue({
      code: "custom",
      path: ["planId"],
      message: "A revision cannot change the intent fields that define the original plan identity.",
    });
  }
  if ((revision.sequence === 1) !== (revision.parentRevisionId === null)) {
    context.addIssue({
      code: "custom",
      path: ["parentRevisionId"],
      message: "Only the first revision has no parent revision.",
    });
  }
  const criterionIds = new Set<string>();
  for (const [index, criterion] of revision.acceptanceCriteria.entries()) {
    if (criterionIds.has(criterion.id)) {
      context.addIssue({ code: "custom", path: ["acceptanceCriteria", index, "id"], message: "Acceptance criterion ids must be unique." });
    }
    criterionIds.add(criterion.id);
  }
});

export type PersistedAcceptanceCriterion = z.infer<typeof PersistedAcceptanceCriterionSchema>;
export type EngineeringPlanRevision = z.infer<typeof EngineeringPlanRevisionSchema>;

type RevisionInput = {
  planSnapshot: EngineeringPlan;
  parentRevision?: EngineeringPlanRevision | null;
  basis: EngineeringPlanRevision["basis"];
  acceptanceCriteria: PersistedAcceptanceCriterion[];
  changeSummary: string[];
};

export function createEngineeringPlanRevision(input: RevisionInput): EngineeringPlanRevision {
  const planSnapshot = EngineeringPlanSchema.parse(input.planSnapshot);
  const parent = input.parentRevision ? EngineeringPlanRevisionSchema.parse(input.parentRevision) : null;
  if (parent && parent.planId !== planSnapshot.id) {
    throw new Error(`Parent revision ${parent.id} belongs to a different plan.`);
  }
  const sequence = parent ? parent.sequence + 1 : 1;
  const basis = EngineeringPlanRevisionSchema.shape.basis.parse(input.basis);
  const acceptanceCriteria = input.acceptanceCriteria
    .map((criterion) => PersistedAcceptanceCriterionSchema.parse(criterion))
    .sort((left, right) => left.id.localeCompare(right.id));
  const content = {
    schemaVersion: 1 as const,
    kind: "engineering-plan-revision" as const,
    planId: planSnapshot.id,
    sequence,
    parentRevisionId: parent?.id ?? null,
    basis: {
      ...basis,
      sourceArtifactIds: [...basis.sourceArtifactIds].sort(),
      knowledgeUnitIds: [...basis.knowledgeUnitIds].sort(),
    },
    acceptanceCriteria,
    planSnapshot,
    changeSummary: input.changeSummary,
    status: "proposed" as const,
  };
  const digest = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 8);
  return EngineeringPlanRevisionSchema.parse({
    ...content,
    id: `plan-revision-${sequence}-${digest}`,
  });
}

export function serializeEngineeringPlanRevision(revision: EngineeringPlanRevision): string {
  return `${JSON.stringify(EngineeringPlanRevisionSchema.parse(revision), null, 2)}\n`;
}
