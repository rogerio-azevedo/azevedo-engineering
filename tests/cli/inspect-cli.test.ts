import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const cliPath = resolve("dist/src/cli.js");
const singleRepo = resolve("tests/fixtures/single-repo");
const monorepo = resolve("tests/fixtures/monorepo");

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: resolve("."),
    encoding: "utf8",
  });
}

function snapshotDirectory(root: string): string {
  const hash = createHash("sha256");

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const portablePath = relative(root, path).split("\\").join("/");
      const stats = lstatSync(path);
      hash.update(`${entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file"}:${portablePath}:${stats.mode}\0`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };

  visit(root);
  return hash.digest("hex");
}

test("inspect --json returns a deterministic canonical result for a Prisma single-repo", () => {
  const first = runCli("inspect", singleRepo, "--json");
  const second = runCli("inspect", singleRepo, "--json");

  assert.equal(first.status, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  assert.doesNotMatch(first.stdout, /Azevedo Engineering/);

  const result = JSON.parse(first.stdout) as {
    inspectedAt?: string;
    topology: { value: string };
    packageManager: { value: string };
    technologies: Array<{ id: string }>;
    capabilities: Array<{ id: string; state: string }>;
    unknowns: string[];
  };
  const technologyIds = new Set(result.technologies.map((technology) => technology.id));

  assert.equal(result.inspectedAt, undefined);
  assert.equal(result.topology.value, "single-repo");
  assert.equal(result.packageManager.value, "npm");
  assert.ok(technologyIds.has("prisma"));
  assert.ok(!technologyIds.has("drizzle"));
  assert.equal(result.capabilities.find((capability) => capability.id === "lint")?.state, "unknown");
  assert.equal(result.capabilities.find((capability) => capability.id === "test")?.state, "detected");
  assert.ok(result.unknowns.includes("lint-command"));
});

test("inspect resolves the current directory and relative project paths consistently", () => {
  const currentDirectory = runCli("inspect", "--json");
  const relativeProject = runCli("inspect", "tests/fixtures/single-repo", "--json");

  assert.equal(currentDirectory.status, 0);
  assert.equal(relativeProject.status, 0);
  assert.equal((JSON.parse(currentDirectory.stdout) as { root: string }).root, resolve("."));
  assert.equal((JSON.parse(relativeProject.stdout) as { root: string }).root, singleRepo);
});

test("inspect --json reports monorepo packages, technologies, capabilities, and package manager", () => {
  const execution = runCli("inspect", monorepo, "--json");
  assert.equal(execution.status, 0);
  assert.equal(execution.stderr, "");

  const result = JSON.parse(execution.stdout) as {
    topology: { value: string };
    packageManager: { value: string };
    packages: string[];
    technologies: Array<{ id: string }>;
    capabilities: Array<{ state: string }>;
  };
  const technologyIds = new Set(result.technologies.map((technology) => technology.id));

  assert.equal(result.topology.value, "monorepo");
  assert.equal(result.packageManager.value, "pnpm");
  assert.ok(result.packages.includes("apps/api"));
  assert.ok(result.packages.includes("apps/web"));
  assert.ok(technologyIds.has("nestjs"));
  assert.ok(technologyIds.has("nextjs"));
  assert.ok(result.capabilities.every((capability) => capability.state === "detected"));
});

test("inspect treats unknown and ambiguous discovery as successful results", () => {
  const unknownRoot = mkdtempSync(join(tmpdir(), "azevedo-cli-unknown-"));
  const unknownExecution = runCli("inspect", unknownRoot, "--json");
  assert.equal(unknownExecution.status, 0);
  const unknown = JSON.parse(unknownExecution.stdout) as {
    topology: { state: string };
    packageManager: { state: string };
    technologies: unknown[];
    unknowns: string[];
  };
  assert.equal(unknown.topology.state, "unknown");
  assert.equal(unknown.packageManager.state, "unknown");
  assert.deepEqual(unknown.technologies, []);
  assert.ok(unknown.unknowns.includes("repository-topology"));

  const ambiguousRoot = mkdtempSync(join(tmpdir(), "azevedo-cli-ambiguous-"));
  writeFileSync(join(ambiguousRoot, "package.json"), JSON.stringify({ name: "ambiguous", packageManager: "npm@11" }));
  writeFileSync(join(ambiguousRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const ambiguousExecution = runCli("inspect", ambiguousRoot, "--json");
  assert.equal(ambiguousExecution.status, 0);
  const ambiguous = JSON.parse(ambiguousExecution.stdout) as {
    packageManager: { state: string; candidates: string[] };
    ambiguities: string[];
  };
  assert.equal(ambiguous.packageManager.state, "ambiguous");
  assert.deepEqual(ambiguous.packageManager.candidates, ["npm", "pnpm"]);
  assert.ok(ambiguous.ambiguities.includes("package-manager"));
});

test("human inspect renders the essential sections from the canonical result", () => {
  const execution = runCli("inspect", singleRepo);

  assert.equal(execution.status, 0);
  assert.equal(execution.stderr, "");
  for (const section of [
    "Azevedo Engineering — Project Inspection",
    "Project",
    "Detected technologies",
    "Capabilities",
    "Profiles",
    "Packages",
    "Unknown",
    "Ambiguous",
    "Evidence",
  ]) assert.match(execution.stdout, new RegExp(section));
  assert.match(execution.stdout, /\[orm\] prisma/);
  assert.doesNotMatch(execution.stdout, /\[orm\] drizzle/);
});

test("invalid project paths are operational errors without a stack trace", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-cli-invalid-path-"));
  const missing = join(root, "missing");
  const execution = runCli("inspect", missing, "--json");

  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, "");
  assert.match(execution.stderr, /Project path cannot be accessed/);
  assert.doesNotMatch(execution.stderr, /\n\s+at /);

  const file = join(root, "project.txt");
  writeFileSync(file, "not a directory\n");
  const fileExecution = runCli("inspect", file);
  assert.equal(fileExecution.status, 1);
  assert.match(fileExecution.stderr, /is not a directory/);
});

test("a project manifest that cannot be read as valid JSON becomes a clear operational error", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-cli-invalid-manifest-"));
  writeFileSync(join(root, "package.json"), "{ invalid json\n");
  const execution = runCli("inspect", root, "--json");

  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, "");
  assert.match(execution.stderr, /Inspection failed/);
  assert.match(execution.stderr, /Could not read valid JSON.*package\.json/);
  assert.doesNotMatch(execution.stderr, /\n\s+at /);
});

