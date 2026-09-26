import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { EvidenceRecord, SubjectRevision } from "../schemas/evidence.js";
import { EvidenceRecordSchema } from "../schemas/evidence.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function evidenceId(verifierId: string, startedAt: string, outputDigest: string): string {
  return createHash("sha256").update(`${verifierId}:${startedAt}:${outputDigest}`).digest("hex").slice(0, 16);
}

export function runFilePresenceVerifier(input: {
  root: string;
  requiredPaths: readonly string[];
  subjectRevision: SubjectRevision;
}): EvidenceRecord {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const root = resolve(input.root);
  const invalid = input.requiredPaths.filter((path) => {
    const relativePath = relative(root, resolve(root, path));
    return isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`);
  });
  const missing = input.requiredPaths.filter((path) => !invalid.includes(path) && !existsSync(resolve(root, path)));
  const summary = invalid.length > 0
    ? `Paths outside the project root are not allowed: ${invalid.join(", ")}`
    : missing.length === 0
    ? `All ${input.requiredPaths.length} required paths are present.`
    : `Missing required paths: ${missing.join(", ")}`;
  const outputDigest = digest(summary);

  return EvidenceRecordSchema.parse({
    id: evidenceId("verify.files", startedAt, outputDigest),
    verifierId: "verify.files",
    status: missing.length === 0 && invalid.length === 0 ? "pass" : "fail",
    scope: root,
    command: null,
    startedAt,
    durationMs: Date.now() - started,
    exitCode: missing.length === 0 && invalid.length === 0 ? 0 : 1,
    subjectRevision: input.subjectRevision,
    outputDigest,
    summary,
    reason: null,
    waiverId: null,
  });
}

const PACKAGE_MANAGER_COMMANDS = {
  npm: (script: string) => ["npm", ["run", script]] as const,
  pnpm: (script: string) => ["pnpm", ["run", script]] as const,
  yarn: (script: string) => ["yarn", ["run", script]] as const,
  bun: (script: string) => ["bun", ["run", script]] as const,
};

export function runPackageScriptVerifier(input: {
  root: string;
  packageManager: keyof typeof PACKAGE_MANAGER_COMMANDS;
  script: string;
  verifierId: "verify.lint" | "verify.typecheck" | "verify.test" | "verify.build";
  subjectRevision: SubjectRevision;
  timeoutMs?: number;
}): EvidenceRecord {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const [executable, args] = PACKAGE_MANAGER_COMMANDS[input.packageManager](input.script);
  const result = spawnSync(executable, args, {
    cwd: resolve(input.root),
    encoding: "utf8",
    shell: false,
    timeout: input.timeoutMs ?? 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const outputDigest = digest(output);
  const exitCode = result.status;
  const passed = exitCode === 0 && !result.error;
  const summary = passed
    ? `${input.script} completed successfully.`
    : `${input.script} failed${result.error ? `: ${result.error.message}` : ` with exit code ${String(exitCode)}`}.`;

  return EvidenceRecordSchema.parse({
    id: evidenceId(input.verifierId, startedAt, outputDigest),
    verifierId: input.verifierId,
    status: passed ? "pass" : "fail",
    scope: resolve(input.root),
    command: [executable, ...args],
    startedAt,
    durationMs: Date.now() - started,
    exitCode,
    subjectRevision: input.subjectRevision,
    outputDigest,
    summary,
    reason: null,
    waiverId: null,
  });
}
