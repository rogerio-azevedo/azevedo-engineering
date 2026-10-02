import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createPlanId } from "../../src/core/planning/engineering-plan.js";
import { KNOWLEDGE_CATALOG } from "../../src/core/knowledge/catalog.js";
import { resolveContextManifest } from "../../src/core/knowledge/resolve-context.js";
import {
  buildProjectContext,
  loadProject,
  onboardProject,
} from "../../src/index.js";
import { createWorkItem } from "../../src/core/work/create-work-item.js";
import { exploreWorkItem } from "../../src/core/work/explore-work-item.js";
import { planWorkItem } from "../../src/core/work/plan-work-item.js";
import { specifyWorkItem } from "../../src/core/work/specify-work-item.js";
import { WorkItemError } from "../../src/core/work/errors.js";
import { loadCoordinatedPlan, loadExploration, loadRepositoryPlan, loadWorkItem } from "../../src/core/work/store.js";
import { commitAll, initRepo, tempDir, write, writePackage } from "../project/fixtures.js";

const cliPath = resolve("dist/src/cli.js");
const OBJECTIVE = "Uma Sugestão de Melhoria pode ser criada a partir de uma Ocorrência existente.";

function runCli(cwd: string, args: readonly string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

function treeText(root: string): string {
  const chunks: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else chunks.push(readFileSync(path, "utf8"));
    }
  };
  if (statSync(root).isDirectory()) visit(root);
  return chunks.join("\n");
}

function onboardPair(options?: { serverFile?: boolean }): {
  workspace: string;
  container: string;
  server: string;
  web: string;
} {
  const container = tempDir("work-container-");
  const workspace = tempDir("work-workspace-");
  const server = join(container, "server");
  const web = join(container, "web");
  initRepo(server);
  writePackage(server, { "@nestjs/core": "10.0.0", typescript: "5.0.0" });
  write(server, "src/main.ts", "import { NestFactory } from \"@nestjs/core\";\nexport const app = NestFactory;\n");
  if (options?.serverFile !== false) {
    write(server, "src/occurrence.entity.ts", "export class Occurrence {}\nexport enum OccurrenceCategory { SUGGESTION = \"SUGGESTION\" }\n");
    write(server, "src/occurrences.resolver.ts", "export class OccurrenceResolver {}\n");
    write(server, "src/create-notification-from-occurrence.ts", "export function createNotificationFromOccurrence() { return \"occurrence\"; }\n");
  }
  write(server, ".env", "TOKEN=super-secret-value\n");
  commitAll(server, "server");
  initRepo(web);
  writePackage(web, { next: "14.0.0" });
  write(web, "src/unrelated.ts", "export const ready = true;\n");
  commitAll(web, "web");
  onboardProject({ workspace, target: container, projectId: "demo", name: "Demo" });
  return { workspace, container, server, web };
}

