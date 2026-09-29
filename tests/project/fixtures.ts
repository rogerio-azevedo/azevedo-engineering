import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitIdentity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-02T00:00:00Z",
};

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function write(directory: string, relativePath: string, content: string): void {
  const destination = join(directory, relativePath);
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, content);
}

export function git(directory: string, args: readonly string[], dates = gitIdentity): string {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, ...dates },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? "").trim();
}

export function initRepo(directory: string, dates = gitIdentity): void {
  mkdirSync(directory, { recursive: true });
  git(directory, ["init", "-b", "main"], dates);
}

export function commitAll(directory: string, message: string, dates = gitIdentity): void {
  git(directory, ["add", "-A"], dates);
  git(directory, ["commit", "-m", message], dates);
}

export function writePackage(directory: string, dependencies: Record<string, string>, scripts: Record<string, string> = {}): void {
  write(directory, "package.json", `${JSON.stringify({ name: "fixture", private: true, scripts, dependencies }, null, 2)}\n`);
}

export { gitIdentity };
