import { z } from "zod";

export const ComponentIdSchema = z
  .string()
  .min(3)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);

export const ComponentKindSchema = z.enum([
  "agent",
  "skill",
  "rule",
  "workflow",
  "verifier",
  "stack-profile",
]);

export const ComponentSchema = z.object({
  id: ComponentIdSchema,
  version: z.number().int().positive(),
  kind: ComponentKindSchema,
  summary: z.string().min(1),
  appliesWhen: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  requires: z.array(ComponentIdSchema).default([]),
  conflictsWith: z.array(ComponentIdSchema).default([]),
  stability: z.enum(["experimental", "beta", "stable"]),
  owners: z.array(z.string().min(1)).default([]),
});

export type Component = z.infer<typeof ComponentSchema>;

export const GeneratedArtifactSchema = z.object({
  path: z.string().min(1),
  sourceIds: z.array(ComponentIdSchema).min(1),
  content: z.string(),
  managed: z.literal(true),
});

export type GeneratedArtifact = z.infer<typeof GeneratedArtifactSchema>;