test("the same task across two repositories is one work item with distinct repository plans", () => {
  const { workspace, server, web } = onboardPair();
  const beforeServer = gitStatus(server);
  const beforeWeb = gitStatus(web);
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({
    workspace,
    workItemId: created.item.id,
    cwd: workspace,
    specificationPath: specFile(workspace),
  });
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  assert.deepEqual(explored.pointer.repositories.map((repository) => repository.relevance.state).sort(), ["NOT_RELEVANT", "RELEVANT"]);
  const planned = planWorkItem({ workspace, workItemId: created.item.id });
  assert.equal(planned.outcome, "created");
  const plans = explored.pointer.repositories.map((repository) => {
    const current = planned.pointer.repositories.find((item) => item.repositoryId === repository.repositoryId);
    return current?.repositoryPlanId ?? null;
  });
  const written = plans.filter((id): id is string => id !== null);
  assert.equal(written.length, 1);
  assert.equal(new Set(written).size, 1);
  assert.notEqual(written[0]?.startsWith("plan-"), true);
  const text = treeText(join(workspace, "var/projects/demo/work-items"));
  assert.equal(text.includes("super-secret-value"), false);
  assert.equal(text.includes(server), false);
  assert.equal(text.includes(web), false);
  assert.equal(existsSyncSafe(join(server, "AGENTS.md")), false);
  assert.equal(existsSyncSafe(join(server, "azevedo.config.yaml")), false);
  assert.equal(existsSyncSafe(join(server, ".azevedo")), false);
  assert.equal(existsSyncSafe(join(web, ".azevedo")), false);
  assert.equal(gitStatus(server), beforeServer);
  assert.equal(gitStatus(web), beforeWeb);
  const serverPlanId = planned.pointer.repositories.find((repository) => repository.relevance.state === "RELEVANT")?.repositoryPlanId;
  assert.ok(serverPlanId);
  const plan = JSON.parse(readFileSync(join(
    workspace, "var/projects/demo/work-items", created.item.id, "repositories", "server", "plans", `${serverPlanId}.json`,
  ), "utf8")) as {
    affectedPaths: string[];
    basis: { specificationId: string; explorationIds: string[] };
    candidateEvidenceIds: string[];
    analogousEvidenceIds: string[];
  };
  assert.deepEqual(plan.affectedPaths, []);
  assert.equal(plan.basis.specificationId, planned.pointer.specificationId);
  assert.deepEqual(plan.basis.explorationIds, [
    planned.pointer.repositories.find((repository) => repository.repositoryId === "server")?.explorationId,
  ]);
  assert.ok(plan.candidateEvidenceIds.length > 0);
  assert.ok(plan.analogousEvidenceIds.length > 0);
  const exploration = JSON.parse(readFileSync(join(
    workspace, "var/projects/demo/work-items", created.item.id, "explorations", "server",
    `${plan.basis.explorationIds[0]}.json`,
  ), "utf8")) as { contextUnits: string[]; evidence: Array<{ relation: string; reason: string }> };
  assert.ok(exploration.contextUnits.includes("knowledge.project.context-use"));
  assert.ok(exploration.evidence.some((item) => item.relation === "candidate" && item.reason.includes("not a requirement")));
  assert.ok(exploration.evidence.some((item) => item.relation === "analogous" && item.reason.includes("not a requirement")));
});

test("a missing binding stays UNKNOWN and does not invent a path", () => {
  const { workspace, container } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  renameSync(container, `${container}-moved`);
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  assert.ok(explored.pointer.repositories.every((repository) =>
    repository.relevance.state === "UNKNOWN"
    && repository.relevance.cause === "binding-unavailable"
    && repository.explorationId === null));
  assert.match(explored.pointer.repositories[0]?.relevance.state === "UNKNOWN"
    ? explored.pointer.repositories[0].relevance.cause === "binding-unavailable"
      ? explored.pointer.repositories[0].relevance.statement
      : ""
    : "", /No path was invented/);
  const planned = planWorkItem({ workspace, workItemId: created.item.id });
  assert.equal(planned.outcome, "blocked");
  assert.equal(planned.reason, "unresolved-relevance");
  assert.equal(existsSyncSafe(join(workspace, "var/projects/demo/work-items", created.item.id, "coordinated")), false);
});

test("an exhausted reconnaissance budget stays UNKNOWN and keeps the stop reason", () => {
  const { workspace } = onboardPair({ serverFile: false });
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const loaded = loadProject(workspace, "demo");
  const server = loaded.binding?.root ? join(loaded.binding.root, "server") : "";
  write(server, "deep/nested/occurrence.entity.ts", "export class Occurrence {}\n");
  const explored = exploreWorkItem({
    workspace,
    workItemId: created.item.id,
    limits: { maxListings: 1, maxReads: 1, maxDepth: 8 },
  });
  const serverRelevance = explored.pointer.repositories.find((repository) => repository.repositoryId === "server")?.relevance;
  assert.equal(serverRelevance?.state, "UNKNOWN");
  assert.equal(serverRelevance?.state === "UNKNOWN" && serverRelevance.cause === "exploration"
    ? serverRelevance.stopReason
    : "", "budget-exhausted");
});

