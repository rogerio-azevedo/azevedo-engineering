import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import {
  AZEVEDO_LOCAL_README_CONTENT,
  CODEX_AGENTS_CONTENT,
  ProjectInitPlanSchema,
  applyInitPlan,
  buildInitPlan,
  createCodexInitializationArtifacts,
  createInspectResult,
  renderAzevedoConfig,
} from "../../src/index.js";

const cliPath = resolve("dist/src/cli.js");
const expectedConfig = renderAzevedoConfig("codex");
const expectedSpecialists = Object.fromEntries(
  createCodexInitializationArtifacts()
    .filter((artifact) => artifact.path.endsWith(".toml"))
    .map((artifact) => [artifact.path, artifact.content]),
);

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: resolve("."),
    encoding: "utf8",
  });
}

function createProject(name = "init-project", packageManager = "npm@11.0.0"): string {
  const root = mkdtempSync(join(tmpdir(), "azevedo-init-project-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name,
    packageManager,
    scripts: {
      test: "node -e \"require('node:fs').writeFileSync('script-ran.txt', 'bad')\"",
    },
    devDependencies: { typescript: "5.9.3" },
  }));
  writeFileSync(join(root, "existing.ts"), "export const existing = true;\n");
  return root;
}

function createGroup(): string {
  const root = mkdtempSync(join(tmpdir(), "azevedo-init-group-"));
  mkdirSync(join(root, "api"));
  mkdirSync(join(root, "web"));
  writeFileSync(join(root, "api", "package.json"), JSON.stringify({
    name: "api",
    packageManager: "npm@11.0.0",
  }));
  writeFileSync(join(root, "web", "package.json"), JSON.stringify({
    name: "web",
    packageManager: "pnpm@11.24.0",
  }));
  return root;
}

