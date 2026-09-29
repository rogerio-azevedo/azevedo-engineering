import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  PROJECT_FACT_DETECTORS,
  ReviewEvidenceSchema,
  acceptProjectKnowledge,
  buildProjectContext,
  captureTargetFingerprint,
  coverageSatisfies,
  loadProject,
  onboardProject,
  providedCoverage,
  requiredCoverage,
  slugify,
  submitProjectKnowledge,
  writeImmutableJson,
  writeRegistryPointer,
  type ProjectFact,
} from "../../src/index.js";
import { commitAll, git, gitIdentity, initRepo, tempDir, write, writePackage } from "./fixtures.js";

function factByKey(facts: readonly ProjectFact[], key: string): ProjectFact | undefined {
  return facts.find((fact) => fact.key === key);
}

function allFacts(context: ReturnType<typeof buildProjectContext>): ProjectFact[] {
  return [
    ...context.facts.current,
    ...context.facts.weakSignals,
    ...context.facts.needsRevalidation,
    ...context.facts.stale,
    ...context.facts.conflicted,
  ];
}

function registryBytes(workspace: string): string {
  const root = join(workspace, "var");
  const chunks: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else chunks.push(readFileSync(path, "utf8"));
    }
  };
  visit(root);
  return chunks.join("\n");
}

function nestRepo(directory: string): void {
  initRepo(directory);
  writePackage(directory, {
    "@nestjs/core": "10.0.0",
    "@prisma/client": "5.0.0",
    prisma: "5.0.0",
    typescript: "5.0.0",
    jest: "29.0.0",
  }, {
    test: "jest",
    build: "tsc",
    lint: "eslint .",
    typecheck: "tsc --noEmit",
  });
  write(directory, "package-lock.json", "{\"lockfileVersion\":3}\n");
  write(directory, "nest-cli.json", "{\"collection\":\"@nestjs/schematics\"}\n");
  write(directory, "tsconfig.json", "{\"compilerOptions\":{}}\n");
  write(directory, "jest.config.js", "module.exports = {};\n");
  write(directory, "src/main.ts", "import { NestFactory } from \"@nestjs/core\";\nexport const app = NestFactory;\n");
  write(directory, "prisma/schema.prisma", "generator client {\n  provider = \"prisma-client-js\"\n}\ndatasource db {\n  provider = \"postgresql\"\n  url = env(\"DATABASE_URL\")\n}\n");
  commitAll(directory, "init");
}

test("project ids are stable slugs and detectors do not declare behavior claims", () => {
  assert.equal(slugify("Síndico Pro"), "sindico-pro");
  assert.equal(slugify("SindicoPro"), "sindico-pro");
  for (const detector of PROJECT_FACT_DETECTORS) {
    for (const claim of detector.claims) assert.notEqual(claim.form, "behavior");
  }
  const behavior = { form: "behavior" as const, scope: { level: "repository" as const, repositoryIds: ["root"], pathPrefixes: ["src"] } };
  const existence = { form: "existence" as const, scope: { level: "path" as const, repositoryIds: ["root"], pathPrefixes: ["prisma/schema.prisma"] } };
  assert.equal(coverageSatisfies(requiredCoverage(behavior), providedCoverage(behavior, [])), false);
  assert.equal(requiredCoverage(existence).complete, true);
});

test("single-repo onboarding is deterministic, evidence-backed, and repeatable", () => {
  const target = tempDir("single-");
  const workspace = tempDir("workspace-");
  nestRepo(target);
  const first = onboardProject({ workspace, target, name: "Síndico Pro" });
  const second = onboardProject({ workspace, target });
  assert.equal(first.outcome, "created");
  assert.equal(first.projectId, "sindico-pro");
  assert.equal(second.outcome, "unchanged");
  assert.equal(second.operations.length, 0);
  const loaded = loadProject(workspace, "sindico-pro");
  assert.equal(loaded.definition.repositories[0]?.repositoryId, "root");
  assert.equal(loaded.snapshot.previousSnapshotId, null);
  assert.equal(existsSync(join(workspace, "var", "projects", "sindico-pro", "HEAD")), false);
  const context = buildProjectContext(workspace, "sindico-pro");
  const nest = factByKey(context.facts.current, "framework.nestjs");
  const prisma = factByKey(context.facts.current, "persistence.prisma");
  const provider = factByKey(context.facts.current, "persistence.provider");
  assert.equal(nest?.evidenceQuality, "corroborated");
  assert.equal(prisma?.evidenceQuality, "corroborated");
  assert.equal(provider?.value.kind === "text" ? provider.value.text : "", "postgresql");
  assert.ok(factByKey(context.facts.current, "capability.test"));
  assert.ok(factByKey(context.facts.current, "testing.jest"));
  for (const fact of allFacts(context)) {
    assert.ok(fact.supports.length > 0);
    for (const support of fact.supports) assert.ok(loaded.snapshot.observations.some((observation) => observation.id === support));
  }
  assert.equal(loaded.snapshot.knowledge.length, 0);
  assert.equal(context.boundaries.authorizesMutation, false);
  assert.equal(context.boundaries.replacesExploration, false);
  assert.equal(context.boundaries.reviewTrust, "untrusted-context");
  assert.equal(context.repositories[0]?.role, null);
});

