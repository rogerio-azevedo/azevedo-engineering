import { resolve } from "node:path";
import { z } from "zod";
import type { ProjectInspectResult } from "../inspection/inspect-result.js";
import type { SubjectRevision } from "../schemas/evidence.js";
import {
  ExecutionFailureCategorySchema,
  type ProjectCheckpoint,
} from "../execution/execution-contracts.js";
import { captureProjectCheckpoint, sameWorkspace } from "../execution/project-checkpoint.js";
import { VerificationPlanItemSchema, type VerificationPlanItemInput } from "./verification-plan.js";
import { runFilePresenceVerifier, runPackageScriptVerifier } from "./verifiers.js";
import { classifyCommandEffect } from "./command-effect.js";

const DESTRUCTIVE_SCRIPT = /(?:^|[\s;&|])(?:rm\b|sudo\b|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|curl\b[^\n]*\|\s*(?:sh|bash)|wget\b[^\n]*\|\s*(?:sh|bash))/i;

export const VerificationRuntimeResultSchema = z.object({
  attempt: z.number().int().positive(),
  targetId: z.string().min(1),
  outcome: z.enum(["passed", "failed", "blocked"]),
  failureCategory: ExecutionFailureCategorySchema.nullable(),
  reason: z.string().min(1).nullable(),
  evidence: z.unknown().nullable(),
}).strict();

export function validateTrustedVerificationTarget(item: VerificationPlanItemInput, inspection: ProjectInspectResult): string | null {
  const target = VerificationPlanItemSchema.parse(item);
  if (!target.available) return "Verification target is unavailable.";
  if (target.verifierId === "verify.files") return null;
  if (!target.script || !target.packagePath) return "Script verification lacks a discovered script or package path.";
  if (!inspection.packageManager.value) return "Package manager is not unambiguously detected by current inspection evidence.";
  const discovered = inspection.scripts.find((script) =>
    script.name === target.script && script.packagePath === target.packagePath,
  );
  if (!discovered) return "Verification script is not present in the current inspection evidence.";
  if (DESTRUCTIVE_SCRIPT.test(discovered.command)) return `Destructive verification command denied: ${discovered.name}.`;
  if (classifyCommandEffect(discovered.command).effect === "mutating") {
    return `Mutating verification command denied: ${discovered.name}.`;
  }
  return null;
}

function failureCategory(verifierId: string, reason: string | null) {
  if (reason?.includes("Mutating verification command")) return "command-side-effect" as const;
  if (reason) return "environment-failure" as const;
  if (verifierId === "verify.test") return "test-failure" as const;
  if (verifierId === "verify.typecheck") return "typecheck-failure" as const;
  if (verifierId === "verify.build") return "build-failure" as const;
  return "implementation-error" as const;
}

export function runVerificationTarget(input: {
  taskId: string;
  projectRoot: string;
  inspection: ProjectInspectResult;
  target: VerificationPlanItemInput;
  subjectRevision: SubjectRevision;
  requiredPaths?: readonly string[];
  timeoutMs?: number;
  attempt?: number;
  authorizedCheckpoint?: ProjectCheckpoint;
  requireIsolatedWorkspace?: boolean;
}) {
  const target = VerificationPlanItemSchema.parse(input.target);
  const denied = validateTrustedVerificationTarget(target, input.inspection);
  if (denied) return VerificationRuntimeResultSchema.parse({
    attempt: input.attempt ?? 1,
    targetId: target.targetId,
    outcome: "blocked",
    failureCategory: failureCategory(target.verifierId, denied),
    reason: denied,
    evidence: null,
  });
  let currentCheckpoint: ProjectCheckpoint | null = null;
  if (target.verifierId !== "verify.files") {
    currentCheckpoint = captureProjectCheckpoint(input.projectRoot);
    if (!input.authorizedCheckpoint || !sameWorkspace(currentCheckpoint, input.authorizedCheckpoint)) {
      return VerificationRuntimeResultSchema.parse({
        attempt: input.attempt ?? 1,
        targetId: target.targetId,
        outcome: "blocked",
        failureCategory: "workspace-mismatch",
        reason: "Verification commands require the checkpoint of the same explicitly authorized workspace.",
        evidence: null,
      });
    }
    if ((input.requireIsolatedWorkspace ?? true) && currentCheckpoint.gitMode !== "linked-worktree") {
      return VerificationRuntimeResultSchema.parse({
        attempt: input.attempt ?? 1,
        targetId: target.targetId,
        outcome: "blocked",
        failureCategory: "workspace-mismatch",
        reason: "Verification commands that can affect project state require an authorized linked worktree.",
        evidence: null,
      });
    }
    const current = currentCheckpoint.subjectRevision;
    if (current.head !== input.subjectRevision.head ||
      current.worktreeDigest !== input.subjectRevision.worktreeDigest ||
      current.dirty !== input.subjectRevision.dirty) {
      return VerificationRuntimeResultSchema.parse({
        attempt: input.attempt ?? 1,
        targetId: target.targetId,
        outcome: "blocked",
        failureCategory: "workspace-mismatch",
        reason: "Verification subject revision no longer matches the authorized workspace state.",
        evidence: null,
      });
    }
  }
  const discoveredCommand = target.script && target.packagePath
    ? input.inspection.scripts.find((script) => script.name === target.script && script.packagePath === target.packagePath)?.command
    : undefined;
  const effect = discoveredCommand
    ? classifyCommandEffect(discoveredCommand)
    : { effect: target.commandEffect, basis: target.commandEffectBasis };
  const evidence = target.verifierId === "verify.files"
    ? runFilePresenceVerifier({
      taskId: input.taskId,
      root: input.projectRoot,
      scope: target.scope,
      requiredPaths: input.requiredPaths ?? [],
      subjectRevision: input.subjectRevision,
    })
    : runPackageScriptVerifier({
      taskId: input.taskId,
      root: resolve(input.projectRoot, target.packagePath ?? "."),
      scope: target.scope,
      packageManager: input.inspection.packageManager.value!,
      script: target.script ?? "",
      verifierId: target.verifierId as "verify.lint" | "verify.typecheck" | "verify.test" | "verify.build",
      subjectRevision: currentCheckpoint?.subjectRevision ?? input.subjectRevision,
      subjectRoot: input.projectRoot,
      commandEffect: effect.effect,
      commandEffectBasis: effect.basis,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    });
  const sideEffect = evidence.commandEffect?.observed === "changed";
  return VerificationRuntimeResultSchema.parse({
    attempt: input.attempt ?? 1,
    targetId: target.targetId,
    outcome: evidence.status === "pass" ? "passed" : "failed",
    failureCategory: evidence.status === "pass"
      ? null
      : sideEffect ? "command-side-effect" : failureCategory(target.verifierId, null),
    reason: evidence.status === "pass" ? null : evidence.summary,
    evidence,
  });
}
