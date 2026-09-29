import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { commitAll, initRepo, tempDir, write } from "../project/fixtures.js";

const cliPath = resolve("dist/src/cli.js");

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("project CLI onboards, lists, and inspects without writing the target", () => {
  const target = tempDir("cli-target-");
  const workspace = tempDir("cli-workspace-");
  initRepo(target);
  write(target, "README.md", "cli\n");
  commitAll(target, "init");
  const onboard = runCli("project", "onboard", target, "--workspace", workspace, "--project-id", "cli-demo", "--json");
  assert.equal(onboard.status, 0, onboard.stderr);
  const report = JSON.parse(onboard.stdout) as { outcome: string; projectId: string; registryRoot: string };
  assert.equal(report.outcome, "created");
  assert.equal(report.projectId, "cli-demo");
  assert.equal(existsSync(resolve(target, ".azevedo")), false);
  const listed = runCli("project", "list", "--workspace", workspace, "--json");
  assert.equal(listed.status, 0);
  assert.equal(JSON.parse(listed.stdout).projects[0].projectId, "cli-demo");
  const inspected = runCli("project", "inspect", "cli-demo", "--workspace", workspace, "--json");
  assert.equal(inspected.status, 0, inspected.stderr);
  const context = JSON.parse(inspected.stdout) as { boundaries: { authorizesMutation: boolean }; digest: string };
  assert.equal(context.boundaries.authorizesMutation, false);
  assert.match(context.digest, /^sha256:/);
  const dryRun = runCli("project", "onboard", target, "--workspace", workspace, "--dry-run");
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /unchanged|created/);
  const invalid = runCli("project", "watch");
  assert.equal(invalid.status, 2);
  const help = runCli("project", "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /project onboard/);
});
