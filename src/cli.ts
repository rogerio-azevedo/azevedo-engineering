#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli/command.js";

function readOwnPackageVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
      const packageJson: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
      if (
        packageJson !== null &&
        typeof packageJson === "object" &&
        "version" in packageJson &&
        typeof packageJson.version === "string"
      ) return packageJson.version;
    }
    directory = dirname(directory);
  }
  throw new Error("Could not locate @azevedo/engineering package.json.");
}

process.exitCode = runCli(
  process.argv.slice(2),
  {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  { cwd: process.cwd(), version: readOwnPackageVersion() },
);
