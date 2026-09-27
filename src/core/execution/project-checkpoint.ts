import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { captureSubjectRevision } from "../verification/subject-revision.js";
import { ProjectCheckpointSchema, type ProjectCheckpoint } from "./execution-contracts.js";

const HARNESS_PATHS = [".azevedo", ".codex", "AGENTS.md", "azevedo.config.yaml"];

function portable(path: string): string {
  return path.split(sep).join("/");
}

export function isHarnessOwnedPath(path: string): boolean {
  return HARNESS_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function git(root: string, args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
}

export function captureProjectCheckpoint(projectRoot: string): ProjectCheckpoint {
  const root = resolve(projectRoot);
  const gitRootResult = git(root, ["rev-parse", "--show-toplevel"]);
  const subjectRevision = captureSubjectRevision(root);
  if (gitRootResult.status !== 0) return ProjectCheckpointSchema.parse({
    schemaVersion: 1,
    head: null,
    branch: null,
    gitMode: "not-git",
    status: [],
    subjectRevision,
  });

  const gitRoot = gitRootResult.stdout.trim();
  const head = git(root, ["rev-parse", "--verify", "HEAD"]);
  const branch = git(root, ["branch", "--show-current"]);
  const gitDir = git(root, ["rev-parse", "--absolute-git-dir"]).stdout.trim();
  const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim();
  const statusResult = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (statusResult.status !== 0) throw new Error(`Could not capture git status for ${root}.`);
  const raw = statusResult.stdout.split("\0").filter(Boolean);
  const status: ProjectCheckpoint["status"] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const firstPath = entry.slice(3);
    const renamed = code.includes("R") || code.includes("C");
    const secondPath = renamed ? raw[index + 1] : undefined;
    if (renamed) index += 1;
    const absolutePath = resolve(root, firstPath);
    const path = portable(relative(root, absolutePath));
    const originalPath = renamed && secondPath ? portable(relative(root, resolve(root, secondPath))) : null;
    status.push({
      index: code[0] ?? " ",
      worktree: code[1] ?? " ",
      path,
      originalPath,
      harnessOwned: isHarnessOwnedPath(path),
    });
  }
  return ProjectCheckpointSchema.parse({
    schemaVersion: 1,
    head: head.status === 0 ? head.stdout.trim() : null,
    branch: branch.stdout.trim() || null,
    gitMode: gitDir !== commonDir || gitDir.includes(`${sep}worktrees${sep}`) ? "linked-worktree" : "primary-worktree",
    status: status.sort((left, right) => left.path.localeCompare(right.path)),
    subjectRevision,
  });
}

export function humanDirtyPaths(checkpoint: ProjectCheckpoint): string[] {
  return checkpoint.status.filter((entry) => !entry.harnessOwned).map((entry) => entry.path);
}