test("project groups keep repository evidence separate and do not invent roles", () => {
  const container = tempDir("group-");
  const workspace = tempDir("workspace-group-");
  const api = join(container, "api");
  const web = join(container, "web");
  initRepo(api);
  writePackage(api, { "@nestjs/core": "10.0.0" });
  write(api, "nest-cli.json", "{}\n");
  commitAll(api, "api");
  git(api, ["worktree", "add", "--detach", join(container, "api-wt"), "HEAD"]);
  initRepo(web);
  writePackage(web, { next: "14.0.0" });
  write(web, "next.config.js", "module.exports = {};\n");
  commitAll(web, "web");
  initRepo(join(container, ".hidden"));
  write(join(container, ".hidden"), "README.md", "hidden\n");
  commitAll(join(container, ".hidden"), "hidden");
  write(container, "server.pem", "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-read\n");
  const report = onboardProject({ workspace, target: container, projectId: "group-demo" });
  assert.equal(report.outcome, "created");
  const loaded = loadProject(workspace, "group-demo");
  assert.equal(loaded.snapshot.layout, "project-group");
  assert.deepEqual(loaded.definition.repositories.map((repository) => repository.repositoryId), ["api", "web"]);
  assert.equal(loaded.snapshot.repositories.some((repository) => repository.repositoryId === "api-wt"), false);
  const context = buildProjectContext(workspace, "group-demo");
  assert.ok(context.repositories.every((repository) => repository.role === null && repository.roleBasis === "no-evidence"));
  const observations = new Map(loaded.snapshot.observations.map((observation) => [observation.id, observation]));
  for (const fact of loaded.snapshot.facts) {
    if (!fact.repositoryId) continue;
    for (const support of fact.supports) assert.equal(observations.get(support)?.location.repositoryId, fact.repositoryId);
  }
  const pem = loaded.snapshot.observations.find((observation) => observation.location.path === "server.pem");
  assert.equal(pem?.location.repositoryId, null);
  assert.equal(pem?.sensitive, true);
  assert.equal(registryBytes(workspace).includes("not-read"), false);
});

test("unknown ecosystems stay unknown and irrelevant dependencies do not become facts", () => {
  const target = tempDir("go-");
  const workspace = tempDir("workspace-go-");
  initRepo(target);
  write(target, "go.mod", "module example.com/demo\n\ngo 1.22\n");
  commitAll(target, "init");
  onboardProject({ workspace, target, projectId: "go-demo" });
  const context = buildProjectContext(workspace, "go-demo");
  assert.equal(factByKey(allFacts(context), "framework.nestjs"), undefined);
  assert.equal(factByKey(allFacts(context), "persistence.provider"), undefined);
  assert.ok(context.unknowns.some((unknown) => unknown.topic === "ecosystem.go"));
  const noisy = tempDir("noisy-");
  const noisyWorkspace = tempDir("workspace-noisy-");
  initRepo(noisy);
  const dependencies = Object.fromEntries(Array.from({ length: 40 }, (_value, index) => [`leftpad${index}`, "1.0.0"]));
  dependencies.lodash = "4.17.21";
  writePackage(noisy, dependencies);
  commitAll(noisy, "init");
  const noisyReport = onboardProject({ workspace: noisyWorkspace, target: noisy, projectId: "noisy" });
  const noisyProject = loadProject(noisyWorkspace, "noisy");
  assert.ok(noisyReport.summary.facts < 40);
  assert.equal(JSON.stringify(noisyProject.snapshot.facts).includes("lodash"), false);
  assert.equal(JSON.stringify(noisyProject.snapshot.facts).includes("leftpad"), false);
  assert.equal(noisyProject.snapshot.knowledge.length, 0);
});

