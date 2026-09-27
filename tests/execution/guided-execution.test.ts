import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ExecutionSessionSchema,
  applyExecutionArtifactOperations,
  assertNoPersistedSecrets,
  assessExecutionReadiness,
  authorizeScopeExpansion,
  buildEngineeringPlan,
  buildExecutionArtifactOperations,
  createExecutionSessionSnapshot,
  createFeatureSpecification,
  createInspectResult,
  exploreProject,
  isPathAuthorized,
  prepareExecution,
  captureProjectCheckpoint,
  humanDirtyPaths,
  runVerificationTarget,
  renderExecutionSummary,
  loadExecutionInputs,
  nextExecutionSequence,
  validateTrustedVerificationTarget,
} from "../../src/index.js";

function write(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "azevedo-execution-"));
  write(root, "package.json", `${JSON.stringify({
    name: "guided-execution",
    packageManager: "pnpm@11.24.0",
    scripts: { lint: "eslint .", typecheck: "tsc --noEmit", test: "node --test", build: "tsc" },
    dependencies: { "@nestjs/common": "11.0.0", prisma: "6.0.0" },
    devDependencies: { typescript: "5.9.3" },
  })}\n`);
  write(root, "tsconfig.json", "{}\n");
  write(root, "src/realization/realizations.controller.ts", `
import { archiveRealization } from "../application/archive-realization.js";
export class RealizationsController { archive(id: string) { return archiveRealization(id); } }
`);
  write(root, "src/application/archive-realization.ts", `
import { repository } from "../database/realizations-repository.js";
export const archiveRealization = (id: string) => repository.archive(id);
`);
  write(root, "src/database/realizations-repository.ts", `
export const repository = { archive: (id: string) => ({ id, status: "archived" }) };
`);
  write(root, "tests/archive-realization.test.ts", `
import { archiveRealization } from "../src/application/archive-realization.js";
void archiveRealization("id");
`);
  const specification = createFeatureSpecification({
    title: "Adicionar endpoint para arquivar uma realização",
    objective: "Adicionar endpoint para arquivar uma realização",
    expectedBehaviors: ["A realização permanece persistida com status archived."],
    acceptanceCriteria: [{
      id: "ac-archive-realization",
      source: { kind: "user", reference: null },
      statement: "Uma realização ativa pode ser arquivada.",
      scenario: { given: "uma realização ativa", when: "o endpoint é chamado", then: "o status fica archived" },
      prohibitedEffects: ["Não excluir a realização."],
      verificationMethod: "Teste do endpoint e persistência.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project fixture.");
  const plan = buildEngineeringPlan(inspection, specification.objective);
  const explored = exploreProject(root, inspection, plan, specification);
  assert.ok(explored.revision);
  if (!explored.revision) throw new Error("Expected an enriched revision.");
  const checkpoint = {
    schemaVersion: 1 as const,
    head: explored.artifact.sourceRevision.head,
    branch: "azevedo/dogfood",
    gitMode: "linked-worktree" as const,
    status: [],
    subjectRevision: explored.artifact.sourceRevision,
  };
  return { root, inspection, specification, exploration: explored.artifact, revision: explored.revision, checkpoint };
}

test("readiness blocks product decisions and stale sources but permits investigation of technical unknowns", () => {
  const value = fixture();
  const ready = assessExecutionReadiness({ ...value, writeAuthorized: true, requireIsolation: true });
  assert.equal(ready.status, "ready");

  const productBlocked = assessExecutionReadiness({
    ...value,
    specification: { ...value.specification, openQuestions: ["Quem pode arquivar uma realização?"] },
    writeAuthorized: true,
    requireIsolation: true,
  });
  assert.equal(productBlocked.status, "blocked");
  assert.ok(productBlocked.reasons.some((reason) => reason.code === "product-decision-open"));
  assert.equal(productBlocked.unknowns[0]?.category, "product-decision");

  const technical = assessExecutionReadiness({
    ...value,
    exploration: {
      ...value.exploration,
      unknowns: [...value.exploration.unknowns, {
        question: "Which local helper should format the response?",
        status: "remaining" as const,
        resolution: "Investigate within the authorized implementation path.",
        evidenceIds: [],
      }],
    },
    writeAuthorized: true,
    requireIsolation: true,
  });
  assert.equal(technical.status, "ready");
  assert.ok(technical.unknowns.some((unknown) => unknown.category === "technical-unknown" && unknown.disposition === "investigate"));

  const stale = assessExecutionReadiness({
    ...value,
    checkpoint: { ...value.checkpoint, subjectRevision: { ...value.checkpoint.subjectRevision, dirty: !value.checkpoint.subjectRevision.dirty } },
    writeAuthorized: true,
    requireIsolation: true,
  });
  assert.ok(stale.reasons.some((reason) => reason.code === "source-revision-changed"));
});

test("readiness blocks failed exploration, mismatched artifacts, and missing required verification while preserving risk", () => {
  const value = fixture();
  const blocked = assessExecutionReadiness({
    ...value,
    exploration: { ...value.exploration, status: "blocked", stopReason: "blocked-by-ambiguity" },
    writeAuthorized: true,
  });
  assert.ok(blocked.reasons.some((reason) => reason.code === "exploration-blocked"));

  const mismatched = assessExecutionReadiness({
    ...value,
    exploration: { ...value.exploration, planId: "plan-unrelated-12345678" },
    writeAuthorized: true,
  });
  assert.ok(mismatched.reasons.some((reason) => reason.code === "artifacts-invalid"));

  const verification = value.revision.planSnapshot.verification.map((item, index) => index === 0
    ? { ...item, required: true, available: false } : item);
  const unavailable = assessExecutionReadiness({
    ...value,
    revision: { ...value.revision, planSnapshot: { ...value.revision.planSnapshot, verification } },
    writeAuthorized: true,
  });
  assert.ok(unavailable.reasons.some((reason) => reason.code === "verification-unavailable"));

  const critical = prepareExecution({
    ...value,
    revision: {
      ...value.revision,
      planSnapshot: {
        ...value.revision.planSnapshot,
        risk: { ...value.revision.planSnapshot.risk, class: "critical" },
      },
    },
    executionSequence: 1,
    writeAuthorized: true,
  });
  assert.equal(critical.context?.risks.class, "critical");
});

test("preparation selects execution knowledge, enforces context budget, and creates distinct deterministic sessions", () => {
  const value = fixture();
  const first = prepareExecution({ ...value, executionSequence: 1, writeAuthorized: true, maxContextTokens: 6_000 });
  const repeated = prepareExecution({ ...value, executionSequence: 1, writeAuthorized: true, maxContextTokens: 6_000 });
  const second = prepareExecution({ ...value, executionSequence: 2, writeAuthorized: true, maxContextTokens: 6_000 });
  assert.deepEqual(first, repeated);
  assert.equal(first.preparation.readiness.status, "ready");
  assert.ok(first.context);
  assert.ok(first.session);
  assert.notEqual(first.session?.id, second.session?.id);
  assert.ok(first.context?.knowledgeManifest.selected.some((unit) => unit.id === "knowledge.execution.scope-control"));
  assert.ok((first.context?.budget.estimatedTokens ?? Infinity) <= 6_000);
  assert.match(first.instructions ?? "", /# INTENT[\s\S]*# VERIFICATION[\s\S]*# STOP CONDITIONS/);
  assert.equal(first.context?.permissions.allowCommit, false);
  assert.deepEqual(first.context?.acceptanceCriteria, value.revision.acceptanceCriteria);
  assert.deepEqual(first.context?.scope.initialPaths, value.revision.planSnapshot.scope.affectedPaths);
  assert.ok(first.context?.evidence.every((item) => !item.path.startsWith("/")));
  assert.throws(() => prepareExecution({ ...value, executionSequence: 1, writeAuthorized: true, maxContextTokens: 500 }), /exceeds/);
  assert.match(renderExecutionSummary(first.session!, first.context!), /# Execution Summary[\s\S]*Human review recommended/);
  const withEnvironment = prepareExecution({
    ...value,
    specification: { ...value.specification, constraints: ["Read JEV_API_KEY from the environment."] },
    executionSequence: 1,
    writeAuthorized: true,
  });
  assert.deepEqual(withEnvironment.context?.permissions.requiredEnvironmentVariables, ["JEV_API_KEY"]);
});

test("execution artifacts are immutable, reject secrets, and sessions preserve bounded append-only attempts", () => {
  const value = fixture();
  mkdirSync(join(value.root, ".azevedo"), { recursive: true });
  const prepared = prepareExecution({ ...value, executionSequence: 1, writeAuthorized: true });
  const operations = buildExecutionArtifactOperations(value.root, prepared.preparation, prepared.context, prepared.session);
  assert.equal(operations.length, 3);
  applyExecutionArtifactOperations(value.root, operations);
  assert.ok(operations.every((operation) => operation.action !== "conflict"));
  for (const operation of operations) assert.match(readFileSync(join(value.root, operation.artifact), "utf8"), /"schemaVersion": 1/);
  assert.ok(buildExecutionArtifactOperations(value.root, prepared.preparation, prepared.context, prepared.session)
    .every((operation) => operation.action === "unchanged"));
  assert.throws(() => assertNoPersistedSecrets({ note: "JEV_API_KEY=super-secret" }), /Refusing to persist/);
  assert.throws(() => assertNoPersistedSecrets({ note: "password=super-secret" }), /Refusing to persist/);
  assert.throws(() => assertNoPersistedSecrets({ note: "sk-123456789abcdef" }), /Refusing to persist/);
  assert.doesNotThrow(() => assertNoPersistedSecrets({ requiredEnvironmentVariables: ["JEV_API_KEY"] }));

  const session = prepared.session!;
  const attempts = [1, 2, 3].map((sequence) => ({
    sequence,
    objective: `Attempt ${sequence}`,
    outcome: "failed" as const,
    failureCategory: "test-failure" as const,
    diagnosis: "The behavioral check still fails.",
    changedPaths: session.before.status.map((item) => item.path),
    verificationEvidenceIds: [],
  }));
  const third = createExecutionSessionSnapshot(session, {
    status: "in-progress",
    after: null,
    attempts,
    changes: [],
    scopeExpansions: [],
    verificationEvidence: [],
    acceptanceCoverage: session.acceptanceCoverage,
    decisions: ["Retry only after a changed diagnosis."],
  });
  assert.equal(third.snapshotSequence, 2);
  assert.equal(third.parentSnapshotId, session.snapshotId);
  assert.throws(() => createExecutionSessionSnapshot(third, {
    status: "in-progress",
    after: null,
    attempts: [{ ...attempts[0]!, objective: "Rewritten history" }, ...attempts.slice(1)],
    changes: [],
    scopeExpansions: [],
    verificationEvidence: [],
    acceptanceCoverage: third.acceptanceCoverage,
    decisions: third.decisions,
  }), /append-only/);
  assert.throws(() => ExecutionSessionSchema.parse({
    ...third,
    attempts: [...attempts, { ...attempts[0]!, sequence: 4 }],
  }), /bounded recovery/);

  assert.throws(() => ExecutionSessionSchema.parse({
    ...session,
    status: "completed",
    acceptanceCoverage: session.acceptanceCoverage.map((item) => ({ ...item, state: "verified", evidenceIds: ["missing"] })),
  }), /after checkpoint|successful final|lacks passing evidence|Unknown verification evidence/);

  const verificationEvidence = session.requiredVerificationTargetIds.map((targetId, index) => {
    const separator = targetId.indexOf("::");
    const verifierId = targetId.slice(0, separator);
    const scope = targetId.slice(separator + 2);
    return {
      id: `verification-${index}`,
      taskId: session.planId,
      verifierId,
      phase: "verification" as const,
      status: "pass" as const,
      scope,
      command: null,
      startedAt: "2026-09-26T00:00:00.000Z",
      durationMs: 1,
      exitCode: 0,
      subjectRevision: session.before.subjectRevision,
      outputDigest: `sha256:${String(index).padStart(64, "0")}`,
      summary: "Passed.",
      reason: null,
      waiverId: null,
    };
  });
  const completed = ExecutionSessionSchema.parse({
    ...session,
    status: "completed",
    after: session.before,
    attempts: [{
      sequence: 1,
      objective: "Implement acceptance criteria.",
      outcome: "succeeded",
      failureCategory: null,
      diagnosis: null,
      changedPaths: [prepared.context!.scope.initialPaths[0]],
      verificationEvidenceIds: verificationEvidence.map((item) => item.id),
    }],
    changes: [{
      path: prepared.context!.scope.initialPaths[0],
      kind: "modified",
      attempt: 1,
      evidenceIds: [],
    }],
    verificationEvidence,
    acceptanceCoverage: session.acceptanceCoverage.map((item) => ({
      ...item,
      state: "verified",
      changedPaths: [prepared.context!.scope.initialPaths[0]],
      evidenceIds: [verificationEvidence[0]!.id],
      note: "Implementation and required verification passed.",
    })),
  });
  assert.equal(completed.status, "completed");
});

test("scope expansion requires known evidence and verification rejects unknown or destructive scripts", () => {
  const value = fixture();
  const prepared = prepareExecution({ ...value, executionSequence: 1, writeAuthorized: true });
  const context = prepared.context!;
  const evidenceId = context.evidence[0]?.id;
  assert.ok(evidenceId);
  const expansion = authorizeScopeExpansion(value.root, context, {
    path: "tests/new-archive-realization.test.ts",
    reason: "Acceptance needs direct behavioral coverage.",
    basis: "test-coverage",
    evidenceIds: [evidenceId!],
  });
  assert.equal(isPathAuthorized(context, [expansion], expansion.path), true);
  assert.throws(() => authorizeScopeExpansion(value.root, context, {
    ...expansion,
    path: "outside.ts",
    evidenceIds: ["evidence-000000000000"],
  }), /unknown evidence/);

  const lintTarget = value.revision.planSnapshot.verification.find((item) => item.verifierId === "verify.lint");
  assert.ok(lintTarget);
  if (!lintTarget) return;
  assert.equal(validateTrustedVerificationTarget(lintTarget, value.inspection), null);
  const destructiveInspection = {
    ...value.inspection,
    scripts: value.inspection.scripts.map((script) => script.name === lintTarget.script
      ? { ...script, command: "rm -rf dist" } : script),
  };
  assert.match(validateTrustedVerificationTarget(lintTarget, destructiveInspection) ?? "", /Destructive/);
  assert.match(validateTrustedVerificationTarget({ ...lintTarget, script: "made-up" }, value.inspection) ?? "", /not present/);
});

test("verification runtime captures successful and failed trusted scripts and blocks unavailable capabilities", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-verification-runtime-"));
  write(root, "package.json", `${JSON.stringify({
    name: "verification-runtime",
    packageManager: "pnpm@11.24.0",
    scripts: {
      test: "node -e \"process.exit(0)\"",
      build: "node -e \"process.exit(7)\"",
    },
  })}\n`);
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") return;
  const revision = captureProjectCheckpoint(root).subjectRevision;
  const target = (verifierId: "verify.test" | "verify.build", script: string, available = true) => ({
    targetId: `${verifierId}::.`, verifierId, scope: ".", required: true, available,
    packagePath: available ? "." : null, script: available ? script : null,
    riskReduced: "Runtime regression.", evidenceProduced: "Command result.", reason: "Discovered package script.",
  });
  const passed = runVerificationTarget({ taskId: "task", projectRoot: root, inspection, target: target("verify.test", "test"), subjectRevision: revision });
  assert.equal(passed.outcome, "passed");
  assert.equal((passed.evidence as { exitCode: number }).exitCode, 0);
  const failed = runVerificationTarget({ taskId: "task", projectRoot: root, inspection, target: target("verify.build", "build"), subjectRevision: revision });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.failureCategory, "build-failure");
  assert.equal((failed.evidence as { exitCode: number }).exitCode, 7);
  const unavailable = runVerificationTarget({ taskId: "task", projectRoot: root, inspection, target: target("verify.test", "test", false), subjectRevision: revision });
  assert.equal(unavailable.outcome, "blocked");
  assert.equal(unavailable.failureCategory, "environment-failure");
});

test("git checkpoint captures HEAD/status and preserves pre-existing human work without cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-git-checkpoint-"));
  assert.equal(spawnSync("git", ["init"], { cwd: root }).status, 0);
  write(root, "source.ts", "export const value = 1;\n");
  assert.equal(spawnSync("git", ["add", "source.ts"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["-c", "user.name=Azevedo Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"], { cwd: root }).status, 0);
  const clean = captureProjectCheckpoint(root);
  assert.ok(clean.head);
  assert.equal(clean.gitMode, "primary-worktree");
  assert.deepEqual(clean.status, []);
  write(root, "source.ts", "export const value = 2;\n");
  const dirty = captureProjectCheckpoint(root);
  assert.deepEqual(humanDirtyPaths(dirty), ["source.ts"]);
  assert.equal(readFileSync(join(root, "source.ts"), "utf8"), "export const value = 2;\n");
});

