import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  EvidenceRecordSchema,
  TddDecisionSchema,
  WaiverSchema,
  captureSubjectRevision,
  classifyTask,
  evaluateDefinitionOfDone,
  inspectProject,
  resolveVerificationPlan,
  runFilePresenceVerifier,
  runPackageScriptVerifier,
} from "../../src/index.js";

const fixture = resolve("tests/fixtures/single-repo");
const monorepo = resolve("tests/fixtures/monorepo");

test("verification planning exposes required capabilities that are unavailable", () => {
  const inspection = inspectProject(fixture);
  const classification = classifyTask({
    taskId: "task-authorization",
    title: "Alterar regras de autorização",
    type: "security",
    signals: ["authorization"],
  });
  const plan = resolveVerificationPlan(inspection, classification);
  const lint = plan.find((item) => item.verifierId === "verify.lint");

  assert.equal(lint?.required, true);
  assert.equal(lint?.available, false);
  assert.match(lint?.reason ?? "", /no script is declared/);
});

test("verification planning selects the affected monorepo package instead of the first script", () => {
  const inspection = inspectProject(monorepo);
  const classification = classifyTask({
    taskId: "task-web-regression",
    title: "Corrigir falha no formulário web",
    type: "bugfix",
    reproducibleBug: true,
    affectedPaths: ["apps/web/src/form.tsx"],
  });
  const plan = resolveVerificationPlan(inspection, classification);
  const testTargets = plan.filter((item) => item.verifierId === "verify.test");

  assert.equal(testTargets.length, 1);
  assert.equal(testTargets[0]?.scope, "apps/web");
  assert.equal(testTargets[0]?.packagePath, "apps/web");
  assert.equal(testTargets[0]?.script, "test");
  assert.ok(!plan.some((item) => item.scope === "apps/api"));
});

test("verification planning creates independent targets for two affected workspaces", () => {
  const inspection = inspectProject(monorepo);
  const classification = classifyTask({
    taskId: "task-api-web",
    title: "Corrigir regressão compartilhada entre API e web",
    type: "bugfix",
    reproducibleBug: true,
    affectedPaths: ["apps/api/src/handler.ts", "apps/web/src/client.ts"],
  });
  const testTargets = resolveVerificationPlan(inspection, classification)
    .filter((item) => item.verifierId === "verify.test");

  assert.deepEqual(testTargets.map((item) => item.scope), ["apps/api", "apps/web"]);
  assert.deepEqual(testTargets.map((item) => item.packagePath), ["apps/api", "apps/web"]);
});

test("structured target scopes propagate shared changes to known consumers", () => {
  const inspection = inspectProject(monorepo);
  const classification = classifyTask({
    taskId: "task-shared-consumers",
    title: "Alterar contrato compartilhado usado pela API e pela web",
    type: "business_behavior",
    affectedPaths: ["packages/shared/src/contract.ts"],
    targetScopes: ["apps/api", "apps/web"],
  });
  const plan = resolveVerificationPlan(inspection, classification);
  const fileScopes = plan
    .filter((item) => item.verifierId === "verify.files")
    .map((item) => item.scope);

  assert.deepEqual(fileScopes, ["apps/api", "apps/web", "packages/shared"]);
  assert.ok(plan.some((item) => item.targetId === "verify.test::apps/api" && item.available));
  assert.ok(plan.some((item) => item.targetId === "verify.test::apps/web" && item.available));
  assert.ok(plan.some((item) => item.targetId === "verify.test::packages/shared" && !item.available));
});

test("single-repo verification remains scoped to the root package", () => {
  const inspection = inspectProject(fixture);
  const classification = classifyTask({
    taskId: "task-single-repo",
    title: "Corrigir erro no serviço existente",
    type: "bugfix",
    reproducibleBug: true,
    affectedPaths: ["src/index.ts"],
  });
  const plan = resolveVerificationPlan(inspection, classification);
  const testTarget = plan.find((item) => item.verifierId === "verify.test");

  assert.equal(testTarget?.scope, ".");
  assert.equal(testTarget?.packagePath, ".");
  assert.equal(testTarget?.script, "test");
});