test("a stale project fact does not become an affected path or decide relevance", () => {
  const { workspace, server } = onboardPair({ serverFile: false });
  write(server, "src/main.ts", "import { NestFactory } from \"@nestjs/core\";\nexport const token = \"unique-stale-token\";\n");
  commitAll(server, "token");
  onboardProject({ workspace, target: join(server, ".."), projectId: "demo", name: "Demo" });
  const created = createWorkItem({ workspace, projectId: "demo", objective: "Track unique-stale-token in the repository." });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  write(server, "src/main.ts", "export const gone = true;\n");
  const context = buildProjectContext(workspace, "demo");
  const staleIds = context.facts.stale.map((fact) => fact.id);
  assert.ok(staleIds.length > 0);
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  const serverRow = explored.pointer.repositories.find((repository) => repository.repositoryId === "server");
  assert.ok(serverRow?.explorationId);
  const exploration = JSON.parse(readFileSync(join(
    workspace, "var/projects/demo/work-items", created.item.id, "explorations", "server", `${serverRow.explorationId}.json`,
  ), "utf8")) as { orientation: { factIds: string[] }; evidence: Array<{ path: string }> };
  for (const id of staleIds) assert.equal(exploration.orientation.factIds.includes(id), false);
  assert.equal(exploration.evidence.some((item) => item.path === "src/main.ts" && item.path.includes("unique-stale-token")), false);
  assert.notEqual(serverRow.relevance.state, "RELEVANT");
});

test("NOT_RELEVANT requires examined evidence and a plan without acceptance criteria writes nothing", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  const web = explored.pointer.repositories.find((repository) => repository.repositoryId === "web");
  assert.equal(web?.relevance.state, "NOT_RELEVANT");
  assert.ok(web?.relevance.state === "NOT_RELEVANT" && web.relevance.evidenceIds.length > 0);
  const blocked = planWorkItem({ workspace, workItemId: created.item.id });
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.reason, "needs-product-decision");
  assert.equal(existsSyncSafe(join(workspace, "var/projects/demo/work-items", created.item.id, "coordinated")), false);
  assert.equal(existsSyncSafe(join(workspace, "var/projects/demo/work-items", created.item.id, "repositories")), false);
});

test("an incompatible repository set fails closed and a later project repository is not absorbed", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE, repositoryIds: ["server"] });
  const before = readFileSync(join(workspace, "var/projects/demo/work-items", created.item.id, "item.json"), "utf8");
  assert.throws(
    () => createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE, repositoryIds: ["server", "web"] }),
    (error: unknown) => error instanceof WorkItemError && error.code === "conflict",
  );
  assert.throws(
    () => createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE }),
    (error: unknown) => error instanceof WorkItemError && error.code === "conflict",
  );
  assert.equal(readFileSync(join(workspace, "var/projects/demo/work-items", created.item.id, "item.json"), "utf8"), before);
  assert.deepEqual(created.item.repositoryIds, ["server"]);
});

test("repeated exploration does not rewrite an unchanged pointer", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  exploreWorkItem({ workspace, workItemId: created.item.id });
  const pointer = join(workspace, "var/projects/demo/work-items", created.item.id, "current.json");
  const before = statSync(pointer).mtimeMs;
  const again = exploreWorkItem({ workspace, workItemId: created.item.id });
  assert.equal(again.outcome, "unchanged");
  assert.equal(statSync(pointer).mtimeMs, before);
});

test("symlink escape and legacy plan identity stay contained", () => {
  const { workspace, server } = onboardPair({ serverFile: false });
  const outside = tempDir("work-outside-");
  write(outside, "outside-marker.ts", "export const secret = \"outside-secret-marker\";\n");
  symlinkSync(outside, join(server, "src-link"));
  const created = createWorkItem({ workspace, projectId: "demo", objective: "Find the escaped marker." });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  exploreWorkItem({ workspace, workItemId: created.item.id });
  const text = treeText(join(workspace, "var/projects/demo/work-items"));
  assert.equal(text.includes("outside-marker.ts"), false);
  assert.equal(text.includes("outside-secret-marker"), false);
  assert.equal(createPlanId("Add a README", "single-repo", ["."]), "plan-add-a-readme-85881be4");
  const legacy = resolveContextManifest(KNOWLEDGE_CATALOG, {
    phase: "research",
    taskType: "business_behavior",
    riskClass: "normal",
    signals: [],
    technologies: [],
    capabilities: [],
    affectedPaths: [],
  });
  assert.equal(legacy.selected.some((item) => item.id === "knowledge.project.context-use"), false);
});

