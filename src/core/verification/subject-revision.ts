import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { SubjectRevision } from "../schemas/evidence.js";
import { SubjectRevisionSchema } from "../schemas/evidence.js";

const IGNORED = new Set([".git", ".azevedo", "node_modules", "dist", "coverage", ".next"]);

function sha256(chunks: readonly (string | Buffer)[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

function portable(path: string): string {
  return path.split(sep).join("/");
}

function collectFiles(root: string, directory = root): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (IGNORED.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(root, path) : [path];
  }).sort();
}

function snapshotFiles(root: string, files: readonly string[]): (string | Buffer)[] {
  return files.flatMap((path) => {
    try {
      const content = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
      return [portable(relative(root, path)), "\0", content, "\0"];
    } catch {
      return [portable(relative(root, path)), "\0<unreadable>\0"];
    }
  });
}

export function captureSubjectRevision(projectRoot: string): SubjectRevision {
  const root = resolve(projectRoot);
  const headResult = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8" });
  const gitRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  const statusResult = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], {
    cwd: root,
    encoding: "utf8",
  });

  if (statusResult.status !== 0 || gitRootResult.status !== 0) {
    const files = collectFiles(root);
    return SubjectRevisionSchema.parse({
      head: null,
      worktreeDigest: sha256(snapshotFiles(root, files)),
      dirty: files.length > 0,
    });
  }

  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  const gitRoot = gitRootResult.stdout.trim();
  const status = statusResult.stdout;
  const diff = spawnSync("git", ["diff", "--binary", "--no-ext-diff", "--", "."], { cwd: root, encoding: "buffer" });
  const staged = spawnSync("git", ["diff", "--cached", "--binary", "--no-ext-diff", "--", "."], { cwd: root, encoding: "buffer" });
  const untracked = status
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => join(gitRoot, entry.slice(3)))
    .filter((path) => existsSync(path));

  return SubjectRevisionSchema.parse({
    head,
    worktreeDigest: sha256([
      status,
      diff.stdout ?? Buffer.alloc(0),
      staged.stdout ?? Buffer.alloc(0),
      ...snapshotFiles(root, untracked),
    ]),
    dirty: status.length > 0,
  });
}
