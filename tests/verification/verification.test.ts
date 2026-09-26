import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  EvidenceRecordSchema,
  TddDecisionSchema,
  captureSubjectRevision,
  classifyTask,
  evaluateDefinitionOfDone,
  inspectProject,
  resolveVerificationPlan,
  runFilePresenceVerifier,
  runPackageScriptVerifier,
} from "../../src/index.js";

const fixture = resolve("tests/fixtures/single-repo");

test("verification planning exposes required capabilities that are unavailable", () => {
  const inspection = inspectProject(fixture);
  const classification = classifyTask({
    title: "Change authorization rules",
    type: "security",
    signals: ["authorization"],
  });
  const plan = resolveVerificationPlan(inspection, classification);
  const lint = plan.find((item) => item.verifierId === "verify.lint");

  assert.equal(lint?.required, true);
  assert.equal(lint?.available, false);
  assert.match(lint?.reason ?? "", /no deterministic project script/);
});

test("file and package-script verifiers produce revision-bound evidence", () => {
  const revision = captureSubjectRevision(fixture);
  const files = runFilePresenceVerifier({
    root: fixture,
    requiredPaths: ["package.json", "src/index.ts"],
    subjectRevision: revision,
  });
  const script = runPackageScriptVerifier({
    root: fixture,
    packageManager: "npm",
    script: "test",
    verifierId: "verify.test",
    subjectRevision: revision,
  });

  assert.equal(files.status, "pass");
  assert.equal(script.status, "pass");
  assert.deepEqual(script.subjectRevision, revision);
});

test("file verifier rejects paths outside the inspected project", () => {
  const revision = captureSubjectRevision(fixture);
  const result = runFilePresenceVerifier({
    root: fixture,
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

test("Definition of Done rejects stale evidence and open blocking findings", () => {
  const current = captureSubjectRevision(fixture);
  const stale = { ...current, worktreeDigest: `sha256:${"f".repeat(64)}` };
  const evidence = EvidenceRecordSchema.parse({
    id: "test-evidence",
    verifierId: "verify.test",
    status: "pass",
    scope: fixture,
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
    status: "not_applicable",
    expectation: "not_applicable",
    reason: "No new behavior.",
    redEvidenceId: null,
    greenEvidenceId: null,
    waiverId: null,
  });
  const result = evaluateDefinitionOfDone({
    requiredVerifierIds: ["verify.test"],
    evidence: [evidence],
    findings: [{
      id: "finding-1",
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