test("a pruned directory cannot become NOT_RELEVANT", () => {
  const { workspace, server } = onboardPair({ serverFile: false });
  write(server, "src/unrelated.ts", "export const ready = true;\n");
  write(server, "notes/create-notification-from-occurrence.ts", "export function createNotificationFromOccurrence() { return \"occurrence\"; }\n");
  commitAll(server, "notes");
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  const serverRow = explored.pointer.repositories.find((repository) => repository.repositoryId === "server");
  const relevance = serverRow?.relevance;
  assert.ok(relevance && relevance.state === "UNKNOWN" && relevance.cause === "exploration");
  assert.match(relevance.statement, /notes/);
  assert.match(relevance.statement, /not relevant/);
  const exploration = JSON.parse(readFileSync(join(
    workspace, "var/projects/demo/work-items", created.item.id, "explorations", "server", `${serverRow?.explorationId}.json`,
  ), "utf8")) as { coverage: { complete: boolean; unexamined: string[] }; evidence: Array<{ path: string }> };
  assert.equal(exploration.coverage.complete, false);
  assert.ok(exploration.coverage.unexamined.includes("notes"));
  assert.equal(exploration.evidence.some((item) => item.path.includes("create-notification-from-occurrence")), false);
});

test("positive evidence keeps RELEVANT when the budget leaves a structural file unread", () => {
  const { workspace, server } = onboardPair({ serverFile: false });
  for (let index = 0; index < 45; index += 1) {
    write(server, `src/services/occurrence-${String(index).padStart(2, "0")}.ts`, "export class OccurrenceResolver {}\n");
  }
  write(server, "prisma/schema.prisma", "enum OccurrenceCategory { SUGGESTION }\n");
  commitAll(server, "budget");
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  const serverRow = explored.pointer.repositories.find((repository) => repository.repositoryId === "server");
  assert.equal(serverRow?.relevance.state, "RELEVANT");
  const exploration = JSON.parse(readFileSync(join(
    workspace, "var/projects/demo/work-items", created.item.id, "explorations", "server", `${serverRow?.explorationId}.json`,
  ), "utf8")) as {
    stopReason: string;
    coverage: { complete: boolean; budgetLimited: boolean; unexamined: string[] };
    evidence: Array<{ path: string }>;
  };
  assert.equal(exploration.coverage.complete, false);
  assert.equal(exploration.coverage.budgetLimited, true);
  assert.equal(exploration.stopReason, "budget-exhausted");
  assert.ok(exploration.coverage.unexamined.includes("prisma/schema.prisma"));
  assert.equal(exploration.evidence.some((item) => item.path === "prisma/schema.prisma"), false);
  assert.ok(exploration.evidence.some((item) => item.path.includes("occurrence-")));
});

test("a pointer repository set that is not the work item set fails closed", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const pointerPath = join(workspace, "var/projects/demo/work-items", created.item.id, "current.json");
  const original = readFileSync(pointerPath, "utf8");
  const smaller = JSON.parse(original) as { repositories: Array<{ repositoryId: string }> };
  smaller.repositories = smaller.repositories.filter((repository) => repository.repositoryId === "server");
  writeFileSync(pointerPath, `${JSON.stringify(smaller, null, 2)}\n`);
  assert.throws(() => planWorkItem({ workspace, workItemId: created.item.id }), (error: unknown) =>
    error instanceof WorkItemError && /pointer repositories/.test(error.message));
  const larger = JSON.parse(original) as { repositories: Array<Record<string, unknown>> };
  larger.repositories.push({
    repositoryId: "extra",
    relevance: { state: "UNKNOWN", cause: "not-explored" },
    explorationId: null,
    repositoryPlanId: null,
  });
  writeFileSync(pointerPath, `${JSON.stringify(larger, null, 2)}\n`);
  assert.throws(() => loadWorkItem(workspace, created.item.id), (error: unknown) =>
    error instanceof WorkItemError && /pointer repositories/.test(error.message));
  const duplicated = JSON.parse(original) as { repositories: Array<Record<string, unknown>> };
  const firstRepository = duplicated.repositories[0];
  assert.ok(firstRepository);
  duplicated.repositories = [firstRepository, firstRepository];
  writeFileSync(pointerPath, `${JSON.stringify(duplicated, null, 2)}\n`);
  assert.throws(() => loadWorkItem(workspace, created.item.id), (error: unknown) =>
    error instanceof WorkItemError && /pointer repositories/.test(error.message));
});

