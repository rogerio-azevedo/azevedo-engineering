import { z } from "zod";

export const TaskTypeSchema = z.enum([
  "docs",
  "ui_style",
  "config_infra",
  "refactor",
  "bugfix",
  "business_behavior",
  "architecture",
  "dependency_change",
  "security",
  "general",
]);

export const RiskClassSchema = z.enum(["trivial", "normal", "high-risk", "critical"]);

export const RiskSignalSchema = z.enum([
  "auth",
  "authorization",
  "credentials",
  "pii",
  "destructive_migration",
  "migration",
  "public_contract",
  "new_dependency",
  "structural_dependency",
  "new_boundary",
  "new_package",
  "new_app",
  "integration",
  "persistence",
  "production",
  "filesystem",
  "process_execution",
]);

export const TaskInputSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  type: TaskTypeSchema.optional(),
  affectedPaths: z.array(z.string()).default([]),
  targetScopes: z.array(z.string().min(1)).default([]),
  reproducibleBug: z.boolean().optional(),
  signals: z.array(RiskSignalSchema).default([]),
});

export type TaskInput = z.input<typeof TaskInputSchema>;

export const TaskClassificationSchema = z.object({
  taskId: z.string().min(1),
  type: TaskTypeSchema,
  risk: RiskClassSchema,
  signals: z.array(RiskSignalSchema),
  affectedPaths: z.array(z.string()),
  targetScopes: z.array(z.string().min(1)),
  rationale: z.array(z.string().min(1)),
  tdd: z.object({
    expectation: z.enum(["required", "recommended", "domain_verification", "not_applicable"]),
    reason: z.string().min(1),
  }),
  recommendedAgents: z.array(z.enum(["explorer", "architect", "reviewer", "security-reviewer"])),
  architectRequired: z.boolean(),
  securityReviewRequired: z.boolean(),
});

export type TaskClassification = z.infer<typeof TaskClassificationSchema>;
