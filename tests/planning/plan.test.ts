import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CODEX_AGENTS_CONTENT,
  EngineeringPlanSchema,
  buildEngineeringPlan,
  createInspectResult,
  createPlanId,
  renderAzevedoConfig,
  serializeEngineeringPlan,
} from "../../src/index.js";

const cliPath = resolve("dist/src/cli.js");

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: resolve("."),
    encoding: "utf8",
  });
}

type ProjectOptions = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  typescript?: boolean;
};

function createProject(name: string, options: ProjectOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), `azevedo-plan-${name}-`));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name,
    packageManager: "pnpm@11.24.0",
    scripts: options.scripts ?? {},
    dependencies: options.dependencies ?? {},
    devDependencies: options.typescript === false ? {} : { typescript: "5.9.3" },
  }, null, 2)}\n`);
  if (options.typescript !== false) writeFileSync(join(root, "tsconfig.json"), "{}\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "existing.ts"), "export const existing = true;\n");
  return root;
}

function initialize(root: string): void {
  const result = runCli("init", root);
  assert.equal(result.status, 0, result.stderr);
}

function parsePlanResult(result: ReturnType<typeof runCli>) {
  return JSON.parse(result.stdout) as {
    outcome: "created" | "unchanged" | "conflict";
    artifact: string;
    reason?: string;
    plan: ReturnType<typeof EngineeringPlanSchema.parse>;
  };
}

test("EngineeringPlan is strict, project-relative, invariant-checked, and deterministically identified", () => {
  const root = createProject("contract", {
    scripts: { lint: "eslint .", test: "vitest", build: "tsc" },
  });
  initialize(root);
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") return;

  const first = buildEngineeringPlan(inspection, "Adicionar endpoint para arquivar uma realização");
  const second = buildEngineeringPlan(inspection, "Adicionar endpoint para arquivar uma realização");
  assert.deepEqual(first, second);
  assert.equal(first.id, createPlanId(first.task.description, "single-repo", ["."]));
  assert.match(first.id, /^plan-adicionar-endpoint-para-arquivar-uma-realizacao-[a-f0-9]{8}$/);
  assert.equal(first.project.root, ".");
  assert.deepEqual(first.scope.affectedPaths, []);
  assert.doesNotMatch(serializeEngineeringPlan(first), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serializeEngineeringPlan(first), /createdAt/);

  assert.throws(() => EngineeringPlanSchema.parse({
    ...first,
    project: { ...first.project, root: root },
  }), /Invalid input/);
  assert.throws(() => EngineeringPlanSchema.parse({
    ...first,
    risk: { ...first.risk, class: "low" },
  }), /Invalid option/);
  assert.throws(() => EngineeringPlanSchema.parse({
    ...first,
    steps: first.steps.map((step, index) => index === 0 ? { ...step, kind: "execute" } : step),
  }), /Invalid option/);
  assert.throws(() => EngineeringPlanSchema.parse({
    ...first,
    scope: { ...first.scope, affectedPaths: ["/tmp/invented.ts"] },
  }), /project-relative/);
  assert.throws(() => EngineeringPlanSchema.parse({
    ...first,
    steps: first.steps.filter((step) => step.kind !== "research"),
  }), /research step before implementation/);
});

test("plan creates deterministic canonical JSON without inventing affected paths", () => {
  const root = createProject("create", {
    scripts: { lint: "eslint .", test: "vitest", build: "tsc" },
    dependencies: { "@nestjs/core": "11.0.0", prisma: "6.0.0" },
  });
  initialize(root);
  const sourceBefore = readFileSync(join(root, "src", "existing.ts"));
  const packageBefore = readFileSync(join(root, "package.json"));
  const configBefore = readFileSync(join(root, "azevedo.config.yaml"));
  const agentsBefore = readFileSync(join(root, "AGENTS.md"));
  const readmeBefore = readFileSync(join(root, ".azevedo", "README.md"));

  const result = runCli("plan", root, "--task", "Adicionar endpoint para arquivar uma realização", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = parsePlanResult(result);
  assert.equal(report.outcome, "created");
  assert.match(report.artifact, /^\.azevedo\/plans\/plan-.+\.json$/);
  assert.deepEqual(report.plan.scope.affectedPaths, []);
  assert.deepEqual(report.plan.scope.targetScopes, ["."]);
  assert.ok(report.plan.understanding.unknowns.includes("Exact implementation files require repository exploration."));
  assert.ok(report.plan.understanding.evidence.some((evidence) => evidence.kind === "manifest"));
  assert.notDeepEqual(report.plan.understanding.assumptions, report.plan.understanding.unknowns);
  assert.ok(report.plan.steps.findIndex((step) => step.kind === "research") < report.plan.steps.findIndex((step) => step.kind === "implementation"));
  assert.ok(report.plan.steps.some((step) => step.kind === "test"));

  const lint = report.plan.verification.find((item) => item.verifierId === "verify.lint");
  const typecheck = report.plan.verification.find((item) => item.verifierId === "verify.typecheck");
  const testRequirement = report.plan.verification.find((item) => item.verifierId === "verify.test");
  const build = report.plan.verification.find((item) => item.verifierId === "verify.build");
  assert.equal(lint?.available, true);
  assert.equal(typecheck?.available, false);
  assert.equal(typecheck?.script, null);
  assert.equal(testRequirement?.available, true);
  assert.equal(build?.available, true);

  const persisted = readFileSync(join(root, report.artifact), "utf8");
  assert.equal(persisted, serializeEngineeringPlan(report.plan));
  assert.doesNotMatch(persisted, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(readFileSync(join(root, "src", "existing.ts")), sourceBefore);
  assert.deepEqual(readFileSync(join(root, "package.json")), packageBefore);
  assert.deepEqual(readFileSync(join(root, "azevedo.config.yaml")), configBefore);
  assert.deepEqual(readFileSync(join(root, "AGENTS.md")), agentsBefore);
  assert.deepEqual(readFileSync(join(root, ".azevedo", "README.md")), readmeBefore);
});

test("unknown, group, uninitialized, missing-task, and empty-task planning are blocked", () => {
  const unknown = mkdtempSync(join(tmpdir(), "azevedo-plan-unknown-"));
  const unknownResult = runCli("plan", unknown, "--task", "Do something");
  assert.equal(unknownResult.status, 1);
  assert.match(unknownResult.stderr, /not enough evidence/);
  assert.deepEqual(new Set(existsSync(unknown) ? ["exists"] : []), new Set(["exists"]));

  const group = mkdtempSync(join(tmpdir(), "azevedo-plan-group-"));
  const api = join(group, "api");
  const web = join(group, "web");
  mkdirSync(api);
  mkdirSync(web);
  writeFileSync(join(api, "package.json"), "{\"name\":\"api\"}\n");
  writeFileSync(join(web, "package.json"), "{\"name\":\"web\"}\n");
  const groupResult = runCli("plan", group, "--task", "Add filter");
  assert.equal(groupResult.status, 1);
  assert.match(groupResult.stderr, /project group with 2 projects/);
  assert.match(groupResult.stderr, /api/);
  assert.match(groupResult.stderr, /web/);
  assert.equal(existsSync(join(group, ".azevedo")), false);

  const uninitialized = createProject("uninitialized");
  const uninitializedResult = runCli("plan", uninitialized, "--task", "Add behavior");
  assert.equal(uninitializedResult.status, 1);
  assert.match(uninitializedResult.stderr, /azevedo\.config\.yaml is missing/);

  const invalidConfig = createProject("invalid-config");
  initialize(invalidConfig);
  writeFileSync(join(invalidConfig, "azevedo.config.yaml"), "schemaVersion: unknown\n");
  const invalidConfigResult = runCli("plan", invalidConfig, "--task", "Add behavior");
  assert.equal(invalidConfigResult.status, 1);
  assert.match(invalidConfigResult.stderr, /config.*invalid or unsupported/i);

  const missingTask = runCli("plan", uninitialized);
  const emptyTask = runCli("plan", uninitialized, "--task", "");
  assert.equal(missingTask.status, 2);
  assert.equal(emptyTask.status, 2);
  assert.match(missingTask.stderr, /--task is required/);
  assert.match(emptyTask.stderr, /--task is required/);
});

test("a v0.3 initialized project plans without migration", () => {
  const root = createProject("v03-compatible");
  writeFileSync(join(root, "azevedo.config.yaml"), renderAzevedoConfig("codex"));
  writeFileSync(join(root, "AGENTS.md"), CODEX_AGENTS_CONTENT);
  mkdirSync(join(root, ".azevedo"));
  writeFileSync(join(root, ".azevedo", "README.md"), `# Azevedo Engineering local state

