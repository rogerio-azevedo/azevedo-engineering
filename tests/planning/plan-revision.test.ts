import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EngineeringPlanRevisionSchema,
  PersistedAcceptanceCriterionSchema,
  applyPlanRevisionArtifactOperation,
  buildEngineeringPlan,
  buildPlanRevisionArtifactOperation,
  createEngineeringPlanRevision,
  createInspectResult,
  serializeEngineeringPlanRevision,
} from "../../src/index.js";

const subjectRevision = {
  head: "8b57e0d",
  worktreeDigest: `sha256:${"1".repeat(64)}`,
  dirty: false,
};

const criterion = PersistedAcceptanceCriterionSchema.parse({
  id: "ac-persists-observable-result",
  source: { kind: "user", reference: null },
  statement: "The requested behavior has a persistent, observable acceptance contract.",
  scenario: {
    given: "a valid engineering plan",
    when: "the plan is enriched",
    then: "the acceptance criterion remains in the immutable revision",
  },
  prohibitedEffects: ["The original plan artifact must not be overwritten."],
  verificationMethod: "Parse the persisted revision and compare the criterion.",
  priority: "required",
});

function basePlan() {
  const inspection = createInspectResult(resolve("tests/fixtures/single-repo"));
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project fixture.");
  return buildEngineeringPlan(inspection, "Adicionar critério de aceite persistente");
}

function firstRevision() {
  const plan = basePlan();
  const enriched = {
    ...plan,
    scope: { ...plan.scope, affectedPaths: ["src/example.ts"] },
    understanding: {
      ...plan.understanding,
      unknowns: [],
      evidence: [...plan.understanding.evidence, {
        kind: "inspection" as const,
        source: "src/example.ts",
        statement: "Repository research identified the implementation scope.",
      }],
    },
  };
  return { plan, revision: createEngineeringPlanRevision({
    planSnapshot: enriched,
    basis: { subjectRevision, sourceArtifactIds: ["src/example.ts"], knowledgeUnitIds: ["knowledge.intent.acceptance"] },
    acceptanceCriteria: [criterion],
    changeSummary: ["Resolved the implementation scope and persisted acceptance."],
  }) };
}

test("plan enrichment is deterministic, immutable, and retains the initial intent identity", () => {
  const { plan, revision } = firstRevision();
  const repeated = firstRevision().revision;
  assert.deepEqual(revision, repeated);
  assert.equal(revision.planId, plan.id);
  assert.equal(revision.planSnapshot.id, plan.id);
  assert.deepEqual(plan.scope.affectedPaths, []);
  assert.deepEqual(revision.planSnapshot.scope.affectedPaths, ["src/example.ts"]);
  assert.deepEqual(revision.acceptanceCriteria, [criterion]);
  assert.match(revision.id, /^plan-revision-1-[a-f0-9]{8}$/);
  assert.equal(revision.parentRevisionId, null);
  assert.throws(() => EngineeringPlanRevisionSchema.parse({
    ...revision,
    planSnapshot: {
      ...revision.planSnapshot,
      task: { ...revision.planSnapshot.task, description: "Uma intenção diferente" },
    },
  }), /cannot change the intent fields/);
});

test("subsequent plan revisions form an immutable parent chain", () => {
  const first = firstRevision().revision;
  const second = createEngineeringPlanRevision({
    planSnapshot: first.planSnapshot,
    parentRevision: first,
    basis: first.basis,
    acceptanceCriteria: first.acceptanceCriteria,
    changeSummary: ["Clarified verification without changing plan identity."],
  });
  assert.equal(second.sequence, 2);
  assert.equal(second.parentRevisionId, first.id);
  assert.equal(second.planId, first.planId);
  assert.throws(() => EngineeringPlanRevisionSchema.parse({ ...second, parentRevisionId: null }), /Only the first revision/);
});

test("plan revisions persist create-only and distinguish unchanged from conflict", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-plan-revision-"));
  mkdirSync(join(root, ".azevedo"));
  const revision = firstRevision().revision;
  const create = buildPlanRevisionArtifactOperation(root, revision);
  assert.equal(create.action, "create");
  applyPlanRevisionArtifactOperation(root, create);
  const artifact = join(root, create.artifact);
  assert.equal(readFileSync(artifact, "utf8"), serializeEngineeringPlanRevision(revision));
  assert.equal(buildPlanRevisionArtifactOperation(root, revision).action, "unchanged");

  writeFileSync(artifact, "user-owned content\n");
  const conflict = buildPlanRevisionArtifactOperation(root, revision);
  assert.equal(conflict.action, "conflict");
  assert.equal(readFileSync(artifact, "utf8"), "user-owned content\n");
});

test("unsafe revision directory symlinks fail closed without writing outside", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-plan-revision-symlink-"));
  const external = mkdtempSync(join(tmpdir(), "azevedo-plan-revision-external-"));
  const revision = firstRevision().revision;
  const planDirectory = join(root, ".azevedo", "plans", revision.planId);
  mkdirSync(planDirectory, { recursive: true });
  symlinkSync(external, join(planDirectory, "revisions"));
  const operation = buildPlanRevisionArtifactOperation(root, revision);
  assert.equal(operation.action, "conflict");
  assert.deepEqual(readdirSync(external), []);
});