test("a symlinked work-item directory cannot redirect current.json", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: "Keep the store inside." });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const itemDir = join(workspace, "var/projects/demo/work-items", created.item.id);
  const outside = tempDir("work-store-outside-");
  const before = readFileSync(join(itemDir, "current.json"), "utf8");
  renameSync(itemDir, outside);
  symlinkSync(outside, itemDir);
  const bindingPath = join(workspace, "var/local/bindings/demo.json");
  const binding = JSON.parse(readFileSync(bindingPath, "utf8")) as { root: string };
  binding.root = join(tempDir("work-binding-missing-"), "gone");
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  assert.throws(() => exploreWorkItem({ workspace, workItemId: created.item.id }), (error: unknown) =>
    error instanceof WorkItemError);
  assert.equal(readFileSync(join(outside, "current.json"), "utf8"), before);
});

test("a nested store symlink cannot redirect the work item pointer", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: "Keep the nested store inside." });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const projectDir = join(workspace, "var/projects/demo");
  const outside = tempDir("work-nested-outside-");
  const before = readFileSync(join(projectDir, "work-items", created.item.id, "current.json"), "utf8");
  renameSync(projectDir, join(outside, "demo"));
  symlinkSync(join(outside, "demo"), projectDir);
  const bindingPath = join(workspace, "var/local/bindings/demo.json");
  const binding = JSON.parse(readFileSync(bindingPath, "utf8")) as { root: string };
  binding.root = join(tempDir("work-binding-missing-"), "gone");
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  assert.throws(() => exploreWorkItem({ workspace, workItemId: created.item.id }), (error: unknown) =>
    error instanceof WorkItemError);
  assert.equal(readFileSync(join(outside, "demo", "work-items", created.item.id, "current.json"), "utf8"), before);
});

test("tampered work item, specification, and exploration content fail closed", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id, cwd: workspace, specificationPath: specFile(workspace) });
  exploreWorkItem({ workspace, workItemId: created.item.id });
  const root = join(workspace, "var/projects/demo/work-items", created.item.id);
  const itemPath = join(root, "item.json");
  const item = JSON.parse(readFileSync(itemPath, "utf8")) as { objective: string };
  const itemBytes = readFileSync(itemPath, "utf8");
  item.objective = "A different objective.";
  writeFileSync(itemPath, `${JSON.stringify(item, null, 2)}\n`);
  assert.throws(() => loadWorkItem(workspace, created.item.id), (error: unknown) => error instanceof WorkItemError);
  writeFileSync(itemPath, itemBytes);

  const loaded = loadWorkItem(workspace, created.item.id);
  assert.ok(loaded?.pointer.specificationId);
  const specPath = join(root, "specifications", `${loaded.pointer.specificationId}.json`);
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as { acceptanceCriteria: Array<{ id: string; statement: string }> };
  const specBytes = readFileSync(specPath, "utf8");
  spec.acceptanceCriteria.push({ id: "ac-forged", statement: "Forged criterion." });
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  assert.throws(() => planWorkItem({ workspace, workItemId: created.item.id }), (error: unknown) => error instanceof WorkItemError);
  writeFileSync(specPath, specBytes);

  const serverId = loaded.pointer.repositories.find((repository) => repository.repositoryId === "server")?.explorationId;
  assert.ok(serverId);
  const explorationPath = join(root, "explorations", "server", `${serverId}.json`);
  const exploration = JSON.parse(readFileSync(explorationPath, "utf8")) as { evidence: Array<Record<string, string>> };
  exploration.evidence.push({
    id: "evidence-aaaaaaaaaaaa",
    repositoryId: "server",
    path: "src/forged.ts",
    relation: "direct",
    reason: "forged",
  });
  writeFileSync(explorationPath, `${JSON.stringify(exploration, null, 2)}\n`);
  assert.throws(() => loadExploration(workspace, "demo", created.item.id, "server", serverId), (error: unknown) =>
    error instanceof WorkItemError);
});

