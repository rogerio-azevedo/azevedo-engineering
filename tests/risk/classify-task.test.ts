import assert from "node:assert/strict";
import test from "node:test";
import { classifyTask } from "../../src/index.js";

test("documentation-only work is trivial and TDD is not applicable", () => {
  const result = classifyTask({ taskId: "task-docs", title: "Corrigir o README", affectedPaths: ["README.md"] });
  assert.equal(result.type, "docs");
  assert.equal(result.risk, "trivial");
  assert.equal(result.tdd.expectation, "not_applicable");
  assert.deepEqual(result.recommendedAgents, []);
});

test("new business behavior normally requires TDD and review", () => {
  const result = classifyTask({
    taskId: "task-business-rule",
    title: "Crie uma nova regra para impedir agendamento de mudança aos domingos",
    affectedPaths: ["src/invoices/policy.ts"],
  });
  assert.equal(result.risk, "normal");
  assert.equal(result.tdd.expectation, "required");
  assert.ok(result.recommendedAgents.includes("reviewer"));
  assert.equal(result.architectRequired, false);
});

test("a realistic Portuguese bug report can carry structured reproducibility", () => {
  const result = classifyTask({
    taskId: "task-closed-incident",
    title: "Corrigir erro que permite ao morador editar uma ocorrência depois de encerrada",
    type: "bugfix",
    reproducibleBug: true,
    affectedPaths: ["src/occurrences/policy.ts"],
  });

  assert.equal(result.type, "bugfix");
  assert.equal(result.risk, "normal");
  assert.equal(result.tdd.expectation, "required");
});

test("auth contract changes trigger architectural and security review", () => {
  const result = classifyTask({
    taskId: "task-auth",
    title: "Precisamos alterar a autorização do síndico para editar uma ocorrência no contrato público",
    affectedPaths: ["src/auth/contracts/login.ts"],
  });
  assert.equal(result.risk, "high-risk");
  assert.equal(result.architectRequired, true);
  assert.equal(result.securityReviewRequired, true);
  assert.ok(result.recommendedAgents.includes("architect"));
  assert.ok(result.recommendedAgents.includes("security-reviewer"));
});

test("text heuristics alone do not promote a task to critical risk", () => {
  const result = classifyTask({
    taskId: "task-credential-wording",
    title: "Revisar comportamento relacionado a credencial",
    affectedPaths: [],
  });

  assert.equal(result.type, "security");
  assert.equal(result.risk, "high-risk");
  assert.equal(result.architectRequired, false);
  assert.equal(result.securityReviewRequired, true);
});

test("destructive migrations are critical", () => {
  const result = classifyTask({
    taskId: "task-migration",
    title: "Drop the legacy customer column",
    type: "config_infra",
    affectedPaths: ["db/migrations/0042_drop_customer.sql"],
    signals: ["destructive_migration", "production"],
  });
  assert.equal(result.risk, "critical");
  assert.equal(result.tdd.expectation, "domain_verification");
});

test("a routine dependency update is normal and does not require an architect", () => {
  const result = classifyTask({
    taskId: "task-zod-patch",
    title: "Atualizar pacote zod de 4.1.10 para 4.1.11",
    affectedPaths: ["package.json", "pnpm-lock.yaml"],
  });

  assert.equal(result.type, "dependency_change");
  assert.equal(result.risk, "normal");
  assert.equal(result.architectRequired, false);
  assert.ok(!result.recommendedAgents.includes("architect"));
});

test("a new low-impact local library remains a normal dependency change", () => {
  const result = classifyTask({
    taskId: "task-local-library",
    title: "Adicionar biblioteca local de formatação",
    type: "dependency_change",
    affectedPaths: ["packages/formatting/package.json"],
    signals: ["new_dependency"],
  });

  assert.equal(result.risk, "normal");
  assert.equal(result.architectRequired, false);
});

test("introducing a structural framework dependency is high-risk", () => {
  const result = classifyTask({
    taskId: "task-framework-introduction",
    title: "Introduzir um framework de persistência",
    type: "dependency_change",
    affectedPaths: ["packages/database/package.json"],
    signals: ["structural_dependency", "persistence"],
  });

  assert.equal(result.risk, "high-risk");
  assert.equal(result.architectRequired, true);
});

test("a structural dependency replacement is high-risk and requires an architect", () => {
  const result = classifyTask({
    taskId: "task-orm-replacement",
    title: "Substituir Drizzle por Prisma",
    type: "dependency_change",
    affectedPaths: ["packages/database/package.json"],
    signals: ["structural_dependency", "persistence"],
  });

  assert.equal(result.risk, "high-risk");
  assert.equal(result.architectRequired, true);
});
