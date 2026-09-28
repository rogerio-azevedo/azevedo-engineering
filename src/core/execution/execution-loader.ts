import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ExplorationArtifactSchema, type ExplorationArtifact } from "../exploration/exploration-artifact.js";
import { EngineeringPlanRevisionSchema, type EngineeringPlanRevision } from "../planning/plan-revision.js";
import { parseFeatureSpecification, type FeatureSpecification } from "../specification/feature-specification.js";
import { ExecutionSessionSchema, type ExecutionSession } from "./execution-contracts.js";

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && resolve(root, path) === candidate;
}

function readSafeJson(root: string, reference: string): unknown {
  const destination = resolve(root, reference);
  const stats = lstatSync(destination);
  if (stats.isSymbolicLink() || !stats.isFile() || !isWithin(root, realpathSync(destination))) {
    throw new Error(`Execution source is not a safe project artifact: ${reference}`);
  }
  return JSON.parse(readFileSync(destination, "utf8"));
}

export function loadExecutionInputs(projectRoot: string, revisionId: string): {
  revision: EngineeringPlanRevision;
  specification: FeatureSpecification;
  exploration: ExplorationArtifact;
} {
  const root = realpathSync(projectRoot);
  const plansRoot = join(root, ".azevedo", "plans");
  const matches: string[] = [];
  for (const planEntry of readdirSync(plansRoot, { withFileTypes: true })) {
    if (!planEntry.isDirectory() || !/^plan-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/.test(planEntry.name)) continue;
    const candidate = join(plansRoot, planEntry.name, "revisions", `${revisionId}.json`);
    try {
      if (lstatSync(candidate).isFile()) matches.push(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (matches.length !== 1) throw new Error(
    matches.length === 0 ? `Plan revision not found: ${revisionId}` : `Plan revision is ambiguous: ${revisionId}`,
  );
  const revision = EngineeringPlanRevisionSchema.parse(readSafeJson(root, relative(root, matches[0]!)));
  if (revision.id !== revisionId) throw new Error("Revision id does not match the requested artifact.");
  const specReference = revision.basis.sourceArtifactIds.find((item) => item.startsWith(".azevedo/specifications/"));
  const explorationReference = revision.basis.sourceArtifactIds.find((item) => item.startsWith(".azevedo/explorations/"));
  if (!specReference || !explorationReference) throw new Error("Revision does not reference specification and exploration artifacts.");
  const specification = parseFeatureSpecification(readSafeJson(root, specReference));
  const exploration = ExplorationArtifactSchema.parse(readSafeJson(root, explorationReference));
  return { revision, specification, exploration };
}

export function loadLatestExecutionSession(projectRoot: string, executionId: string): ExecutionSession {
  if (!/^execution-[1-9][0-9]*-[a-f0-9]{10}$/.test(executionId)) {
    throw new Error(`Invalid execution id: ${executionId}`);
  }
  const root = realpathSync(projectRoot);
  const directory = join(root, ".azevedo", "executions", executionId, "sessions");
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory() || !isWithin(root, realpathSync(directory))) {
    throw new Error(`Execution session storage is not a safe directory: ${executionId}`);
  }
  const sessions = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^execution-snapshot-[1-9][0-9]*-[a-f0-9]{10}\.json$/.test(entry.name))
    .map((entry) => ExecutionSessionSchema.parse(readSafeJson(
      root,
      relative(root, join(directory, entry.name)),
    )))
    .filter((session) => session.id === executionId)
    .sort((left, right) => left.snapshotSequence - right.snapshotSequence);
  if (sessions.length === 0) throw new Error(`No execution snapshots found for ${executionId}.`);
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index]!;
    if (session.snapshotSequence !== index + 1) throw new Error(`Execution ${executionId} has a non-contiguous snapshot history.`);
    if (index > 0 && session.parentSnapshotId !== sessions[index - 1]!.snapshotId) {
      throw new Error(`Execution ${executionId} has a broken append-only snapshot chain.`);
    }
  }
  return sessions.at(-1)!;
}
