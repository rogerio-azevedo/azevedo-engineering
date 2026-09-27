import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createCodexInitializationArtifacts, createCodexInstallPlan, inspectProject } from "../../src/index.js";

test("Codex adapter emits a project-local baseline and four read-only roles", () => {
  const inspection = inspectProject(resolve("tests/fixtures/monorepo"));
  const plan = createCodexInstallPlan(inspection);

  assert.equal(plan.scope, "project-local");
  assert.equal(plan.artifacts.length, 5);
  assert.deepEqual(
    plan.artifacts.map((artifact) => artifact.path),
    [
      "AGENTS.md",
      ".codex/agents/explorer.toml",
      ".codex/agents/architect.toml",
      ".codex/agents/reviewer.toml",
      ".codex/agents/security-reviewer.toml",
    ],
  );

  for (const artifact of plan.artifacts.filter((candidate) => candidate.path.endsWith(".toml"))) {
    assert.match(artifact.content, /sandbox_mode = "read-only"/);
    assert.doesNotMatch(artifact.content, /^model\s*=/m);
    assert.match(artifact.content, /developer_instructions =/);
  }
  assert.ok(plan.unsupported.includes("global configuration"));
});

test("Codex init and inspected install plans share one specialist-agent authoring source", () => {
  const inspection = inspectProject(resolve("tests/fixtures/single-repo"));
  const initialized = createCodexInitializationArtifacts().filter((artifact) => artifact.path.endsWith(".toml"));
  const installed = createCodexInstallPlan(inspection).artifacts.filter((artifact) => artifact.path.endsWith(".toml"));
  assert.equal(createCodexInitializationArtifacts().length, 5);
  assert.deepEqual(
    initialized.map(({ path, content }) => ({ path, content })),
    installed.map(({ path, content }) => ({ path, content })),
  );
});

test("Codex baseline contains detected context rather than reference assumptions", () => {
  const inspection = inspectProject(resolve("tests/fixtures/single-repo"));
  const baseline = createCodexInstallPlan(inspection).artifacts.find((artifact) => artifact.path === "AGENTS.md");
  assert.ok(baseline);
  assert.match(baseline.content, /prisma/);
  assert.doesNotMatch(baseline.content, /drizzle/);
});
