import assert from "node:assert/strict";
import test from "node:test";
import { classifyTask } from "../../src/index.js";

test("documentation-only work is trivial and TDD is not applicable", () => {
  const result = classifyTask({ title: "Correct the README", affectedPaths: ["README.md"] });
  assert.equal(result.type, "docs");
  assert.equal(result.risk, "trivial");
  assert.equal(result.tdd.expectation, "not_applicable");
  assert.deepEqual(result.recommendedAgents, []);
});

test("new business behavior normally requires TDD and review", () => {
  const result = classifyTask({
    title: "Add a business rule for invoice due dates",
    type: "business_behavior",
    affectedPaths: ["src/invoices/policy.ts"],
  });
  assert.equal(result.risk, "normal");
  assert.equal(result.tdd.expectation, "required");
  assert.ok(result.recommendedAgents.includes("reviewer"));
  assert.equal(result.architectRequired, false);
});

test("auth contract changes trigger architectural and security review", () => {
  const result = classifyTask({
    title: "Change the public login contract",
    affectedPaths: ["src/auth/contracts/login.ts"],
    signals: ["auth", "public_contract"],
  });
  assert.equal(result.risk, "high-risk");
  assert.equal(result.architectRequired, true);
  assert.equal(result.securityReviewRequired, true);
  assert.ok(result.recommendedAgents.includes("architect"));
  assert.ok(result.recommendedAgents.includes("security-reviewer"));
});

test("destructive migrations are critical", () => {
  const result = classifyTask({
    title: "Drop the legacy customer column",
    type: "config_infra",
    affectedPaths: ["db/migrations/0042_drop_customer.sql"],
    signals: ["destructive_migration", "production"],
  });
  assert.equal(result.risk, "critical");
  assert.equal(result.tdd.expectation, "domain_verification");
});