test("weak dependency signals stay weak", () => {
  const target = tempDir("weak-");
  const workspace = tempDir("workspace-weak-");
  initRepo(target);
  writePackage(target, { express: "4.0.0", pg: "8.0.0" });
  commitAll(target, "init");
  onboardProject({ workspace, target, projectId: "weak" });
  const context = buildProjectContext(workspace, "weak");
  assert.equal(factByKey(context.facts.current, "framework.express"), undefined);
  assert.equal(factByKey(context.facts.weakSignals, "framework.express")?.evidenceQuality, "indirect");
  assert.equal(factByKey(context.facts.weakSignals, "persistence.postgresql")?.evidenceQuality, "indirect");
});

test("onboarding does not mutate the target or persist secret values", () => {
  const target = tempDir("secret-");
  const workspace = tempDir("workspace-secret-");
  initRepo(target);
  writePackage(target, {}, { start: "DB_PASSWORD=hunter2 node index.js" });
  write(target, ".env", "API_KEY=super-secret-value-xyz\n");
  write(target, ".env.local", "TOKEN=env-local-secret-value\n");
  write(target, ".npmrc", "_authToken=npm-token-value-xyz\n");
  write(target, "server.pem", "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-material\n");
  write(target, "server.key", "key-secret-material-xyz\n");
  write(target, "credentials.json", "{\"apiKey\":\"akia-fake-value\"}\n");
  write(target, "service-account.json", "{\"private_key\":\"service-account-secret-value\"}\n");
  write(target, "tracked.txt", "tracked\n");
  write(target, "untracked.txt", "untracked\n");
  commitAll(target, "init");
  git(target, ["remote", "add", "origin", "https://user:s3cret-token@github.com/org/repo.git?token=remote-query-secret"]);
  if (typeof process.getuid !== "function" || process.getuid() !== 0) chmodSync(join(target, ".env"), 0);
  const statusBefore = git(target, ["status", "--porcelain=v1"]);
  const indexBefore = statSync(join(target, ".git", "index")).mtimeMs;
  const before = captureTargetFingerprint(target);
  try {
    const report = onboardProject({ workspace, target, projectId: "secret-demo" });
    assert.equal(report.outcome, "created");
    assert.equal(captureTargetFingerprint(target), before);
    assert.equal(statSync(join(target, ".git", "index")).mtimeMs, indexBefore);
    assert.equal(git(target, ["status", "--porcelain=v1"]), statusBefore);
  } finally {
    if (typeof process.getuid !== "function" || process.getuid() !== 0) chmodSync(join(target, ".env"), 0o644);
  }
  for (const forbidden of [".azevedo", "AGENTS.md", "azevedo.config.yaml", "var"]) {
    assert.equal(existsSync(join(target, forbidden)), false);
  }
  const stored = registryBytes(workspace);
  for (const secret of ["super-secret-value-xyz", "env-local-secret-value", "npm-token-value-xyz", "fake-key-material", "key-secret-material-xyz", "akia-fake-value", "service-account-secret-value", "hunter2", "s3cret-token", "remote-query-secret"]) {
    assert.equal(stored.includes(secret), false, secret);
  }
  assert.throws(() => onboardProject({ workspace: target, target }), /overlap/i);
});