test("file and package-script verifiers produce task, scope, and revision-bound evidence", () => {
  const revision = captureSubjectRevision(fixture);
  const files = runFilePresenceVerifier({
    taskId: "task-verifiers",
    root: fixture,
    scope: ".",
    requiredPaths: ["package.json", "src/index.ts"],
    subjectRevision: revision,
  });
  const script = runPackageScriptVerifier({
    taskId: "task-verifiers",
    root: fixture,
    scope: ".",
    packageManager: "npm",
    script: "test",
    verifierId: "verify.test",
    subjectRevision: revision,
  });

  assert.equal(files.status, "pass");
  assert.equal(script.status, "pass");
  assert.equal(script.taskId, "task-verifiers");
  assert.equal(script.scope, ".");
  assert.deepEqual(script.command, ["npm", "run", "test"]);
  assert.deepEqual(script.subjectRevision, revision);
});

test("file verifier rejects paths outside the inspected project", () => {
  const revision = captureSubjectRevision(fixture);
  const result = runFilePresenceVerifier({
    taskId: "task-files",
    root: fixture,
    scope: ".",
    requiredPaths: ["../../package.json"],
    subjectRevision: revision,
  });

  assert.equal(result.status, "fail");
  assert.match(result.summary, /outside the project root/);
});

test("subject revision changes when untracked content changes", () => {
  const root = mkdtempSync(resolve(tmpdir(), "azevedo-revision-"));
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0);
  writeFileSync(resolve(root, "subject.txt"), "before\n");
  const before = captureSubjectRevision(root);
  writeFileSync(resolve(root, "subject.txt"), "after\n");
  const after = captureSubjectRevision(root);

  assert.notEqual(before.worktreeDigest, after.worktreeDigest);
});

test("subject revision distinguishes clean, unstaged, staged, and untracked states", () => {
  const root = mkdtempSync(resolve(tmpdir(), "azevedo-git-states-"));
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0);
  writeFileSync(resolve(root, "tracked.txt"), "baseline\n");
  assert.equal(spawnSync("git", ["add", "tracked.txt"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", [
    "-c", "user.name=Azevedo Test", "-c", "user.email=test@example.com",
    "commit", "--quiet", "-m", "baseline",
  ], { cwd: root }).status, 0);

  const clean = captureSubjectRevision(root);
  writeFileSync(resolve(root, "tracked.txt"), "unstaged\n");
  const unstaged = captureSubjectRevision(root);
  assert.equal(spawnSync("git", ["add", "tracked.txt"], { cwd: root }).status, 0);
  const staged = captureSubjectRevision(root);
  writeFileSync(resolve(root, "untracked.txt"), "untracked\n");
  const untracked = captureSubjectRevision(root);

  assert.equal(clean.dirty, false);
  assert.equal(unstaged.dirty, true);
  assert.equal(staged.dirty, true);
  assert.equal(untracked.dirty, true);
  assert.equal(new Set([
    clean.worktreeDigest,
    unstaged.worktreeDigest,
    staged.worktreeDigest,
    untracked.worktreeDigest,
  ]).size, 4);
});

test("Definition of Done rejects stale evidence and open blocking findings", () => {
  const current = captureSubjectRevision(fixture);
  const stale = { ...current, worktreeDigest: `sha256:${"f".repeat(64)}` };
  const evidence = EvidenceRecordSchema.parse({
    id: "test-evidence",
    taskId: "task-dod",
    verifierId: "verify.test",
    phase: "verification",
    status: "pass",
    scope: ".",
    command: ["npm", "run", "test"],
    startedAt: "2026-09-26T12:00:00.000Z",
    durationMs: 1,
    exitCode: 0,
    subjectRevision: stale,
    outputDigest: `sha256:${"a".repeat(64)}`,
    summary: "Passed.",
    reason: null,
    waiverId: null,
  });
  const tddDecision = TddDecisionSchema.parse({
    taskId: "task-dod",
    scope: ".",
    status: "not_applicable",
    expectation: "not_applicable",
    reason: "No new behavior.",
    redEvidenceId: null,
    greenEvidenceId: null,
    waiverId: null,
  });
  const result = evaluateDefinitionOfDone({
    taskId: "task-dod",
    requiredTargets: [{ verifierId: "verify.test", scope: "." }],
    evidence: [evidence],
    findings: [{
      id: "finding-1",
      taskId: "task-dod",
      kind: "security",
      severity: "high",
      confidence: 0.95,
      title: "Missing authorization",
      location: null,
      failureMode: "An unauthorized caller can reach the operation.",
      impact: "Protected data can be read.",
      evidence: ["No guard is registered."],
      status: "open",
    }],
    waivers: [],
    acceptanceCriteria: [{ id: "acceptance-1", satisfied: true, evidenceIds: [evidence.id] }],
    tddDecision,
    subjectRevision: current,
  });

  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((reason) => reason.includes("different revision")));
  assert.ok(result.reasons.some((reason) => reason.includes("finding-1")));
});