function snapshotDirectory(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split("\\").join("/");
      const stats = lstatSync(path);
      hash.update(`${entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file"}:${relativePath}:${stats.mode}\0`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
}

function managedContents(root: string) {
  return {
    config: readFileSync(join(root, "azevedo.config.yaml"), "utf8"),
    agents: readFileSync(join(root, "AGENTS.md"), "utf8"),
    readme: readFileSync(join(root, ".azevedo", "README.md"), "utf8"),
    specialists: Object.fromEntries(
      Object.keys(expectedSpecialists).map((path) => [path, readFileSync(join(root, path), "utf8")]),
    ),
  };
}

test("init creates the minimal project-local bootstrap without executing project code", () => {
  const root = createProject();
  const existingBefore = readFileSync(join(root, "existing.ts"));
  const execution = runCli("init", root);

  assert.equal(execution.status, 0);
  assert.equal(execution.stderr, "");
  assert.match(execution.stdout, /Initialization completed/);
  assert.deepEqual(managedContents(root), {
    config: expectedConfig,
    agents: CODEX_AGENTS_CONTENT,
    readme: AZEVEDO_LOCAL_README_CONTENT,
    specialists: expectedSpecialists,
  });
  const serializedManaged = JSON.stringify(managedContents(root));
  assert.doesNotMatch(serializedManaged, /\/Users\//);
  assert.doesNotMatch(serializedManaged, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(existsSync(join(root, ".gitignore")), false);
  assert.equal(existsSync(join(root, "node_modules")), false);
  assert.equal(existsSync(join(root, "script-ran.txt")), false);
  assert.deepEqual(readFileSync(join(root, "existing.ts")), existingBefore);
});

test("a second init is idempotent and does not rewrite unchanged files", () => {
  const root = createProject();
  assert.equal(runCli("init", root).status, 0);
  const managed = [
    join(root, "azevedo.config.yaml"),
    join(root, "AGENTS.md"),
    join(root, ".azevedo", "README.md"),
    ...Object.keys(expectedSpecialists).map((path) => join(root, path)),
  ];
  const oldTime = new Date("2000-01-01T00:00:00.000Z");
  for (const path of managed) utimesSync(path, oldTime, oldTime);
  const contents = managed.map((path) => readFileSync(path));

  const second = runCli("init", root, "--json");
  const report = JSON.parse(second.stdout) as {
    summary: { create: number; unchanged: number; conflicts: number };
  };

  assert.equal(second.status, 0);
  assert.deepEqual(report.summary, { projects: 1, create: 0, unchanged: 7, conflicts: 0 });
  for (const [index, path] of managed.entries()) {
    assert.deepEqual(readFileSync(path), contents[index]);
    assert.equal(statSync(path).mtimeMs, oldTime.getTime());
  }
});

test("init safely completes the missing Codex roles for a pre-v0.4.1 bootstrap", () => {
  const root = createProject("v04-bootstrap");
  writeFileSync(join(root, "azevedo.config.yaml"), expectedConfig);
  writeFileSync(join(root, "AGENTS.md"), CODEX_AGENTS_CONTENT);
  mkdirSync(join(root, ".azevedo"));
  writeFileSync(join(root, ".azevedo", "README.md"), AZEVEDO_LOCAL_README_CONTENT);

  const execution = runCli("init", root, "--json");
  const report = JSON.parse(execution.stdout) as {
    summary: { create: number; unchanged: number; conflicts: number };
  };
  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(report.summary, { projects: 1, create: 4, unchanged: 3, conflicts: 0 });
  assert.deepEqual(managedContents(root).specialists, expectedSpecialists);
});

test("dry-run human and JSON outputs are deterministic and never write", () => {
  const root = createProject();
  const before = snapshotDirectory(root);
  const human = runCli("init", root, "--dry-run");
  const firstJson = runCli("init", root, "--dry-run", "--json");
  const secondJson = runCli("init", root, "--json", "--dry-run");

  assert.equal(human.status, 0);
  assert.match(human.stdout, /Init Dry Run/);
  assert.match(human.stdout, /CREATE\s+azevedo\.config\.yaml/);
  assert.match(human.stdout, /No files were modified/);
  assert.equal(firstJson.status, 0);
  assert.equal(firstJson.stderr, "");
  assert.equal(firstJson.stdout, secondJson.stdout);
  const report = JSON.parse(firstJson.stdout) as { dryRun: boolean; applied: boolean; blocked: boolean };
  assert.deepEqual(report, { ...report, dryRun: true, applied: false, blocked: false });
  assert.equal(snapshotDirectory(root), before);
});

test("init blocks an unrecognized target and invalid arguments use exit code 2", () => {
  const unknown = mkdtempSync(join(tmpdir(), "azevedo-init-unknown-"));
  const before = snapshotDirectory(unknown);
  const unknownResult = runCli("init", unknown, "--dry-run");
  const forceResult = runCli("init", unknown, "--force");
  const help = runCli("init", "--help");

  assert.equal(unknownResult.status, 1);
  assert.equal(unknownResult.stdout, "");
  assert.match(unknownResult.stderr, /not enough evidence of a recognizable project/);
  assert.equal(snapshotDirectory(unknown), before);
  assert.equal(forceResult.status, 2);
  assert.match(forceResult.stderr, /Unknown option: --force/);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--dry-run/);
  assert.match(help.stdout, /--json/);
  assert.doesNotMatch(help.stdout, /--force/);
});

for (const conflictPath of ["AGENTS.md", "azevedo.config.yaml", ".azevedo/README.md", ".codex/agents/reviewer.toml"]) {
  test(`different existing ${conflictPath} blocks every write`, () => {
    const root = createProject();
    const destination = join(root, conflictPath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "user-owned content\n");
    const before = snapshotDirectory(root);
    const execution = runCli("init", root, "--json");
    const report = JSON.parse(execution.stdout) as { blocked: boolean; summary: { conflicts: number } };

    assert.equal(execution.status, 1);
    assert.equal(execution.stderr, "");
    assert.equal(report.blocked, true);
    assert.equal(report.summary.conflicts, 1);
    assert.equal(snapshotDirectory(root), before);
  });
}

test("dry-run reports conflicts with exit code 1 and performs no writes", () => {
  const root = createProject();
  writeFileSync(join(root, "AGENTS.md"), "existing instructions\n");
  const before = snapshotDirectory(root);
  const execution = runCli("init", root, "--dry-run", "--json");
  const report = JSON.parse(execution.stdout) as { dryRun: boolean; blocked: boolean; outcome: string };

  assert.equal(execution.status, 1);
  assert.equal(execution.stderr, "");
  assert.deepEqual(report, { ...report, dryRun: true, blocked: true, outcome: "blocked" });
  assert.equal(snapshotDirectory(root), before);
});

test("group init plans all projects, initializes both, and writes nothing at the group root", () => {
  const root = createGroup();
  const execution = runCli("init", root, "--json");
  const report = JSON.parse(execution.stdout) as {
    kind: string;
    projects: Array<{ relativePath: string }>;
    summary: { projects: number; create: number; conflicts: number };
  };

  assert.equal(execution.status, 0);
  assert.equal(report.kind, "project-group");
  assert.deepEqual(report.projects.map((project) => project.relativePath), ["api", "web"]);
  assert.equal(report.summary.projects, 2);
  assert.equal(report.summary.create, 14);
  assert.equal(report.summary.conflicts, 0);
  for (const child of ["api", "web"]) assert.deepEqual(managedContents(join(root, child)), {
    config: expectedConfig,
    agents: CODEX_AGENTS_CONTENT,
    readme: AZEVEDO_LOCAL_README_CONTENT,
    specialists: expectedSpecialists,
  });
  assert.equal(existsSync(join(root, "azevedo.config.yaml")), false);
  assert.equal(existsSync(join(root, "AGENTS.md")), false);
  assert.equal(existsSync(join(root, ".azevedo")), false);
});

test("a conflict in the second group project prevents writes in the first", () => {
  const root = createGroup();
  writeFileSync(join(root, "web", "AGENTS.md"), "web-owned instructions\n");
  const before = snapshotDirectory(root);
  const execution = runCli("init", root);

  assert.equal(execution.status, 1);
  assert.match(execution.stdout, /Status: BLOCKED/);
  assert.equal(snapshotDirectory(root), before);
  assert.equal(existsSync(join(root, "api", "azevedo.config.yaml")), false);
});

test("group dry-run JSON is deterministic and does not write to any project", () => {
  const root = createGroup();
  const before = snapshotDirectory(root);
  const first = runCli("init", root, "--dry-run", "--json");
  const second = runCli("init", root, "--dry-run", "--json");
  const report = JSON.parse(first.stdout) as { projects: Array<{ relativePath: string }> };

  assert.equal(first.status, 0);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(report.projects.map((project) => project.relativePath), ["api", "web"]);
  assert.equal(snapshotDirectory(root), before);
});

test("managed symlinks and incompatible .azevedo entries block initialization", () => {
  const external = mkdtempSync(join(tmpdir(), "azevedo-init-external-"));
  const externalFile = join(external, "external.md");
  writeFileSync(externalFile, "external\n");

  const fileSymlinkRoot = createProject("file-symlink");
  symlinkSync(externalFile, join(fileSymlinkRoot, "AGENTS.md"));
  assert.equal(runCli("init", fileSymlinkRoot).status, 1);
  assert.equal(readFileSync(externalFile, "utf8"), "external\n");
  assert.equal(existsSync(join(fileSymlinkRoot, "azevedo.config.yaml")), false);

  const directorySymlinkRoot = createProject("directory-symlink");
  symlinkSync(external, join(directorySymlinkRoot, ".azevedo"));
  assert.equal(runCli("init", directorySymlinkRoot).status, 1);
  assert.equal(existsSync(join(directorySymlinkRoot, "azevedo.config.yaml")), false);

  const incompatibleRoot = createProject("incompatible-directory");
  writeFileSync(join(incompatibleRoot, ".azevedo"), "not a directory\n");
  assert.equal(runCli("init", incompatibleRoot).status, 1);
  assert.equal(existsSync(join(incompatibleRoot, "azevedo.config.yaml")), false);
});

test("path containment is enforced by both planning and application", () => {
  const root = createProject("containment");
  const inspection = createInspectResult(root);
  const outside = join(root, "..", "escaped-by-init.txt");

  assert.throws(() => buildInitPlan(inspection, [{
    path: "../escaped-by-init.txt",
    content: "unsafe\n",
    ownership: "azevedo-managed",
    order: 1,
  }]), /escapes the project root/);

  const unsafePlan = ProjectInitPlanSchema.parse({
    schemaVersion: 1,
    kind: "project",
    root,
    blocked: false,
    operations: [{
      action: "create",
      path: "../escaped-by-init.txt",
      content: "unsafe\n",
      ownership: "azevedo-managed",
    }],
  });
  assert.throws(() => applyInitPlan(unsafePlan), /escapes the project root/);
  assert.equal(existsSync(outside), false);

  const trailingSeparatorPlan = ProjectInitPlanSchema.parse({
    schemaVersion: 1,
    kind: "project",
    root: `${root}${sep}`,
    blocked: false,
    operations: [{
      action: "create",
      path: "safe.txt",
      content: "safe\n",
      ownership: "azevedo-managed",
    }],
  });
  applyInitPlan(trailingSeparatorPlan);
  assert.equal(readFileSync(join(root, "safe.txt"), "utf8"), "safe\n");
});
