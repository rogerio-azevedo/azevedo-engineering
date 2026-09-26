import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { inspectProject } from "../../src/index.js";

const monorepo = resolve("tests/fixtures/monorepo");
const singleRepo = resolve("tests/fixtures/single-repo");

test("inspection detects the reference monorepo from deterministic evidence", () => {
  const result = inspectProject(monorepo);
  const technologies = new Set(result.technologies.map((technology) => technology.id));

  assert.equal(result.topology.value, "monorepo");
  assert.equal(result.packageManager.value, "pnpm");
  for (const technology of ["typescript", "nestjs", "nextjs", "drizzle", "postgresql", "mongodb", "mongoose", "zod"]) {
    assert.ok(technologies.has(technology), `expected ${technology}`);
  }
  assert.ok(result.matchedProfiles.includes("profile.postgres-drizzle"));
  assert.ok(result.matchedProfiles.includes("profile.mongodb-mongoose"));
  assert.ok(result.capabilities.every((capability) => capability.state === "detected"));
});

test("existing single-repo architecture wins over Azevedo reference defaults", () => {
  const result = inspectProject(singleRepo);
  const technologies = new Set(result.technologies.map((technology) => technology.id));

  assert.equal(result.topology.value, "single-repo");
  assert.equal(result.packageManager.value, "npm");
  assert.ok(technologies.has("prisma"));
  assert.ok(!technologies.has("drizzle"));
  assert.ok(!result.matchedProfiles.includes("profile.postgres-drizzle"));
});

test("single-repo inspection ignores nested fixture packages outside declared workspaces", () => {
  const result = inspectProject(resolve("."));
  const technologies = new Set(result.technologies.map((technology) => technology.id));

  assert.equal(result.topology.value, "single-repo");
  assert.deepEqual(result.packages, ["."]);
  assert.ok(!technologies.has("nestjs"));
  assert.ok(!technologies.has("nextjs"));
  assert.ok(!technologies.has("prisma"));
  assert.ok(!technologies.has("drizzle"));
});

test("conflicting package manager evidence is reported as ambiguous", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-inspect-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "conflict", packageManager: "npm@11" }));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const result = inspectProject(root);
  assert.equal(result.packageManager.state, "ambiguous");
  assert.deepEqual(result.packageManager.candidates, ["npm", "pnpm"]);
  assert.ok(result.ambiguities.includes("package-manager"));
  assert.equal(result.conflicts.length, 1);
});

test("missing deterministic evidence remains unknown", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-unknown-"));
  const result = inspectProject(root);

  assert.equal(result.packageManager.state, "unknown");
  assert.equal(result.topology.state, "unknown");
  assert.ok(result.unknowns.includes("package-manager"));
  assert.ok(result.unknowns.includes("repository-topology"));
});

test("turbo.json alone does not turn a package into a monorepo", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-turbo-single-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "turbo-single" }));
  writeFileSync(join(root, "turbo.json"), JSON.stringify({ tasks: {} }));

  const result = inspectProject(root);
  assert.equal(result.topology.state, "detected");
  assert.equal(result.topology.value, "single-repo");
  assert.deepEqual(result.topology.evidence, ["package.json"]);
});