test("evidence from one monorepo scope cannot satisfy another target", () => {
  const current = captureSubjectRevision(fixture);
  const evidence = EvidenceRecordSchema.parse({
    id: "api-test-evidence",
    taskId: "task-web-scope",
    verifierId: "verify.test",
    phase: "verification",
    status: "pass",
    scope: "apps/api",
    command: ["pnpm", "test"],
    startedAt: "2026-09-26T12:00:00.000Z",
    durationMs: 1,
    exitCode: 0,
    subjectRevision: current,
    outputDigest: `sha256:${"9".repeat(64)}`,
    summary: "API passed.",
    reason: null,
    waiverId: null,
  });
  const decision = TddDecisionSchema.parse({
    taskId: "task-web-scope",
    scope: "apps/web",
    status: "not_applicable",
    expectation: "not_applicable",
    reason: "No new behavior.",
    redEvidenceId: null,
    greenEvidenceId: null,
    waiverId: null,
  });
  const result = evaluateDefinitionOfDone({
    taskId: "task-web-scope",
    requiredTargets: [{ verifierId: "verify.test", scope: "apps/web" }],
    evidence: [evidence],
    findings: [],
    waivers: [],
    acceptanceCriteria: [],
    tddDecision: decision,
    subjectRevision: current,
  });

  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes("Required target verify.test::apps/web has no evidence."));
});

test("skipped evidence cannot satisfy a required target", () => {
  const current = captureSubjectRevision(fixture);
  const evidence = EvidenceRecordSchema.parse({
    id: "skipped-test-evidence",
    taskId: "task-skipped-gate",
    verifierId: "verify.test",
    phase: "verification",
    status: "skipped",
    scope: ".",
    command: null,
    startedAt: "2026-09-26T12:00:00.000Z",
    durationMs: 0,
    exitCode: null,
    subjectRevision: current,
    outputDigest: `sha256:${"8".repeat(64)}`,
    summary: "Not executed.",
    reason: "Test environment unavailable.",
    waiverId: null,
  });
  const decision = TddDecisionSchema.parse({
    taskId: "task-skipped-gate",
    scope: ".",
    status: "not_applicable",
    expectation: "not_applicable",
    reason: "No new behavior.",
    redEvidenceId: null,
    greenEvidenceId: null,
    waiverId: null,
  });
  const result = evaluateDefinitionOfDone({
    taskId: "task-skipped-gate",
    requiredTargets: [{ verifierId: "verify.test", scope: "." }],
    evidence: [evidence],
    findings: [],
    waivers: [],
    acceptanceCriteria: [],
    tddDecision: decision,
    subjectRevision: current,
  });

  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes("Required target verify.test::. is skipped."));
});

test("TDD cannot be satisfied by arbitrary RED and GREEN ids", () => {
  const current = captureSubjectRevision(fixture);
  const decision = TddDecisionSchema.parse({
    taskId: "task-tdd-ids",
    scope: ".",
    status: "applied",
    expectation: "required",
    reason: "Reproducible regression.",
    redEvidenceId: "banana",
    greenEvidenceId: "abacaxi",
    waiverId: null,
  });
  const result = evaluateDefinitionOfDone({
    taskId: "task-tdd-ids",
    requiredTargets: [],
    evidence: [],
    findings: [],
    waivers: [],
    acceptanceCriteria: [],
    tddDecision: decision,
    subjectRevision: current,
  });

  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((reason) => reason.includes("banana") && reason.includes("does not exist")));
  assert.ok(result.reasons.some((reason) => reason.includes("abacaxi") && reason.includes("does not exist")));
});