test("execution persistence reports conflicts before applying any later artifact", () => {
  const value = fixture();
  mkdirSync(join(value.root, ".azevedo"), { recursive: true });
  const prepared = prepareExecution({ ...value, executionSequence: 1, writeAuthorized: true });
  const first = buildExecutionArtifactOperations(value.root, prepared.preparation, prepared.context, prepared.session);
  applyExecutionArtifactOperations(value.root, first);
  const preparationPath = join(value.root, first[0]!.artifact);
  writeFileSync(preparationPath, "owner content\n");
  const conflicted = buildExecutionArtifactOperations(value.root, prepared.preparation, prepared.context, prepared.session);
  assert.equal(conflicted[0]?.action, "conflict");
  assert.throws(() => applyExecutionArtifactOperations(value.root, conflicted), /no artifact was written/);
  assert.equal(readFileSync(preparationPath, "utf8"), "owner content\n");
});

test("execution loading fails closed for missing revisions and unsafe execution storage", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-execution-loading-"));
  mkdirSync(join(root, ".azevedo", "plans"), { recursive: true });
  assert.throws(() => loadExecutionInputs(root, "plan-revision-1-12345678"), /not found/);
  const external = mkdtempSync(join(tmpdir(), "azevedo-execution-external-"));
  symlinkSync(external, join(root, ".azevedo", "executions"));
  assert.throws(() => nextExecutionSequence(root), /not a safe directory/);
});
