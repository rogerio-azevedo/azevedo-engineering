import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExecutionSession } from "../execution/execution-contracts.js";
import { captureProjectCheckpoint, sameWorkspace } from "../execution/project-checkpoint.js";
import type { ExplorationArtifact } from "../exploration/exploration-artifact.js";
import type { EngineeringPlanRevision } from "../planning/plan-revision.js";
import { ReviewChangeSetSchema, reviewDigest, type ReviewChangeSet } from "./review-contracts.js";

function digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function git(root: string, args: readonly string[], encoding: "utf8" | "buffer" = "utf8") {
  return spawnSync("git", [...args], {
    cwd: root,
    encoding,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function commitRevision(root: string, ref: string) {
  const head = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (head.status !== 0) throw new Error(`Git review ref cannot be resolved: ${ref}.`);
  return {
    head: String(head.stdout).trim(),
    worktreeDigest: digest(""),
    dirty: false,
  };
}

type NameStatus = { kind: "created" | "modified" | "removed" | "renamed"; path: string; previousPath: string | null };

function parseNameStatus(raw: string): NameStatus[] {
  const fields = raw.split("\0").filter(Boolean);
  const values: NameStatus[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path) throw new Error("Malformed renamed path in git diff.");
      values.push({ kind: "renamed", path, previousPath });
      continue;
    }
    const path = fields[index++];
    if (!path) throw new Error("Malformed path in git diff.");
    const kind = status.startsWith("A")
      ? "created" as const
      : status.startsWith("D") ? "removed" as const : "modified" as const;
    values.push({ kind, path, previousPath: null });
  }
  return values;
}

export function captureGitRangeChangeSet(input: {
  projectRoot: string;
  baseRef: string;
  targetRef: string;
  session: ExecutionSession;
  revision: EngineeringPlanRevision;
  exploration: ExplorationArtifact;
}): ReviewChangeSet {
  const root = resolve(input.projectRoot);
  const baseRevision = commitRevision(root, input.baseRef);
  const targetRevision = commitRevision(root, input.targetRef);
  const status = git(root, ["diff", "--name-status", "-z", "--find-renames", baseRevision.head!, targetRevision.head!]);
  if (status.status !== 0) throw new Error("Could not enumerate the review git range.");
  const fullDiff = git(root, ["diff", "--binary", "--no-ext-diff", baseRevision.head!, targetRevision.head!], "buffer");
  if (fullDiff.status !== 0) throw new Error("Could not capture the review git diff.");
  const executionByPath = new Map(input.session.changes.map((change) => [change.path, change]));
  const exploredByPath = new Map(input.exploration.affectedPaths.map((path) => [path.path, path]));
  const planStepIds = input.revision.planSnapshot.steps
    .filter((step) => step.kind === "implementation")
    .map((step) => step.id)
    .sort();
  const files = parseNameStatus(String(status.stdout)).map((change) => {
    const fileDiff = git(root, [
      "diff", "--binary", "--no-ext-diff", baseRevision.head!, targetRevision.head!, "--", change.path,
    ], "buffer");
    if (fileDiff.status !== 0) throw new Error(`Could not capture diff for ${change.path}.`);
    const execution = executionByPath.get(change.path);
    const exploration = exploredByPath.get(change.path);
    return {
      ...change,
      diffDigest: digest(fileDiff.stdout as Buffer),
      acceptanceCriterionIds: [...new Set(exploration?.acceptanceCriterionIds ?? [])].sort(),
      planStepIds,
      executionEvidenceIds: [...new Set(execution?.evidenceIds ?? [])].sort(),
      withinAuthorizedScope: Boolean(execution || exploration),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const mismatchReasons: string[] = [];
  if (!input.session.after) mismatchReasons.push("The execution session has no terminal after checkpoint.");
  else {
    if (input.session.after.head !== targetRevision.head) mismatchReasons.push(
      `The git-range target ${targetRevision.head} differs from execution after HEAD ${input.session.after.head ?? "null"}.`,
    );
    if (input.session.after.subjectRevision.dirty) mismatchReasons.push(
      "The execution snapshot was dirty, so a later commit cannot prove byte-identical source content.",
    );
  }
  const seed = {
    schemaVersion: 1 as const,
    source: "git-range" as const,
    baseRevision,
    targetRevision,
    exactExecutionMatch: mismatchReasons.length === 0,
    mismatchReasons,
    files,
    diffDigest: digest(fullDiff.stdout as Buffer),
  };
  return ReviewChangeSetSchema.parse({ ...seed, id: `change-set-${reviewDigest(seed)}` });
}

export function captureWorkingTreeChangeSet(input: {
  projectRoot: string;
  baseRef: string;
  session: ExecutionSession;
  revision: EngineeringPlanRevision;
  exploration: ExplorationArtifact;
}): ReviewChangeSet {
  const root = resolve(input.projectRoot);
  const baseRevision = commitRevision(root, input.baseRef);
  const checkpoint = captureProjectCheckpoint(root);
  const status = git(root, ["diff", "--name-status", "-z", "--find-renames", baseRevision.head!, "--"]);
  if (status.status !== 0) throw new Error("Could not enumerate the working-tree review diff.");
  const changes = parseNameStatus(String(status.stdout));
  const knownPaths = new Set(changes.flatMap((change) => [change.path, ...(change.previousPath ? [change.previousPath] : [])]));
  for (const entry of checkpoint.status.filter((item) => !item.harnessOwned && item.index === "?" && item.worktree === "?")) {
    if (!knownPaths.has(entry.path)) changes.push({ kind: "created", path: entry.path, previousPath: null });
  }
  const executionByPath = new Map(input.session.changes.map((change) => [change.path, change]));
  const exploredByPath = new Map(input.exploration.affectedPaths.map((path) => [path.path, path]));
  const planStepIds = input.revision.planSnapshot.steps
    .filter((step) => step.kind === "implementation")
    .map((step) => step.id)
    .sort();
  const files = changes.map((change) => {
    const fileDiff = git(root, ["diff", "--binary", "--no-ext-diff", baseRevision.head!, "--", change.path], "buffer");
    if (fileDiff.status !== 0) throw new Error(`Could not capture working-tree diff for ${change.path}.`);
    const diffContent = (fileDiff.stdout as Buffer).length > 0
      ? fileDiff.stdout as Buffer
      : readFileSync(resolve(root, change.path));
    const execution = executionByPath.get(change.path);
    const exploration = exploredByPath.get(change.path);
    return {
      ...change,
      diffDigest: digest(diffContent),
      acceptanceCriterionIds: [...new Set(exploration?.acceptanceCriterionIds ?? [])].sort(),
      planStepIds,
      executionEvidenceIds: [...new Set(execution?.evidenceIds ?? [])].sort(),
      withinAuthorizedScope: Boolean(execution || exploration),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const mismatchReasons: string[] = [];
  if (!input.session.after) mismatchReasons.push("The execution session has no terminal after checkpoint.");
  else {
    const after = input.session.after.subjectRevision;
    const current = checkpoint.subjectRevision;
    if (after.head !== current.head || after.worktreeDigest !== current.worktreeDigest || after.dirty !== current.dirty) {
      mismatchReasons.push("The current working tree differs from the execution after checkpoint.");
    }
    if (!sameWorkspace(input.session.after, checkpoint)) mismatchReasons.push(
      "The current working tree cannot be bound to the execution workspace identity.",
    );
  }
  const seed = {
    schemaVersion: 1 as const,
    source: "working-tree" as const,
    baseRevision,
    targetRevision: checkpoint.subjectRevision,
    exactExecutionMatch: mismatchReasons.length === 0,
    mismatchReasons,
    files,
    diffDigest: digest(JSON.stringify({ files: files.map((file) => [file.path, file.diffDigest]), target: checkpoint.subjectRevision })),
  };
  return ReviewChangeSetSchema.parse({ ...seed, id: `change-set-${reviewDigest(seed)}` });
}
