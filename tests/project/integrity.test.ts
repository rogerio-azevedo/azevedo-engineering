import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  findProjectByBindingRoot,
  finishSnapshot,
  loadProject,
  onboardProject,
  sha256Digest,
  type ProjectSnapshot,
} from "../../src/index.js";
import { createRepositoryView } from "../../src/core/project/repository-view.js";
import { commitAll, initRepo, tempDir, write } from "./fixtures.js";

function registryFiles(workspace: string): string[] {
  const projects = join(workspace, "var", "projects");
  const bindings = join(workspace, "var", "local", "bindings");
  return [
    ...(existsSync(projects) ? readdirSync(projects) : []),
    ...(existsSync(bindings) ? readdirSync(bindings) : []),
  ].sort();
}

function pointAt(workspace: string, projectId: string, snapshot: ProjectSnapshot): void {
  const directory = join(workspace, "var", "projects", projectId);
  writeFileSync(join(directory, "snapshots", `${snapshot.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(join(directory, "current.json"), `${JSON.stringify({
    schemaVersion: 1,
    projectId,
    snapshotId: snapshot.id,
    snapshotDigest: sha256Digest(snapshot),
  }, null, 2)}\n`);
}

function withoutId(snapshot: ProjectSnapshot): Omit<ProjectSnapshot, "id"> {
  const { id: _id, ...body } = snapshot;
  return body;
}

test("repository reads stay inside the resolved repository root", () => {
  const root = tempDir("contain-");
  const outside = join(root, "outside");
  const repo = join(root, "repo");
  mkdirSync(join(outside, "modules"), { recursive: true });
  write(outside, "main.ts", "export const outsideFileSecret = 'outside-file-secret';\nexport const NestFactory = true;\n");
  write(outside, "modules/outside-marker.ts", "export const marker = true;\n");
  write(outside, "secret.ts", "export const outsideLooseSecret = 'outside-loose-secret';\n");
  mkdirSync(join(repo, "src"), { recursive: true });
  write(repo, "src/inside.ts", "export const inside = 'inside-value';\n");
  write(repo, "src/main.ts", "export const local = true;\n");
  symlinkSync(join(outside, "secret.ts"), join(repo, "src", "file.ts"));
  symlinkSync(join(repo, "src", "inside.ts"), join(repo, "src", "alias.ts"));
  symlinkSync(outside, join(repo, "escaped"));
  symlinkSync("escaped", join(repo, "nested"));
  symlinkSync(join(repo, "src"), join(repo, "linked-src"));
  const dangling = join(repo, "dangling");
  symlinkSync(join(repo, "missing-target"), dangling);

  const view = createRepositoryView(repo, "root", null);
  assert.equal(view.readText("escaped/main.ts"), null);
  assert.equal(view.readText("../outside/main.ts"), null);
  assert.equal(view.readText(join(outside, "main.ts")), null);
  assert.deepEqual(view.list("escaped/modules").entries, []);
  assert.equal(view.list("escaped/modules").entries.includes("outside-marker.ts"), false);
  assert.equal(view.readText("src/file.ts"), null);
  assert.equal(view.readText("nested/main.ts"), null);
  assert.equal(view.exists("dangling"), false);
  assert.match(view.readText("src/alias.ts") ?? "", /inside-value/);
  assert.deepEqual(view.list("linked-src").entries.includes("inside.ts"), true);
  assert.equal(view.readText("linked-src/inside.ts")?.includes("inside-value"), true);

  const replaced = join(root, "replaced");
  mkdirSync(replaced);
  write(replaced, "package.json", "{\"name\":\"replaced\"}\n");
  symlinkSync(outside, join(replaced, "src"));
  const escapedView = createRepositoryView(replaced, "root", null);
  assert.equal(escapedView.readText("src/main.ts"), null);
  assert.equal(escapedView.list("src/modules").entries.includes("outside-marker.ts"), false);
  initRepo(replaced);
  commitAll(replaced, "init");
  const workspace = tempDir("contain-ws-");
  const report = onboardProject({ workspace, target: replaced, projectId: "contained", name: "Contained" });
  assert.equal(report.outcome, "created");
  const stored = readdirSync(join(workspace, "var", "projects", "contained", "snapshots"))
    .map((name) => readFileSync(join(workspace, "var", "projects", "contained", "snapshots", name), "utf8"))
    .join("\n");
  assert.equal(stored.includes("outside-marker.ts"), false);
  assert.equal(stored.includes("outside-file-secret"), false);
  assert.equal(stored.includes("outside-loose-secret"), false);
});

test("a corrupt binding fails closed and does not create another project", () => {
  const target = tempDir("bind-target-");
  const workspace = tempDir("bind-ws-");
  initRepo(target);
  write(target, "README.md", "project\n");
  commitAll(target, "init");
  const created = onboardProject({ workspace, target, projectId: "bound-demo", name: "Bound" });
  assert.equal(created.outcome, "created");
  assert.equal(findProjectByBindingRoot(workspace, target), "bound-demo");
  const before = registryFiles(workspace);
  const bindingPath = join(workspace, "var", "local", "bindings", "bound-demo.json");
  const original = readFileSync(bindingPath, "utf8");

  writeFileSync(bindingPath, "{");
  const other = tempDir("bind-other-");
  initRepo(other);
  write(other, "README.md", "other\n");
  commitAll(other, "init");
  assert.throws(() => onboardProject({ workspace, target: other, name: "Other" }), /corrupt/i);
  assert.deepEqual(registryFiles(workspace), before);
  assert.equal(readFileSync(bindingPath, "utf8"), "{");

  writeFileSync(bindingPath, "{\"schemaVersion\":1}\n");
  assert.throws(() => onboardProject({ workspace, target: other, name: "Other" }), /corrupt/i);
  assert.deepEqual(registryFiles(workspace), before);

  const binding = JSON.parse(original) as { projectId: string };
  binding.projectId = "someone-else";
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  assert.throws(() => onboardProject({ workspace, target: other, name: "Other" }), /identity does not match/i);
  assert.deepEqual(registryFiles(workspace), before);
  writeFileSync(bindingPath, original);
  assert.equal(loadProject(workspace, "bound-demo").definition.projectId, "bound-demo");
});

test("snapshot history must form one coherent chain", () => {
  const target = tempDir("chain-target-");
  const workspace = tempDir("chain-ws-");
  initRepo(target);
  write(target, "README.md", "one\n");
  commitAll(target, "init");
  const first = onboardProject({ workspace, target, projectId: "chain-demo", name: "Chain" });
  assert.equal(loadProject(workspace, "chain-demo").snapshot.previousSnapshotId, null);
  write(target, "README.md", "two\n");
  commitAll(target, "two");
  const second = onboardProject({ workspace, target, projectId: "chain-demo" });
  const loaded = loadProject(workspace, "chain-demo");
  assert.equal(loaded.snapshot.previousSnapshotId, first.snapshotId);
  assert.equal(second.snapshotId, loaded.snapshot.id);
  const body = withoutId(loaded.snapshot);
  const firstBytes = readFileSync(join(workspace, "var", "projects", "chain-demo", "snapshots", `${first.snapshotId}.json`));

  const missing = finishSnapshot({ ...body, previousSnapshotId: "snapshot-0123456789abcdef" });
  pointAt(workspace, "chain-demo", missing);
  assert.throws(() => loadProject(workspace, "chain-demo"), /missing/i);
  assert.equal(readFileSync(join(workspace, "var", "projects", "chain-demo", "snapshots", `${first.snapshotId}.json`)).equals(firstBytes), true);

  const otherProject = finishSnapshot({ ...body, projectId: "other-project", previousSnapshotId: null });
  const pointsAtOther = finishSnapshot({ ...body, previousSnapshotId: otherProject.id });
  writeFileSync(join(workspace, "var", "projects", "chain-demo", "snapshots", `${otherProject.id}.json`), `${JSON.stringify(otherProject, null, 2)}\n`);
  pointAt(workspace, "chain-demo", pointsAtOther);
  assert.throws(() => loadProject(workspace, "chain-demo"), /different project/i);

  const otherDigest = finishSnapshot({
    ...body,
    definitionDigest: `sha256:${"ab".repeat(32)}`,
    previousSnapshotId: null,
  });
  const pointsAtDigest = finishSnapshot({ ...body, previousSnapshotId: otherDigest.id });
  writeFileSync(join(workspace, "var", "projects", "chain-demo", "snapshots", `${otherDigest.id}.json`), `${JSON.stringify(otherDigest, null, 2)}\n`);
  pointAt(workspace, "chain-demo", pointsAtDigest);
  assert.throws(() => loadProject(workspace, "chain-demo"), /definition digest/i);

  const left: ProjectSnapshot = { ...loaded.snapshot, id: "snapshot-aaaaaaaaaaaaaaaa", previousSnapshotId: "snapshot-bbbbbbbbbbbbbbbb" };
  const right: ProjectSnapshot = { ...loaded.snapshot, id: "snapshot-bbbbbbbbbbbbbbbb", previousSnapshotId: "snapshot-aaaaaaaaaaaaaaaa" };
  writeFileSync(join(workspace, "var", "projects", "chain-demo", "snapshots", `${right.id}.json`), `${JSON.stringify(right, null, 2)}\n`);
  pointAt(workspace, "chain-demo", left);
  assert.throws(() => loadProject(workspace, "chain-demo"), /cycle/i);

  const incoherent: ProjectSnapshot = {
    ...loaded.snapshot,
    repositories: loaded.snapshot.repositories.map((repository) => ({ ...repository, dirty: !repository.dirty })),
  };
  pointAt(workspace, "chain-demo", incoherent);
  assert.throws(() => loadProject(workspace, "chain-demo"), /coherent/i);
  assert.equal(readFileSync(join(workspace, "var", "projects", "chain-demo", "snapshots", `${first.snapshotId}.json`)).equals(firstBytes), true);
});

test("renaming a checkout does not silently reuse or rewrite the existing project", () => {
  const parent = tempDir("rename-");
  const original = join(parent, "alpha");
  const renamed = join(parent, "beta");
  const workspace = tempDir("rename-ws-");
  mkdirSync(original);
  initRepo(original);
  write(original, "README.md", "same\n");
  commitAll(original, "init");
  const created = onboardProject({ workspace, target: original });
  assert.equal(created.projectId, "alpha");
  const definitionPath = join(workspace, "var", "projects", "alpha", "project.json");
  const definition = readFileSync(definitionPath);
  renameSync(original, renamed);
  const again = onboardProject({ workspace, target: renamed });
  assert.equal(again.outcome, "created");
  assert.equal(again.projectId, "beta");
  assert.equal(readFileSync(definitionPath).equals(definition), true);
  assert.equal(loadProject(workspace, "alpha").definition.projectId, "alpha");
  assert.notEqual(loadProject(workspace, "beta").definition.projectId, "alpha");
});
