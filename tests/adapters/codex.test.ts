import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createCodexInstallPlan, inspectProject } from "../../src/index.js";

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

test("Codex baseline contains detected context rather than reference assumptions", () => {
  const inspection = inspectProject(resolve("tests/fixtures/single-repo"));
  const baseline = createCodexInstallPlan(inspection).artifacts.find((artifact) => artifact.path === "AGENTS.md");
  assert.ok(baseline);
  assert.match(baseline.content, /prisma/);
  assert.doesNotMatch(baseline.content, /drizzle/);
});
