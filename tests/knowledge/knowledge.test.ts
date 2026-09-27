import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_CATALOG,
  KnowledgeApplicabilitySelectorSchema,
  KnowledgeUnitSchema,
  resolveContextManifest,
  selectorMatches,
} from "../../src/index.js";

const baseContext = {
  phase: "research" as const,
  taskType: "general" as const,
  riskClass: "normal" as const,
  signals: [],
  technologies: ["typescript"],
  capabilities: ["test"],
  affectedPaths: ["src/orders/service.ts"],
};

test("the initial knowledge catalog is small, valid, and fully provenance-linked", () => {
  assert.equal(KNOWLEDGE_CATALOG.length, 19);
  for (const unit of KNOWLEDGE_CATALOG) {
    assert.deepEqual(KnowledgeUnitSchema.parse(unit), unit);
    assert.ok(unit.provenance.sources.length > 0);
    for (const source of unit.provenance.sources) {
      assert.equal(source.repository, "affaan-m/ECC");
      assert.match(source.revision ?? "", /^[a-f0-9]{40}$/);
      assert.equal(source.license, "MIT");
    }
  }
});

test("context resolution selects only applicable knowledge with deterministic reasons and budget", () => {
  const first = resolveContextManifest(KNOWLEDGE_CATALOG, baseContext);
  const second = resolveContextManifest(KNOWLEDGE_CATALOG, baseContext);

  assert.deepEqual(first, second);
  assert.deepEqual(first.selected.map((selection) => selection.id), [
    "knowledge.exploration.bounded",
    "knowledge.exploration.entry-flow",
    "knowledge.exploration.evidence",
    "knowledge.exploration.reconnaissance",
    "knowledge.exploration.similar-patterns",
    "knowledge.exploration.stop-defer",
    "knowledge.exploration.terminology",
    "knowledge.exploration.tests",
  ]);
  assert.deepEqual(first.selected[0]?.reason, [
    "phase:research",
    "required-by:knowledge.exploration.evidence",
    "required-by:knowledge.exploration.reconnaissance",
    "required-by:knowledge.exploration.terminology",
  ]);
  assert.equal(first.totalEstimatedTokens, 1300);
  assert.equal("createdAt" in first, false);
});

test("review and trust-boundary context composes the relevant knowledge only", () => {
  const manifest = resolveContextManifest(KNOWLEDGE_CATALOG, {
    ...baseContext,
    phase: "review",
    taskType: "security",
    riskClass: "high-risk",
    signals: ["auth", "external_input"],
  });

  assert.deepEqual(manifest.selected.map((selection) => selection.id), [
    "knowledge.review.evidence",
    "knowledge.security.trust-boundaries",
  ]);
  assert.deepEqual(manifest.selected[1]?.reason, ["phase:review", "signal:auth", "signal:external_input"]);
});

test("selector dimensions are ANDed while values inside a dimension are ORed", () => {
  const selector = KnowledgeApplicabilitySelectorSchema.parse({
    phases: ["research", "plan"],
    technologies: ["typescript", "javascript"],
    capabilities: ["test"],
    pathPrefixes: ["src/orders"],
  });
  assert.equal(selectorMatches(selector, baseContext), true);
  assert.equal(selectorMatches(selector, { ...baseContext, capabilities: ["build"] }), false);
  assert.equal(selectorMatches(selector, { ...baseContext, affectedPaths: ["src/users/service.ts"] }), false);
  assert.throws(() => KnowledgeApplicabilitySelectorSchema.parse({}), /deterministic condition/);
});

test("required knowledge is included and missing dependencies or selected conflicts fail closed", () => {
  const always = (id: string, extra: Record<string, unknown> = {}) => KnowledgeUnitSchema.parse({
    schemaVersion: 1,
    id,
    version: 1,
    kind: "principle",
    summary: id,
    appliesWhen: [{ always: true }],
    guidance: [id],
    provenance: { origin: "azevedo", sources: [{ repository: null, path: "tests", revision: null, license: null }] },
    estimatedTokens: 1,
    stability: "experimental",
    ...extra,
  });
  const dependency = KnowledgeUnitSchema.parse({
    ...always("knowledge.dependency"),
    appliesWhen: [{ phases: ["done"] }],
  });
  const root = always("knowledge.root", { requires: ["knowledge.dependency"] });
  assert.deepEqual(
    resolveContextManifest([root, dependency], baseContext).selected.map((selection) => selection.id),
    ["knowledge.dependency", "knowledge.root"],
  );
  assert.throws(() => resolveContextManifest([root], baseContext), /requires missing unit/);
  assert.throws(() => resolveContextManifest([
    always("knowledge.left", { conflictsWith: ["knowledge.right"] }),
    always("knowledge.right"),
  ], baseContext), /conflict/);
});