test("invalid arguments use the usage exit code and stderr", () => {
  const execution = runCli("inspect", singleRepo, "--unknown");
  const unavailableCommand = runCli("init");

  assert.equal(execution.status, 2);
  assert.equal(execution.stdout, "");
  assert.match(execution.stderr, /Unknown option/);
  assert.match(execution.stderr, /--help/);
  assert.equal(unavailableCommand.status, 2);
  assert.match(unavailableCommand.stderr, /Unknown command: init/);
});

test("inspect is read-only for the target project", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-cli-read-only-"));
  const marker = join(root, "script-was-executed.txt");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "read-only-proof",
    scripts: {
      test: `node -e "require('node:fs').writeFileSync('${marker}', 'executed')"`,
    },
  }));
  const before = snapshotDirectory(root);
  const execution = runCli("inspect", root, "--json");
  const after = snapshotDirectory(root);

  assert.equal(execution.status, 0);
  assert.equal(after, before);
  assert.equal(existsSync(marker), false);
});

test("help and version are available without inspecting a project", () => {
  const generalHelp = runCli("--help");
  const inspectHelp = runCli("inspect", "--help");
  const version = runCli("--version");

  assert.equal(generalHelp.status, 0);
  assert.match(generalHelp.stdout, /azevedo inspect \[path\] \[--json\]/);
  assert.equal(inspectHelp.status, 0);
  assert.match(inspectHelp.stdout, /Project directory/);
  assert.equal(version.status, 0);
  assert.equal(version.stdout, "0.2.0\n");

  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    bin: { azevedo: string };
  };
  assert.equal(packageJson.bin.azevedo, "./dist/src/cli.js");
  assert.match(readFileSync(cliPath, "utf8"), /^#!\/usr\/bin\/env node/);
});