This directory is reserved for local state and artifacts produced by Azevedo Engineering capabilities.

Only files introduced by an explicit Azevedo Engineering operation should be stored here. This bootstrap file is versionable; future evidence or cache policies will be defined by the capabilities that need them.
`);

  const result = runCli("plan", root, "--task", "Adicionar comportamento", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parsePlanResult(result).outcome, "created");
});

test("planning reflects risk, task signals, TDD, architecture, and security without downgrading", () => {
  const root = createProject("risk", { scripts: { test: "vitest" } });
  initialize(root);
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") return;

  const normal = buildEngineeringPlan(inspection, "Adicionar endpoint para arquivar uma realização");
  assert.equal(normal.risk.class, "normal");

  const migration = buildEngineeringPlan(inspection, "Adicionar migration para realizações");
  assert.equal(migration.risk.class, "high-risk");
  assert.ok(migration.risk.signals.includes("migration"));
  assert.equal(migration.governance.securityReviewRequired, true);

  const dependency = buildEngineeringPlan(inspection, "Atualizar Prisma");
  assert.equal(dependency.risk.class, "normal");
  assert.equal(dependency.task.type, "dependency_change");
  assert.ok(dependency.risk.reasons.includes("task-type:dependency_change"));
  assert.equal(dependency.governance.tdd.expectation, "domain_verification");

  const security = buildEngineeringPlan(inspection, "Alterar autenticação e autorização");
  assert.equal(security.risk.class, "high-risk");
  assert.equal(security.governance.securityReviewRequired, true);
  assert.ok(security.decisions.items.some((item) => item.includes("Security review")));

  const architecture = buildEngineeringPlan(inspection, "Alterar arquitetura com nova fronteira");
  assert.equal(architecture.risk.class, "high-risk");
  assert.equal(architecture.governance.architectReviewRequired, true);
  assert.ok(architecture.decisions.items.some((item) => item.includes("Architecture review")));
});

test("a project without test capability gets no invented test command", () => {
  const root = createProject("without-test", { scripts: { build: "tsc" } });
  initialize(root);
  const result = runCli("plan", root, "--task", "Atualizar organização interna", "--json");
  assert.equal(result.status, 0, result.stderr);
  const plan = parsePlanResult(result).plan;
  assert.equal(plan.steps.some((step) => step.kind === "test"), false);
  const unavailableTest = plan.verification.find((item) => item.verifierId === "verify.test");
  assert.equal(unavailableTest?.available, false);
  assert.equal(unavailableTest?.required, false);
  assert.equal(unavailableTest?.script, null);
  assert.ok(plan.understanding.unknowns.includes("No test command was detected by inspection."));
});

test("monorepo planning keeps package scope unknown instead of selecting every workspace", () => {
  const inspection = createInspectResult(resolve("tests/fixtures/monorepo"));
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") return;

  const plan = buildEngineeringPlan(inspection, "Adicionar comportamento compartilhado");
  assert.deepEqual(plan.scope.affectedPaths, []);
  assert.deepEqual(plan.scope.targetScopes, []);
  assert.ok(plan.understanding.unknowns.includes("The affected package scope requires repository exploration."));
  assert.deepEqual([...new Set(plan.verification.map((requirement) => requirement.scope))], ["."]);
});

test("plan persistence is idempotent and does not rewrite unchanged content", () => {
  const root = createProject("idempotent", { scripts: { test: "vitest" } });
  initialize(root);
  const task = "Adicionar filtro por status";
  const first = runCli("plan", root, "--task", task, "--json");
  assert.equal(first.status, 0, first.stderr);
  const firstReport = parsePlanResult(first);
  const artifact = join(root, firstReport.artifact);
  const content = readFileSync(artifact);
  const fixedDate = new Date("2024-01-01T00:00:00.000Z");
  utimesSync(artifact, fixedDate, fixedDate);
  const mtimeBefore = statSync(artifact).mtimeMs;

  const second = runCli("plan", root, "--task", task, "--json");
  assert.equal(second.status, 0, second.stderr);
  const secondReport = parsePlanResult(second);
  assert.equal(secondReport.outcome, "unchanged");
  assert.equal(secondReport.artifact, firstReport.artifact);
  assert.deepEqual(readFileSync(artifact), content);
  assert.equal(statSync(artifact).mtimeMs, mtimeBefore);
});

test("different existing plan content conflicts without overwrite", () => {
  const root = createProject("conflict");
  initialize(root);
  const task = "Adicionar filtro por status";
  const first = runCli("plan", root, "--task", task, "--json");
  const artifact = join(root, parsePlanResult(first).artifact);
  writeFileSync(artifact, "{\"user\":\"content\"}\n");
  const before = readFileSync(artifact);

  const conflict = runCli("plan", root, "--task", task, "--json");
  assert.equal(conflict.status, 1);
  const report = parsePlanResult(conflict);
  assert.equal(report.outcome, "conflict");
  assert.match(report.reason ?? "", /different plan/);
  assert.deepEqual(readFileSync(artifact), before);
});

test("plans directory symlink is blocked without writing outside the project", () => {
  const root = createProject("symlink");
  initialize(root);
  const external = mkdtempSync(join(tmpdir(), "azevedo-plan-external-"));
  symlinkSync(external, join(root, ".azevedo", "plans"));

  const result = runCli("plan", root, "--task", "Adicionar comportamento", "--json");
  assert.equal(result.status, 1);
  assert.equal(parsePlanResult(result).outcome, "conflict");
  assert.deepEqual(readFileSync(join(root, "src", "existing.ts"), "utf8"), "export const existing = true;\n");
  assert.equal(existsSync(join(external, "plans")), false);
});

test("human plan output is legible and plan help documents the surface", () => {
  const root = createProject("human", { scripts: { test: "vitest" } });
  initialize(root);
  const result = runCli("plan", root, "--task", "Corrigir validação de CPF");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Azevedo Engineering — Engineering Plan/);
  assert.match(result.stdout, /Understanding/);
  assert.match(result.stdout, /\[research\]/);
  assert.match(result.stdout, /Verification/);
  assert.match(result.stdout, /\.azevedo\/plans\//);

  const help = runCli("plan", "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--task/);
  assert.doesNotMatch(help.stdout, /--dry-run/);
});

test("second init reports already-initialized in human and JSON outputs", () => {
  const root = createProject("init-regression");
  initialize(root);
  const readme = join(root, ".azevedo", "README.md");
  const fixedDate = new Date("2024-01-01T00:00:00.000Z");
  utimesSync(readme, fixedDate, fixedDate);
  const mtimeBefore = statSync(readme).mtimeMs;

  const human = runCli("init", root);
  const json = runCli("init", root, "--json");
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Already initialized\. No files were modified\./);
  assert.equal(parsePlanCompatibleJson(json.stdout).outcome, "already-initialized");
  assert.equal(statSync(readme).mtimeMs, mtimeBefore);
});

test("second group init visibly reports fourteen unchanged operations", () => {
  const group = mkdtempSync(join(tmpdir(), "azevedo-plan-init-group-"));
  const api = join(group, "api");
  const web = join(group, "web");
  mkdirSync(api);
  mkdirSync(web);
  writeFileSync(join(api, "package.json"), "{\"name\":\"api\"}\n");
  writeFileSync(join(web, "package.json"), "{\"name\":\"web\"}\n");
  assert.equal(runCli("init", group).status, 0);

  const second = runCli("init", group, "--json");
  assert.equal(second.status, 0, second.stderr);
  const report = parsePlanCompatibleJson(second.stdout);
  assert.equal(report.outcome, "already-initialized");
  assert.equal(report.summary?.unchanged, 14);
  assert.equal(report.summary?.create, 0);
});

function parsePlanCompatibleJson(value: string): {
  outcome: string;
  summary?: { unchanged: number; create: number };
} {
  return JSON.parse(value) as {
    outcome: string;
    summary?: { unchanged: number; create: number };
  };
}