test("history is immutable, corrupt pointers fail closed, and identity ignores local paths", () => {
  const left = tempDir("port-a-");
  const right = tempDir("port-b-");
  const workspaceA = tempDir("workspace-a-");
  const workspaceB = tempDir("workspace-b-");
  for (const directory of [left, right]) {
    initRepo(directory);
    write(directory, "README.md", "same\n");
    commitAll(directory, "init");
  }
  const first = onboardProject({ workspace: workspaceA, target: left, projectId: "portable", name: "Portable" });
  const other = onboardProject({ workspace: workspaceB, target: right, projectId: "portable", name: "Portable" });
  const loadedA = loadProject(workspaceA, "portable");
  const loadedB = loadProject(workspaceB, "portable");
  assert.equal(loadedA.snapshot.definitionDigest, loadedB.snapshot.definitionDigest);
  assert.equal(loadedA.snapshot.id, loadedB.snapshot.id);
  assert.equal(buildProjectContext(workspaceA, "portable").digest, buildProjectContext(workspaceB, "portable").digest);
  assert.notEqual(loadedA.binding?.root, loadedB.binding?.root);
  const snapshotPath = join(workspaceA, "var", "projects", "portable", "snapshots", `${first.snapshotId}.json`);
  const currentPath = join(workspaceA, "var", "projects", "portable", "current.json");
  const bindingPath = join(workspaceA, "var", "local", "bindings", "portable.json");
  const original = readFileSync(snapshotPath);
  const currentMtime = statSync(currentPath).mtimeMs;
  const bindingMtime = statSync(bindingPath).mtimeMs;
  const updatedTarget = onboardProject({ workspace: workspaceA, target: left });
  assert.equal(updatedTarget.outcome, "unchanged");
  assert.equal(readFileSync(snapshotPath).equals(original), true);
  assert.equal(statSync(currentPath).mtimeMs, currentMtime);
  assert.equal(statSync(bindingPath).mtimeMs, bindingMtime);
  write(left, "README.md", "changed\n");
  commitAll(left, "change", { ...gitIdentity, GIT_AUTHOR_DATE: "2026-03-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-03-01T00:00:00Z" });
  const updated = onboardProject({ workspace: workspaceA, target: left });
  assert.equal(updated.outcome, "updated");
  assert.equal(loadProject(workspaceA, "portable").snapshot.previousSnapshotId, first.snapshotId);
  assert.equal(readFileSync(snapshotPath).equals(original), true);
  const pointerPath = join(workspaceA, "var", "projects", "portable", "current.json");
  const pointer = readFileSync(pointerPath, "utf8");
  writeFileSync(pointerPath, "{}\n");
  assert.throws(() => loadProject(workspaceA, "portable"), /corrupt|incompatible|unreadable/i);
  writeFileSync(pointerPath, pointer);
  const projectJson = join(workspaceA, "var", "projects", "portable", "project.json");
  const projectText = readFileSync(projectJson, "utf8");
  writeFileSync(projectJson, projectText.replace("\"schemaVersion\": 1", "\"schemaVersion\": 2"));
  assert.throws(() => loadProject(workspaceA, "portable"), /incompatible|corrupt/i);
  writeFileSync(projectJson, projectText);
  assert.equal(writeImmutableJson(workspaceA, `var/projects/portable/snapshots/${first.snapshotId}.json`, { schemaVersion: 1, changed: true }), "conflict");
  assert.throws(() => writeRegistryPointer(workspaceA, {
    schemaVersion: 1,
    projectId: "portable",
    snapshotId: other.snapshotId ?? "",
    snapshotDigest: loadedB.pointer.snapshotDigest,
  }, "snapshot-0000000000000000"), /concurrently/i);
  assert.equal(readFileSync(pointerPath, "utf8"), pointer);
});

