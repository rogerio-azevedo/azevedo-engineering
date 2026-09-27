import { z } from "zod";
import { ComponentIdSchema } from "../schemas/component.js";
import { RiskClassSchema, RiskSignalSchema, TaskTypeSchema } from "../schemas/task.js";
import { WorkflowPhaseIdSchema } from "../schemas/workflow.js";

const PortableReferenceSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  return !value.replaceAll("\\", "/").split("/").includes("..");
}, "Reference paths must be project-relative and contained.");

export const KnowledgeKindSchema = z.enum([
  "principle",
  "procedure",
  "review-lens",
  "checklist",
  "reference",
]);

export const KnowledgeApplicabilitySelectorSchema = z.object({
  always: z.boolean().default(false),
  phases: z.array(WorkflowPhaseIdSchema).default([]),
  taskTypes: z.array(TaskTypeSchema).default([]),
  riskClasses: z.array(RiskClassSchema).default([]),
  signals: z.array(RiskSignalSchema).default([]),
  technologies: z.array(z.string().min(1)).default([]),
  capabilities: z.array(z.string().min(1)).default([]),
  pathPrefixes: z.array(PortableReferenceSchema).default([]),
}).strict().superRefine((selector, context) => {
  if (
    !selector.always &&
    selector.phases.length === 0 &&
    selector.taskTypes.length === 0 &&
    selector.riskClasses.length === 0 &&
    selector.signals.length === 0 &&
    selector.technologies.length === 0 &&
    selector.capabilities.length === 0 &&
    selector.pathPrefixes.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "A knowledge selector must declare at least one deterministic condition or always=true.",
    });
  }
});

export const KnowledgeSourceSchema = z.object({
  repository: z.string().min(1).nullable(),
  path: z.string().min(1),
  revision: z.string().min(1).nullable(),
  license: z.string().min(1).nullable(),
}).strict();

export const KnowledgeProvenanceSchema = z.object({
  origin: z.enum(["azevedo", "upstream-synthesis", "project"]),
  sources: z.array(KnowledgeSourceSchema).min(1),
}).strict();

export const KnowledgeUnitSchema = z.object({
  schemaVersion: z.literal(1),
  id: ComponentIdSchema,
  version: z.number().int().positive(),
  kind: KnowledgeKindSchema,
  summary: z.string().min(1),
  appliesWhen: z.array(KnowledgeApplicabilitySelectorSchema).min(1),
  doesNotApplyWhen: z.array(KnowledgeApplicabilitySelectorSchema).default([]),
  tags: z.array(z.string().min(1)).default([]),
  requires: z.array(ComponentIdSchema).default([]),
  conflictsWith: z.array(ComponentIdSchema).default([]),
  guidance: z.array(z.string().min(1)).min(1),
  expectedOutputs: z.array(z.string().min(1)).default([]),
  stopConditions: z.array(z.string().min(1)).default([]),
  provenance: KnowledgeProvenanceSchema,
  estimatedTokens: z.number().int().nonnegative(),
  evals: z.array(ComponentIdSchema).default([]),
  stability: z.enum(["experimental", "beta", "stable"]),
  owners: z.array(z.string().min(1)).default([]),
}).strict().superRefine((unit, context) => {
  if (unit.requires.includes(unit.id)) {
    context.addIssue({ code: "custom", path: ["requires"], message: "A knowledge unit cannot require itself." });
  }
  if (unit.conflictsWith.includes(unit.id)) {
    context.addIssue({ code: "custom", path: ["conflictsWith"], message: "A knowledge unit cannot conflict with itself." });
  }
});

export const KnowledgeResolutionContextSchema = z.object({
  phase: WorkflowPhaseIdSchema,
  taskType: TaskTypeSchema,
  riskClass: RiskClassSchema,
  signals: z.array(RiskSignalSchema),
  technologies: z.array(z.string().min(1)),
  capabilities: z.array(z.string().min(1)),
  affectedPaths: z.array(PortableReferenceSchema),
}).strict();

export const ContextManifestSelectionSchema = z.object({
  id: ComponentIdSchema,
  version: z.number().int().positive(),
  reason: z.array(z.string().min(1)).min(1),
  estimatedTokens: z.number().int().nonnegative(),
}).strict();

export const ContextManifestSchema = z.object({
  schemaVersion: z.literal(1),
  phase: WorkflowPhaseIdSchema,
  selected: z.array(ContextManifestSelectionSchema),
  totalEstimatedTokens: z.number().int().nonnegative(),
}).strict();

export type KnowledgeApplicabilitySelector = z.infer<typeof KnowledgeApplicabilitySelectorSchema>;
export type KnowledgeUnit = z.infer<typeof KnowledgeUnitSchema>;
export type KnowledgeResolutionContext = z.infer<typeof KnowledgeResolutionContextSchema>;
export type ContextManifest = z.infer<typeof ContextManifestSchema>;
