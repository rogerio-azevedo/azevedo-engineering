import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AGENT_ROLES,
  AZEVEDO_REFERENCE_MANIFEST,
  ComponentSchema,
  EvidenceRecordSchema,
  InspectionTargetResultSchema,
  ProjectGroupInspectResultSchema,
  STACK_PROFILES,
  STANDARD_WORKFLOW,
  TddDecisionSchema,
  WaiverSchema,
  createInspectResult,
} from "../../src/index.js";

const revision = {
  head: null,
  worktreeDigest: `sha256:${"0".repeat(64)}`,
  dirty: true,
};

test("canonical component metadata is schema-validated", () => {
  const component = ComponentSchema.parse({
    id: "review.code",
    version: 1,
    kind: "verifier",
    summary: "Reviews code.",
    stability: "beta",
  });
  assert.equal(component.id, "review.code");
  assert.deepEqual(component.requires, []);
});

test("evidence distinguishes skip, waiver, and not-applicable dispositions", () => {
  const base = {
    id: "evidence-1",
    taskId: "task-contracts",
    verifierId: "verify.test",
    phase: "verification",
    scope: ".",
    command: null,
    startedAt: "2026-09-26T12:00:00.000Z",
    durationMs: 1,
    exitCode: null,
    subjectRevision: revision,
    outputDigest: `sha256:${"1".repeat(64)}`,
    summary: "Not run.",
    waiverId: null,
  };

  assert.throws(() => EvidenceRecordSchema.parse({ ...base, status: "skipped", reason: null }));
  assert.throws(() => EvidenceRecordSchema.parse({ ...base, status: "waived", reason: "Approved", waiverId: null }));
  assert.equal(
    EvidenceRecordSchema.parse({ ...base, status: "not_applicable", reason: "Documentation only" }).status,
    "not_applicable",
  );
});

test("TDD decisions always record a disposition and reason", () => {
  assert.equal(
    TddDecisionSchema.parse({
      taskId: "task-docs",
      scope: ".",
      status: "not_applicable",
      expectation: "not_applicable",
      reason: "Documentation only.",
      redEvidenceId: null,
      greenEvidenceId: null,
      waiverId: null,
    }).status,
    "not_applicable",
  );
  assert.throws(() =>
    TddDecisionSchema.parse({
      taskId: "task-waiver",
      scope: "apps/api",
      status: "waived",
      expectation: "required",
      reason: "Exceptional environment limitation.",
      redEvidenceId: null,
      greenEvidenceId: null,
      waiverId: null,
    }),
  );
});

test("waivers require an explicit approver", () => {
  assert.throws(() => WaiverSchema.parse({
    id: "waiver-without-owner",
    taskId: "task-waiver",
    targetId: "verify.test::apps/api",
    scope: "apps/api",
    reason: "Environment unavailable.",
    approvedBy: "",
    createdAt: "2026-09-26T12:00:00.000Z",
    expiresAt: null,
  }));
});

test("the initial catalog stays intentionally small and has no rigor profiles", () => {
  assert.deepEqual(AGENT_ROLES.map((role) => role.id), ["explorer", "architect", "reviewer", "security-reviewer"]);
  assert.ok(STACK_PROFILES.every((profile) => !/[.]?(light|standard|strict)$/i.test(profile.id)));
  assert.deepEqual(AZEVEDO_REFERENCE_MANIFEST.profiles, [
    "profile.typescript",
    "profile.nestjs",
    "profile.nextjs",
    "profile.postgres-drizzle",
    "profile.mongodb-mongoose",
  ]);
});

test("the standard workflow preserves all delivery phases in order", () => {
  assert.deepEqual(STANDARD_WORKFLOW.phases.map((phase) => phase.id), [
    "understand",
    "research",
    "plan",
    "implement",
    "test",
    "review",
    "verify",
    "document",
    "learn",
    "done",
  ]);
});

test("inspection targets discriminate projects from project groups", () => {
  const project = createInspectResult(resolve("tests/fixtures/single-repo"));
  const group = createInspectResult(resolve("tests/fixtures/project-group"));

  assert.equal(InspectionTargetResultSchema.parse(project).kind, "project");
  assert.equal(InspectionTargetResultSchema.parse(group).kind, "project-group");
  assert.throws(() => ProjectGroupInspectResultSchema.parse({
    schemaVersion: 1,
    kind: "project-group",
    root: resolve("tests/fixtures/project-group"),
    projects: [],
  }));
});