test("TDD RED and GREEN must be ordered executions of the same task, verifier, and scope", () => {
  const current = captureSubjectRevision(fixture);
  const redRevision = { ...current, worktreeDigest: `sha256:${"b".repeat(64)}` };
  const red = EvidenceRecordSchema.parse({
    id: "red-evidence",
    taskId: "task-tdd-valid",
    verifierId: "verify.test",
    phase: "tdd-red",
    status: "fail",
    scope: "apps/api",
    command: ["pnpm", "test"],
    startedAt: "2026-09-26T12:00:00.000Z",
    durationMs: 10,
    exitCode: 1,
    subjectRevision: redRevision,
    outputDigest: `sha256:${"c".repeat(64)}`,
    summary: "Regression reproduced.",
    reason: null,
    waiverId: null,
  });
  const green = EvidenceRecordSchema.parse({
    ...red,
    id: "green-evidence",
    phase: "tdd-green",
    status: "pass",
    startedAt: "2026-09-26T12:05:00.000Z",
    exitCode: 0,
    subjectRevision: current,
    outputDigest: `sha256:${"d".repeat(64)}`,
    summary: "Regression fixed.",
  });
  const decision = TddDecisionSchema.parse({
    taskId: "task-tdd-valid",
    scope: "apps/api",
    status: "applied",
    expectation: "required",
    reason: "Reproducible regression.",
    redEvidenceId: red.id,
    greenEvidenceId: green.id,
    waiverId: null,
  });
  const evaluateCycle = (redEvidence: typeof red, greenEvidence: typeof green) => evaluateDefinitionOfDone({
    taskId: "task-tdd-valid",
    requiredTargets: [],
    evidence: [redEvidence, greenEvidence],
    findings: [],
    waivers: [],
    acceptanceCriteria: [],
    tddDecision: TddDecisionSchema.parse({
      ...decision,
      redEvidenceId: redEvidence.id,
      greenEvidenceId: greenEvidence.id,
    }),
    subjectRevision: current,
  });
  const forgedRed = EvidenceRecordSchema.parse({
    ...red,
    id: "forged-red-evidence",
    status: "pass",
    exitCode: 0,
    summary: "This was not a failing RED run.",
  });
  const forgedDecision = TddDecisionSchema.parse({ ...decision, redEvidenceId: forgedRed.id });
  const forgedResult = evaluateDefinitionOfDone({
    taskId: "task-tdd-valid",
    requiredTargets: [],
    evidence: [forgedRed, green],
    findings: [],
    waivers: [],
    acceptanceCriteria: [],
    tddDecision: forgedDecision,
    subjectRevision: current,
  });
  assert.equal(forgedResult.ready, false);
  assert.ok(forgedResult.reasons.includes("TDD RED evidence must be a failed tdd-red execution."));

  const syntheticRed = EvidenceRecordSchema.parse({
    ...red,
    id: "synthetic-red-evidence",
    command: null,
    exitCode: null,
  });
  assert.ok(evaluateCycle(syntheticRed, green).reasons.includes(
    "TDD RED evidence must record a real command with a non-zero exit code.",
  ));

  const failedGreen = EvidenceRecordSchema.parse({
    ...green,
    id: "failed-green-evidence",
    status: "fail",
    exitCode: 1,
    summary: "Implementation still fails.",
  });
  assert.ok(evaluateCycle(red, failedGreen).reasons.includes(
    "TDD GREEN evidence must be a passing tdd-green execution.",
  ));

  const foreignTaskRed = EvidenceRecordSchema.parse({ ...red, id: "foreign-task-red", taskId: "another-task" });
  assert.ok(evaluateCycle(foreignTaskRed, green).reasons.includes("TDD evidence belongs to a different task."));

  const wrongScopeGreen = EvidenceRecordSchema.parse({ ...green, id: "wrong-scope-green", scope: "apps/web" });
  assert.ok(evaluateCycle(red, wrongScopeGreen).reasons.includes(
    "TDD RED and GREEN must execute the same verifier and scope declared by the decision.",
  ));

  const staleGreen = EvidenceRecordSchema.parse({
    ...green,
    id: "stale-green",
    subjectRevision: redRevision,
  });
  assert.ok(evaluateCycle(red, staleGreen).reasons.includes(
    "TDD GREEN evidence belongs to a different final revision.",
  ));

  const result = evaluateDefinitionOfDone({
    taskId: "task-tdd-valid",
    requiredTargets: [],
    evidence: [red, green],
    findings: [],
    waivers: [],
    acceptanceCriteria: [{ id: "regression-fixed", satisfied: true, evidenceIds: [green.id] }],
    tddDecision: decision,
    subjectRevision: current,
  });

  assert.deepEqual(result, { ready: true, reasons: [] });
});

