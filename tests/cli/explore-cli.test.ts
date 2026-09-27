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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const cliPath = resolve("dist/src/cli.js");

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: resolve("."), encoding: "utf8" });
}

function write(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function snapshot(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      hash.update(`${relative(root, path)}:${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}\0`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
}

function project() {
  const root = mkdtempSync(join(tmpdir(), "azevedo-explore-cli-"));
  write(root, "package.json", `${JSON.stringify({
    name: "explore-cli",
    packageManager: "pnpm@11.24.0",
    scripts: { test: "node --test", typecheck: "tsc --noEmit" },
    dependencies: { "@nestjs/common": "11.0.0", prisma: "6.0.0" },
    devDependencies: { typescript: "5.9.3" },
  })}\n`);
  write(root, "tsconfig.json", "{}\n");
  write(root, "src/realization/realizations.controller.ts", `
import { archiveRealization } from "../application/archive-realization.js";
export class RealizationsController { archive(id: string) { return archiveRealization(id); } }
`);
  write(root, "src/application/archive-realization.ts", `
import { repository } from "../database/realizations-repository.js";
export const archiveRealization = (id: string) => repository.archive(id);
`);
  write(root, "src/database/realizations-repository.ts", `
export const repository = { archive: (id: string) => ({ id, status: "archived" }) };
`);
  const specPath = join(root, "feature-spec.json");
  writeFileSync(specPath, `${JSON.stringify({
    title: "Arquivar uma realização",
    objective: "Adicionar endpoint para arquivar uma realização",
    expectedBehaviors: ["A realização fica archived."],
    acceptanceCriteria: [{
      id: "ac-archive-realization",
      source: { kind: "user", reference: null },
      statement: "Arquivar uma realização ativa.",
      scenario: { given: "uma realização ativa", when: "o endpoint é chamado", then: "ela fica archived" },
      prohibitedEffects: [],
      verificationMethod: "Teste do endpoint.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  }, null, 2)}\n`);
  return { root, specPath };
}

test("explore CLI dry-run is read-only and reports the exact artifact set", () => {
  const { root, specPath } = project();
  assert.equal(runCli("init", root).status, 0);
  const planned = runCli("plan", root, "--task", "Adicionar endpoint para arquivar uma realização", "--json");
  assert.equal(planned.status, 0, planned.stderr);
  const planId = (JSON.parse(planned.stdout) as { plan: { id: string } }).plan.id;
  const before = snapshot(root);
  const execution = runCli("explore", root, "--plan", planId, "--spec", specPath, "--dry-run", "--json");
  const after = snapshot(root);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(after, before);
  const report = JSON.parse(execution.stdout) as {
    outcome: string;
    dryRun: boolean;
    exploration: { status: string; sourceRevision: unknown };
    revision: { id: string } | null;
    operations: Array<{ action: string; artifact: string }>;
  };
  assert.equal(report.outcome, "dry-run");
  assert.equal(report.dryRun, true);
  assert.equal(report.exploration.status, "ready");
  assert.ok(report.revision);
  assert.equal(report.operations.length, 3);
  assert.ok(report.operations.every((operation) => operation.action === "create"));
  assert.ok(report.operations.some((operation) => operation.artifact.startsWith(".azevedo/specifications/")));
  assert.ok(report.operations.some((operation) => operation.artifact.startsWith(".azevedo/explorations/")));
  assert.ok(report.operations.some((operation) => operation.artifact.includes("/revisions/")));
});

test("explore CLI persists immutable context without changing target source and conflicts fail before writes", () => {
  const { root, specPath } = project();
  assert.equal(runCli("init", root).status, 0);
  const planned = runCli("plan", root, "--task", "Adicionar endpoint para arquivar uma realização", "--json");
  const planId = (JSON.parse(planned.stdout) as { plan: { id: string } }).plan.id;
  const sourceBefore = readFileSync(join(root, "src/application/archive-realization.ts"));
  const execution = runCli("explore", root, "--plan", planId, "--spec", specPath, "--json");
  assert.equal(execution.status, 0, execution.stderr);
  const report = JSON.parse(execution.stdout) as {
    outcome: string;
    operations: Array<{ artifact: string }>;
  };
  assert.equal(report.outcome, "created");
  assert.ok(report.operations.every((operation) => existsSync(join(root, operation.artifact))));
  assert.deepEqual(readFileSync(join(root, "src/application/archive-realization.ts")), sourceBefore);

  const specArtifact = report.operations.find((operation) => operation.artifact.includes("/specifications/"))?.artifact;
  assert.ok(specArtifact);
  if (!specArtifact) return;
  assert.equal(lstatSync(join(root, specArtifact)).isFile(), true);
  writeFileSync(join(root, specArtifact), "owner content\n");
  const beforeConflict = snapshot(root);
  const conflict = runCli("explore", root, "--plan", planId, "--spec", specPath, "--json");
  assert.equal(conflict.status, 1);
  assert.match(conflict.stdout, /"outcome": "conflict"/);
  assert.equal(snapshot(root), beforeConflict);
  assert.equal(readFileSync(join(root, specArtifact), "utf8"), "owner content\n");
});
