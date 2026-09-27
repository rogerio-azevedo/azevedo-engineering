import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, type Stats } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { EngineeringPlanSchema, serializeEngineeringPlan, type EngineeringPlan } from "./engineering-plan.js";

export const PlanArtifactOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), artifact: z.string().min(1), content: z.string().min(1) }),
  z.object({ action: z.literal("unchanged"), artifact: z.string().min(1) }),
  z.object({ action: z.literal("conflict"), artifact: z.string().min(1), reason: z.string().min(1) }),
]);

export type PlanArtifactOperation = z.infer<typeof PlanArtifactOperationSchema>;

export const PlanCommandReportSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: z.enum(["created", "unchanged", "conflict"]),
  artifact: z.string().min(1),
  plan: EngineeringPlanSchema,
  reason: z.string().min(1).optional(),
}).strict().superRefine((report, context) => {
  if (report.outcome === "conflict" && !report.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Conflict reports require a reason." });
  }
});

export type PlanCommandReport = z.infer<typeof PlanCommandReportSchema>;

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertWithinRoot(projectRoot: string, path: string): void {
  const relativePath = relative(projectRoot, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || resolve(projectRoot, relativePath) !== path) {
    throw new Error(`Plan artifact escapes the project root: ${path}`);
  }
}

function artifactPath(plan: EngineeringPlan): string {
  return `.azevedo/plans/${plan.id}.json`;
}

export function buildPlanArtifactOperation(projectRoot: string, rawPlan: EngineeringPlan): PlanArtifactOperation {
  const plan = EngineeringPlanSchema.parse(rawPlan);
  const root = realpathSync(projectRoot);
  const relativeArtifact = artifactPath(plan);
  const plansDirectory = join(root, ".azevedo", "plans");
  const destination = join(plansDirectory, `${plan.id}.json`);
  assertWithinRoot(root, destination);

  const plansStats = lstatOrNull(plansDirectory);
  if (plansStats?.isSymbolicLink() || (plansStats && !plansStats.isDirectory())) {
    return PlanArtifactOperationSchema.parse({
      action: "conflict",
      artifact: relativeArtifact,
      reason: ".azevedo/plans exists with an unsafe filesystem type.",
    });
  }
  if (plansStats) {
    const plansRealPath = realpathSync(plansDirectory);
    assertWithinRoot(root, plansRealPath);
  }

  const destinationStats = lstatOrNull(destination);
  if (!destinationStats) return PlanArtifactOperationSchema.parse({
    action: "create",
    artifact: relativeArtifact,
    content: serializeEngineeringPlan(plan),
  });
  if (destinationStats.isSymbolicLink() || !destinationStats.isFile()) return PlanArtifactOperationSchema.parse({
    action: "conflict",
    artifact: relativeArtifact,
    reason: "The plan artifact exists with an unsafe filesystem type.",
  });

  const expected = Buffer.from(serializeEngineeringPlan(plan), "utf8");
  return readFileSync(destination).equals(expected)
    ? PlanArtifactOperationSchema.parse({ action: "unchanged", artifact: relativeArtifact })
    : PlanArtifactOperationSchema.parse({
      action: "conflict",
      artifact: relativeArtifact,
      reason: "A different plan already exists for this deterministic plan id.",
    });
}

function ensurePlansDirectory(projectRoot: string): string {
  const stateDirectory = join(projectRoot, ".azevedo");
  const stateStats = lstatSync(stateDirectory);
  if (stateStats.isSymbolicLink() || !stateStats.isDirectory()) throw new Error(".azevedo is not a safe directory.");

  const plansDirectory = join(stateDirectory, "plans");
  const stats = lstatOrNull(plansDirectory);
  if (!stats) mkdirSync(plansDirectory);
  const resultingStats = lstatSync(plansDirectory);
  if (resultingStats.isSymbolicLink() || !resultingStats.isDirectory()) {
    throw new Error(".azevedo/plans is not a safe directory.");
  }
  assertWithinRoot(projectRoot, realpathSync(plansDirectory));
  return plansDirectory;
}

export function applyPlanArtifactOperation(projectRoot: string, operation: PlanArtifactOperation): void {
  if (operation.action === "conflict") throw new Error("A conflicting plan artifact cannot be applied.");
  if (operation.action === "unchanged") return;

  const root = realpathSync(projectRoot);
  const plansDirectory = ensurePlansDirectory(root);
  const destination = join(root, operation.artifact);
  assertWithinRoot(root, destination);
  if (resolve(destination) !== join(plansDirectory, operation.artifact.split("/").at(-1) ?? "")) {
    throw new Error(`Unexpected plan artifact path: ${operation.artifact}`);
  }
  writeFileSync(destination, operation.content, { encoding: "utf8", flag: "wx" });
  if (!readFileSync(destination).equals(Buffer.from(operation.content, "utf8"))) {
    throw new Error(`Plan artifact verification failed: ${operation.artifact}`);
  }
}

export function createPlanCommandReport(
  plan: EngineeringPlan,
  operation: PlanArtifactOperation,
): PlanCommandReport {
  const outcome = operation.action === "create" ? "created" : operation.action;
  return PlanCommandReportSchema.parse({
    schemaVersion: 1,
    outcome,
    artifact: operation.artifact,
    plan,
    ...(operation.action === "conflict" ? { reason: operation.reason } : {}),
  });
}
