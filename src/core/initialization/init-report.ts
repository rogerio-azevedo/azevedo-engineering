import { z } from "zod";
import { InitOwnershipSchema, type InitOperation, type InitPlan, type ProjectInitPlan } from "./init-plan.js";

export const InitOperationReportSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), path: z.string(), ownership: InitOwnershipSchema }),
  z.object({ action: z.literal("unchanged"), path: z.string(), ownership: InitOwnershipSchema }),
  z.object({ action: z.literal("conflict"), path: z.string(), ownership: InitOwnershipSchema, reason: z.string() }),
]);

export const InitSummarySchema = z.object({
  projects: z.number().int().positive(),
  create: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
});

export const ProjectInitReportSchema = z.object({
  relativePath: z.string().min(1),
  root: z.string().min(1),
  blocked: z.boolean(),
  operations: z.array(InitOperationReportSchema),
  summary: InitSummarySchema.omit({ projects: true }),
});

export const InitReportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(["project", "project-group"]),
  root: z.string().min(1),
  dryRun: z.boolean(),
  blocked: z.boolean(),
  applied: z.boolean(),
  outcome: z.enum(["blocked", "dry-run", "initialized", "already-initialized"]),
  projects: z.array(ProjectInitReportSchema).min(1),
  summary: InitSummarySchema,
});

export type InitReport = z.infer<typeof InitReportSchema>;

function operationReport(operation: InitOperation): z.infer<typeof InitOperationReportSchema> {
  if (operation.action === "conflict") return {
    action: operation.action,
    path: operation.path,
    ownership: operation.ownership,
    reason: operation.reason,
  };
  return { action: operation.action, path: operation.path, ownership: operation.ownership };
}

function summarize(operations: readonly InitOperation[]) {
  return {
    create: operations.filter((operation) => operation.action === "create").length,
    unchanged: operations.filter((operation) => operation.action === "unchanged").length,
    conflicts: operations.filter((operation) => operation.action === "conflict").length,
  };
}

function projectReport(relativePath: string, plan: ProjectInitPlan) {
  return {
    relativePath,
    root: plan.root,
    blocked: plan.blocked,
    operations: plan.operations.map(operationReport),
    summary: summarize(plan.operations),
  };
}

export function createInitReport(plan: InitPlan, dryRun: boolean): InitReport {
  const projects = plan.kind === "project"
    ? [projectReport(".", plan)]
    : plan.projects.map((project) => projectReport(project.relativePath, project.plan));
  const operations = plan.kind === "project"
    ? plan.operations
    : plan.projects.flatMap((project) => project.plan.operations);
  const summary = { projects: projects.length, ...summarize(operations) };
  return InitReportSchema.parse({
    schemaVersion: 1,
    kind: plan.kind,
    root: plan.root,
    dryRun,
    blocked: plan.blocked,
    applied: !dryRun && !plan.blocked && summary.create > 0,
    outcome: plan.blocked
      ? "blocked"
      : dryRun
        ? "dry-run"
        : summary.create > 0
          ? "initialized"
          : "already-initialized",
    projects,
    summary,
  });
}
