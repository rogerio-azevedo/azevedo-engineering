import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CommandEffectSchema,
  type CommandEffect,
  type SubjectRevision,
} from "../schemas/evidence.js";

export type CommandEffectClassification = {
  effect: CommandEffect;
  basis: string[];
};

export type WorkspaceFileState = ReadonlyMap<string, string>;

const MUTATING_SIGNAL = /(?:^|\s)(?:--fix(?:\s|$)|--write(?:\s|$)|--update(?:\s|$)|-w(?:\s|$)|prisma\s+(?:migrate|db\s+push|generate)|drizzle-kit\s+(?:push|generate|migrate)|(?:eslint|biome|prettier)\b[^\n]*(?:--fix|--write)|(?:generate|codegen|format)(?::|\s|$))/i;
const MAY_MUTATE_SIGNAL = /(?:^|\s)(?:build|test|e2e|integration|compile|bundle|next\s+build|nest\s+build|tsc\b(?![^\n]*--noEmit))/i;
const READ_ONLY_SIGNAL = /(?:^|\s)(?:tsc\b[^\n]*--noEmit|eslint\b(?![^\n]*--fix)|biome\s+check\b(?![^\n]*--write)|prettier\b[^\n]*--check|vitest\b[^\n]*--run|node\s+--test)(?:\s|$)/i;
const EXCLUDED_DIRECTORIES = new Set([".git", ".azevedo", "node_modules", "dist", "build", ".next", "coverage"]);

function digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function portable(path: string): string {
  return path.split(sep).join("/");
}

export function classifyCommandEffect(command: string): CommandEffectClassification {
  if (MUTATING_SIGNAL.test(command)) return {
    effect: "mutating",
    basis: ["The discovered command contains a known write or generation signal."],
  };
  if (MAY_MUTATE_SIGNAL.test(command)) return {
    effect: "may-mutate",
    basis: ["The command class commonly produces local artifacts and requires an observed before/after check."],
  };
  if (READ_ONLY_SIGNAL.test(command)) return {
    effect: "read-only",
    basis: ["The command uses a recognized non-writing validation mode; runtime observation remains authoritative."],
  };
  return {
    effect: "unknown",
    basis: ["No trusted effect rule describes the discovered command; runtime observation is required."],
  };
}

function gitVisiblePaths(root: string): string[] | null {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return null;
  return result.stdout.split("\0").filter(Boolean).map(portable).sort();
}

function visiblePaths(root: string): string[] {
  const gitPaths = gitVisiblePaths(root);
  if (gitPaths) return gitPaths;
  const paths: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolute = resolve(directory, entry.name);
      const path = portable(relative(root, absolute));
      if (entry.isDirectory()) walk(absolute);
      else paths.push(path);
    }
  };
  walk(root);
  return paths.sort();
}

export function captureWorkspaceFileState(projectRoot: string): WorkspaceFileState {
  const root = resolve(projectRoot);
  const state = new Map<string, string>();
  for (const path of visiblePaths(root)) {
    const absolute = resolve(root, path);
    const stats = lstatSync(absolute);
    const content = stats.isSymbolicLink() ? `symlink:${readlinkSync(absolute)}` : readFileSync(absolute);
    state.set(path, digest(content));
  }
  return state;
}

export function changedWorkspacePaths(before: WorkspaceFileState, after: WorkspaceFileState): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

export function commandEffectAssessment(input: {
  declared: CommandEffect;
  basis: readonly string[];
  before: SubjectRevision;
  after: SubjectRevision;
  affectedPaths: readonly string[];
}) {
  const declared = CommandEffectSchema.parse(input.declared);
  const changed = input.affectedPaths.length > 0;
  return {
    declared,
    basis: [...input.basis],
    observed: changed ? "changed" as const : "unchanged" as const,
    unexpected: changed && declared === "read-only",
    affectedPaths: [...input.affectedPaths],
    before: input.before,
    after: input.after,
  };
}