test("a symlinked exploration artifact fails closed", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id });
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  const serverId = explored.pointer.repositories.find((repository) => repository.repositoryId === "server")?.explorationId;
  assert.ok(serverId);
  const explorationPath = join(workspace, "var/projects/demo/work-items", created.item.id, "explorations", "server", `${serverId}.json`);
  const outside = tempDir("work-exploration-outside-");
  const outsideFile = join(outside, `${serverId}.json`);
  const before = readFileSync(explorationPath, "utf8");
  renameSync(explorationPath, outsideFile);
  symlinkSync(outsideFile, explorationPath);
  assert.throws(() => loadExploration(workspace, "demo", created.item.id, "server", serverId), (error: unknown) =>
    error instanceof WorkItemError);
  assert.equal(readFileSync(outsideFile, "utf8"), before);
});

test("a stale checkout blocks planning and an open question blocks planning", () => {
  const { workspace, server } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id, cwd: workspace, specificationPath: specFile(workspace) });
  exploreWorkItem({ workspace, workItemId: created.item.id });
  write(server, "src/occurrences.resolver.ts", "export class OccurrenceResolver { stale = true; }\n");
  const stale = planWorkItem({ workspace, workItemId: created.item.id });
  assert.equal(stale.outcome, "blocked");
  assert.equal(stale.reason, "stale-exploration");
  assert.equal(existsSyncSafe(join(workspace, "var/projects/demo/work-items", created.item.id, "coordinated")), false);

  const fresh = onboardPair();
  const openItem = createWorkItem({ workspace: fresh.workspace, projectId: "demo", objective: OBJECTIVE });
  const spec = join(fresh.workspace, "open.json");
  writeFileSync(spec, `${JSON.stringify({
    objective: OBJECTIVE,
    acceptanceCriteria: [{ id: "ac-create", statement: "A suggestion can be created from an existing occurrence." }],
    openQuestions: ["Which fields are copied?"],
  })}\n`);
  specifyWorkItem({ workspace: fresh.workspace, workItemId: openItem.item.id, cwd: fresh.workspace, specificationPath: spec });
  exploreWorkItem({ workspace: fresh.workspace, workItemId: openItem.item.id });
  const blocked = planWorkItem({ workspace: fresh.workspace, workItemId: openItem.item.id });
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.reason, "needs-product-decision");
  assert.match(blocked.statement, /open questions/);
  assert.equal(existsSyncSafe(join(fresh.workspace, "var/projects/demo/work-items", openItem.item.id, "coordinated")), false);
  assert.equal(existsSyncSafe(join(fresh.workspace, "var/projects/demo/work-items", openItem.item.id, "repositories")), false);
});