test("revalidation follows claim scope and does not promote task evidence", () => {
  const target = tempDir("stale-");
  const workspace = tempDir("workspace-stale-");
  initRepo(target);
  writePackage(target, { "@prisma/client": "5.0.0", prisma: "5.0.0" }, { test: "jest" });
  write(target, "package-lock.json", "{\"lockfileVersion\":3}\n");
  write(target, "prisma/schema.prisma", "datasource db {\n  provider = \"postgresql\"\n}\n");
  write(target, "src/auth/auth.guard.ts", "export class AuthGuard {}\n");
  mkdirSync(join(target, "src", "modules"), { recursive: true });
  for (let index = 0; index < 51; index += 1) write(target, `src/modules/module-${index}.ts`, "export {}\n");
  commitAll(target, "init");
  onboardProject({ workspace, target, projectId: "stale-demo" });
  const modules = loadProject(workspace, "stale-demo").snapshot.facts.find((fact) => fact.key === "architecture.modules");
  assert.equal(modules?.status, "needs-revalidation");
  assert.equal(modules?.claim.form, "enumeration");
  write(target, "README.md", "docs\n");
  commitAll(target, "docs", { ...gitIdentity, GIT_AUTHOR_DATE: "2026-04-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-04-01T00:00:00Z" });
  const reread = buildProjectContext(workspace, "stale-demo");
  assert.equal(factByKey(reread.facts.current, "persistence.prisma")?.status, "validated");
  assert.ok(reread.notices.some((notice) => notice.code === "revision-changed"));
  const guard = loadProject(workspace, "stale-demo").snapshot.observations.find((observation) => observation.location.path.endsWith("auth.guard.ts"));
  assert.ok(guard);
  const submitted = submitProjectKnowledge(workspace, "stale-demo", {
    kind: "convention",
    statement: "All protected routes use AuthGuard.",
    claim: { form: "behavior", scope: { level: "repository", repositoryIds: ["root"], pathPrefixes: ["src"] } },
    supports: [guard.id],
    factRefs: [],
    submittedBy: "explicit-submission",
  });
  assert.equal(submitted.state, "candidate");
  assert.equal(buildProjectContext(workspace, "stale-demo").knowledge.candidateCount, 1);
  assert.equal(buildProjectContext(workspace, "stale-demo").knowledge.current.length, 0);
  acceptProjectKnowledge(workspace, "stale-demo", submitted.id, "human");
  write(target, "src/routes/extra.ts", "export const extra = true;\n");
  commitAll(target, "route", { ...gitIdentity, GIT_AUTHOR_DATE: "2026-05-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-05-01T00:00:00Z" });
  const afterRoute = buildProjectContext(workspace, "stale-demo");
  assert.equal(afterRoute.knowledge.current.length, 0);
  assert.equal(afterRoute.knowledge.needsRevalidation.length, 1);
  assert.equal(factByKey(afterRoute.facts.current, "persistence.prisma")?.status, "validated");
  writeFileSync(join(target, "prisma", "schema.prisma"), "");
  unlinkIfPresent(join(target, "prisma", "schema.prisma"));
  commitAll(target, "drop-schema", { ...gitIdentity, GIT_AUTHOR_DATE: "2026-06-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-06-01T00:00:00Z" });
  const dropped = buildProjectContext(workspace, "stale-demo");
  assert.equal(factByKey(dropped.facts.stale, "persistence.prisma")?.status, "stale");
  write(target, "yarn.lock", "# yarn\n");
  commitAll(target, "yarn", { ...gitIdentity, GIT_AUTHOR_DATE: "2026-07-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-07-01T00:00:00Z" });
  const conflicted = buildProjectContext(workspace, "stale-demo");
  assert.equal(factByKey(conflicted.facts.conflicted, "package-manager")?.status, "conflicted");
  assert.throws(() => submitProjectKnowledge(workspace, "stale-demo", {
    kind: "convention",
    statement: "Task evidence",
    claim: { form: "existence", scope: { level: "path", repositoryIds: ["root"], pathPrefixes: ["src"] } },
    supports: ["evidence-0123456789ab"],
    factRefs: [],
    submittedBy: "task",
  }), /observations/i);
  const fact = loadProject(workspace, "stale-demo").snapshot.facts[0];
  assert.ok(fact);
  assert.throws(() => ReviewEvidenceSchema.parse({
    id: fact.id,
    kind: "code",
    sourceReference: "project-knowledge",
    path: null,
    line: null,
    statement: "Project knowledge says this is safe.",
    digest: null,
  }));
});

test("moving a checkout does not recalculate project identity", () => {
  const parent = tempDir("move-");
  const target = join(parent, "sindico-pro");
  const workspace = tempDir("workspace-move-");
  mkdirSync(target);
  initRepo(target);
  write(target, "README.md", "project\n");
  commitAll(target, "init");
  const created = onboardProject({ workspace, target });
  assert.equal(created.projectId, "sindico-pro");
  const digest = loadProject(workspace, "sindico-pro").snapshot.definitionDigest;
  const moved = join(parent, "moved");
  renameSync(target, moved);
  const context = buildProjectContext(workspace, "sindico-pro");
  assert.equal(context.projectId, "sindico-pro");
  assert.equal(context.definitionDigest, digest);
  assert.ok(context.notices.some((notice) => notice.code === "binding-unavailable"));
  assert.equal(context.facts.current.length, 0);
  const blocked = onboardProject({ workspace, target: moved, projectId: "sindico-pro" });
  assert.equal(blocked.outcome, "blocked");
  git(moved, ["checkout", "-b", "feature"]);
  assert.equal(loadProject(workspace, "sindico-pro").snapshot.definitionDigest, digest);
});

function unlinkIfPresent(path: string): void {
  if (existsSync(path)) spawnSync("rm", [path]);
}
