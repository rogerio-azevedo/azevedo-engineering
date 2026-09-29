import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export type GitRead = {
  isRepository: boolean;
  commit: string | null;
  branch: string | null;
  dirty: boolean;
  remote: string | null;
  gitDir: string | null;
  commonDir: string | null;
  linkedWorktree: boolean;
};

function runGit(cwd: string, args: readonly string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", "--no-optional-locks", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

function existingReal(directory: string, value: string): string {
  const resolved = resolve(directory, value);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

export function normalizeRemote(url: string): string {
  const withoutFragment = url.split("#")[0] ?? url;
  const withoutQuery = withoutFragment.split("?")[0] ?? withoutFragment;
  if (!withoutQuery.includes("://")) return withoutQuery;
  try {
    const parsed = new URL(withoutQuery);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return withoutQuery.replace(/\/\/[^/@]+@/, "//");
  }
}

export function readGitRepository(directory: string): GitRead {
  const inside = runGit(directory, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return {
      isRepository: false,
      commit: null,
      branch: null,
      dirty: false,
      remote: null,
      gitDir: null,
      commonDir: null,
      linkedWorktree: false,
    };
  }
  const head = runGit(directory, ["rev-parse", "HEAD"]);
  const branch = runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(directory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const remotes = runGit(directory, ["config", "--get-regexp", "^remote\\..*\\.url$"]);
  const gitDir = runGit(directory, ["rev-parse", "--git-dir"]);
  const commonDir = runGit(directory, ["rev-parse", "--git-common-dir"]);
  const commit = head.status === 0 && /^[a-f0-9]{40}$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
  const branchName = branch.status === 0 ? branch.stdout.trim() : null;
  const remoteLine = remotes.status === 0
    ? remotes.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort()
    : [];
  const origin = remoteLine.find((line) => line.startsWith("remote.origin.url ")) ?? remoteLine[0];
  const remote = origin ? normalizeRemote(origin.slice(origin.indexOf(" ") + 1)) : null;
  const gitDirPath = gitDir.status === 0 ? existingReal(directory, gitDir.stdout.trim()) : null;
  const commonDirPath = commonDir.status === 0 ? existingReal(directory, commonDir.stdout.trim()) : null;
  return {
    isRepository: true,
    commit,
    branch: branchName && branchName !== "HEAD" ? branchName : null,
    dirty: status.status === 0 ? status.stdout.length > 0 : false,
    remote,
    gitDir: gitDirPath,
    commonDir: commonDirPath,
    linkedWorktree: gitDirPath !== null && commonDirPath !== null && gitDirPath !== commonDirPath,
  };
}