test("a waiver for one scope cannot satisfy another scope", () => {
  const current = captureSubjectRevision(fixture);
  const evidence = EvidenceRecordSchema.parse({
    id: "waived-api-test",
    taskId: "task-waiver-scope",
    verifierId: "verify.test",
    phase: "verification",
    status: "waived",
    scope: "apps/api",
    command: null,
    startedAt: "2026-09-26T12:00:00.000Z",
    durationMs: 0,
    exitCode: null,
    subjectRevision: current,
    outputDigest: `sha256:${"e".repeat(64)}`,
    summary: "Waived.",
    reason: "Environment unavailable.",
    waiverId: "waiver-web",
  });
  const waiver = WaiverSchema.parse({
    id: "waiver-web",
    taskId: "task-waiver-scope",
    targetId: "verify.test::apps/web",
    scope: "apps/web",
    reason: "Web environment unavailable.",
    approvedBy: "owner@example.com",
    createdAt: "2026-09-26T11:00:00.000Z",
    expiresAt: null,
  });
  const tddDecision = TddDecisionSchema.parse({
    taskId: "task-waiver-scope",
    scope: "apps/api",
    status: "not_applicable",
    expectation: "not_applicable",
    reason: "No behavior change.",
    redEvidenceId: null,
    greenEvidenceId: null,
    waiverId: null,
  });
  const result = evaluateDefinitionOfDone({
    taskId: "task-waiver-scope",
    requiredTargets: [{ verifierId: "verify.test", scope: "apps/api" }],
    evidence: [evidence],
    findings: [],
    waivers: [waiver],
    acceptanceCriteria: [],
    tddDecision,
    subjectRevision: current,
  });

  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((reason) => reason.includes("task/target/scope waiver")));

  const expiredWaiver = WaiverSchema.parse({
    ...waiver,
    id: "waiver-api-expired",
    targetId: "verify.test::apps/api",
    scope: "apps/api",
    expiresAt: "2026-09-25T12:00:00.000Z",
  });
  const expiredEvidence = EvidenceRecordSchema.parse({ ...evidence, waiverId: expiredWaiver.id });
  const expiredResult = evaluateDefinitionOfDone({
    taskId: "task-waiver-scope",
    requiredTargets: [{ verifierId: "verify.test", scope: "apps/api" }],
    evidence: [expiredEvidence],
    findings: [],
    waivers: [expiredWaiver],
    acceptanceCriteria: [],
    tddDecision,
    subjectRevision: current,
    now: new Date("2026-09-26T12:00:00.000Z"),
  });
  assert.equal(expiredResult.ready, false);
  assert.ok(expiredResult.reasons.some((reason) => reason.includes("task/target/scope waiver")));

  const validWaiver = WaiverSchema.parse({
    ...waiver,
    id: "waiver-api",
    targetId: "verify.test::apps/api",
    scope: "apps/api",
  });
  const validEvidence = EvidenceRecordSchema.parse({ ...evidence, waiverId: validWaiver.id });
  const validResult = evaluateDefinitionOfDone({
    taskId: "task-waiver-scope",
    requiredTargets: [{ verifierId: "verify.test", scope: "apps/api" }],
    evidence: [validEvidence],
    findings: [],
    waivers: [validWaiver],
    acceptanceCriteria: [],
    tddDecision,
    subjectRevision: current,
  });
  assert.deepEqual(validResult, { ready: true, reasons: [] });
});