test("an exploration for another specification or repository cannot plan", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id, cwd: workspace, specificationPath: specFile(workspace) });
  const explored = exploreWorkItem({ workspace, workItemId: created.item.id });
  const serverId = explored.pointer.repositories.find((repository) => repository.repositoryId === "server")?.explorationId;
  const webId = explored.pointer.repositories.find((repository) => repository.repositoryId === "web")?.explorationId;
  assert.ok(serverId && webId);
  const root = join(workspace, "var/projects/demo/work-items", created.item.id);
  const webPath = join(root, "explorations", "web", `${webId}.json`);
  writeFileSync(webPath, readFileSync(join(root, "explorations", "server", `${serverId}.json`), "utf8"));
  assert.throws(() => planWorkItem({ workspace, workItemId: created.item.id }), (error: unknown) => error instanceof WorkItemError);

  const again = onboardPair();
  const item = createWorkItem({ workspace: again.workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace: again.workspace, workItemId: item.item.id, cwd: again.workspace, specificationPath: specFile(again.workspace) });
  const first = exploreWorkItem({ workspace: again.workspace, workItemId: item.item.id });
  const replacement = join(again.workspace, "replacement.json");
  writeFileSync(replacement, `${JSON.stringify({
    objective: OBJECTIVE,
    acceptanceCriteria: [{ id: "ac-other", statement: "A different accepted outcome." }],
  })}\n`);
  specifyWorkItem({ workspace: again.workspace, workItemId: item.item.id, cwd: again.workspace, specificationPath: replacement });
  const pointerPath = join(again.workspace, "var/projects/demo/work-items", item.item.id, "current.json");
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { repositories: unknown };
  pointer.repositories = first.pointer.repositories;
  writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`);
  assert.throws(() => planWorkItem({ workspace: again.workspace, workItemId: item.item.id }), (error: unknown) =>
    error instanceof WorkItemError);
});

test("tampered repository plan content fails closed", () => {
  const { workspace } = onboardPair();
  const created = createWorkItem({ workspace, projectId: "demo", objective: OBJECTIVE });
  specifyWorkItem({ workspace, workItemId: created.item.id, cwd: workspace, specificationPath: specFile(workspace) });
  exploreWorkItem({ workspace, workItemId: created.item.id });
  const planned = planWorkItem({ workspace, workItemId: created.item.id });
  const planId = planned.pointer.repositories.find((repository) => repository.repositoryId === "server")?.repositoryPlanId;
  assert.ok(planId);
  const planPath = join(workspace, "var/projects/demo/work-items", created.item.id, "repositories", "server", "plans", `${planId}.json`);
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as { unknowns: string[] };
  plan.unknowns.push("forged");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  assert.throws(() => loadRepositoryPlan(workspace, "demo", created.item.id, "server", planId, OBJECTIVE), (error: unknown) =>
    error instanceof WorkItemError);
  assert.ok(planned.coordinatedPlanId);
  const coordinatedId = planned.coordinatedPlanId;
  const coordinatedPath = join(workspace, "var/projects/demo/work-items", created.item.id, "coordinated", `${coordinatedId}.json`);
  const coordinated = JSON.parse(readFileSync(coordinatedPath, "utf8")) as { repositories: Array<{ relevance: string }> };
  const first = coordinated.repositories[0];
  assert.ok(first);
  first.relevance = first.relevance === "RELEVANT" ? "NOT_RELEVANT" : "RELEVANT";
  writeFileSync(coordinatedPath, `${JSON.stringify(coordinated, null, 2)}\n`);
  assert.throws(() => loadCoordinatedPlan(workspace, "demo", created.item.id, coordinatedId), (error: unknown) =>
    error instanceof WorkItemError);
});

test("work-item CLI rejects mixed path mode and does not require init", () => {
  const { workspace, server } = onboardPair();
  const created = runCli(workspace, ["work", "create", "--project", "demo", "--task", OBJECTIVE, "--json"]);
  assert.equal(created.status, 0, created.stderr);
  const body = JSON.parse(created.stdout) as { workItemId: string };
  const mixed = runCli(workspace, ["plan", server, "--work-item", body.workItemId]);
  assert.equal(mixed.status, 2);
  assert.match(mixed.stderr, /cannot be combined/);
  const legacy = runCli(workspace, ["plan", server, "--task", "Add a README"]);
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /azevedo\.config\.yaml|not a safe/);
});

function gitStatus(directory: string): string {
  return spawnSync("git", ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain=v1"], {
    cwd: directory,
    encoding: "utf8",
  }).stdout ?? "";
}

function specFile(workspace: string): string {
  const path = join(workspace, "spec.json");
  writeFileSync(path, `${JSON.stringify({
    objective: OBJECTIVE,
    acceptanceCriteria: [{ id: "ac-create", statement: "A suggestion can be created from an existing occurrence." }],
  })}\n`);
  return path;
}

function existsSyncSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
