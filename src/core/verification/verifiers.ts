import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { CommandEffect, EvidenceRecord, SubjectRevision } from "../schemas/evidence.js";
import { EvidenceRecordSchema } from "../schemas/evidence.js";
import { captureSubjectRevision } from "./subject-revision.js";
import {
  captureWorkspaceFileState,
  changedWorkspacePaths,
  commandEffectAssessment,
} from "./command-effect.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function evidenceId(
  verifierId: string,
  startedAt: string,
  outputDigest: string,
  taskId: string,
  scope: string,
  phase: string,
): string {
  return createHash("sha256")
    .update(`${taskId}:${verifierId}:${scope}:${phase}:${startedAt}:${outputDigest}`)
    .digest("hex")
    .slice(0, 16);
}

export function runFilePresenceVerifier(input: {
  taskId: string;
  root: string;
  scope: string;
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
    id: evidenceId("verify.files", startedAt, outputDigest, input.taskId, input.scope, "verification"),
    taskId: input.taskId,
    verifierId: "verify.files",
    phase: "verification",
    status: missing.length === 0 && invalid.length === 0 ? "pass" : "fail",
    scope: input.scope,
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
  taskId: string;
  root: string;
  scope: string;
  packageManager: keyof typeof PACKAGE_MANAGER_COMMANDS;
  script: string;
  verifierId: "verify.lint" | "verify.typecheck" | "verify.test" | "verify.build";
  phase?: "verification" | "tdd-red" | "tdd-green";
  subjectRevision: SubjectRevision;
  timeoutMs?: number;
  subjectRoot?: string;
  commandEffect?: CommandEffect;
  commandEffectBasis?: readonly string[];
}): EvidenceRecord {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const [executable, args] = PACKAGE_MANAGER_COMMANDS[input.packageManager](input.script);
  const subjectRoot = resolve(input.subjectRoot ?? input.root);
  const declared = input.commandEffect ?? "unknown";
  const basis = input.commandEffectBasis ?? ["No static command-effect classification was supplied."];
  const before = captureSubjectRevision(subjectRoot);
  const beforeFiles = captureWorkspaceFileState(subjectRoot);
  const staleSubject = before.head !== input.subjectRevision.head ||
    before.worktreeDigest !== input.subjectRevision.worktreeDigest ||
    before.dirty !== input.subjectRevision.dirty;

  if (declared === "mutating" || staleSubject) {
    const summary = declared === "mutating"
      ? `${input.script} was not executed because mutating commands cannot be used as verification.`
      : `${input.script} was not executed because the supplied subject revision is stale.`;
    const outputDigest = digest(summary);
    return EvidenceRecordSchema.parse({
      id: evidenceId(input.verifierId, startedAt, outputDigest, input.taskId, input.scope, input.phase ?? "verification"),
      taskId: input.taskId,
      verifierId: input.verifierId,
      phase: input.phase ?? "verification",
      status: "fail",
      scope: input.scope,
      command: null,
      startedAt,
      durationMs: Date.now() - started,
      exitCode: null,
      subjectRevision: before,
      outputDigest,
      summary,
      reason: null,
      waiverId: null,
      commandEffect: {
        declared,
        basis: [...basis],
        observed: "not-run",
        unexpected: false,
        affectedPaths: [],
        before,
        after: null,
      },
    });
  }
  const result = spawnSync(executable, args, {
    cwd: resolve(input.root),
    encoding: "utf8",
    shell: false,
    timeout: input.timeoutMs ?? 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const after = captureSubjectRevision(subjectRoot);
  const affectedPaths = changedWorkspacePaths(beforeFiles, captureWorkspaceFileState(subjectRoot));
  const assessment = commandEffectAssessment({ declared, basis, before, after, affectedPaths });
  const outputDigest = digest(`${output}\ncommand-effect:${JSON.stringify(assessment)}`);
  const exitCode = result.status;
  const commandPassed = exitCode === 0 && !result.error;
  const passed = commandPassed && affectedPaths.length === 0;
  const summary = affectedPaths.length > 0
    ? `${input.script} changed verification-visible files: ${affectedPaths.join(", ")}. Changes were preserved for inspection.`
    : passed
    ? `${input.script} completed successfully.`
    : `${input.script} failed${result.error ? `: ${result.error.message}` : ` with exit code ${String(exitCode)}`}.`;

  return EvidenceRecordSchema.parse({
    id: evidenceId(input.verifierId, startedAt, outputDigest, input.taskId, input.scope, input.phase ?? "verification"),
    taskId: input.taskId,
    verifierId: input.verifierId,
    phase: input.phase ?? "verification",
    status: passed ? "pass" : "fail",
    scope: input.scope,
    command: [executable, ...args],
    startedAt,
    durationMs: Date.now() - started,
    exitCode,
    subjectRevision: after,
    outputDigest,
    summary,
    reason: null,
    waiverId: null,
    commandEffect: assessment,
  });
}
