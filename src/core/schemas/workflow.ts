import { z } from "zod";
import { ComponentIdSchema } from "./component.js";

export const WorkflowPhaseIdSchema = z.enum([
  "understand",
  "research",
  "plan",
  "implement",
  "test",
  "review",
  "verify",
  "document",
  "learn",
  "done",
]);

export const WorkflowPhaseSchema = z.object({
  id: WorkflowPhaseIdSchema,
  summary: z.string().min(1),
  output: z.string().min(1),
  gate: z.string().min(1),
});

export const WorkflowSchema = z.object({
  id: ComponentIdSchema,
  version: z.number().int().positive(),
  phases: z.array(WorkflowPhaseSchema).length(10),
});

export type Workflow = z.infer<typeof WorkflowSchema>;

