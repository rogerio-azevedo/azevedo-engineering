import { lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export type InitializedProject = {
  schemaVersion: 1;
  projectRoot: ".";
  adapter: "codex";
};

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertRegularFile(path: string, label: string): void {
  const stats = lstatOrNull(path);
  if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} is missing or is not a safe regular file.`);
  }
}

function parseConfig(contents: string): InitializedProject | null {
  const meaningfulLines = contents
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trimEnd())
    .filter((line) => line.trim() !== "");
  const expected = [
    /^schemaVersion:\s*1$/,
    /^project:$/,
    /^\s+root:\s*["']?\.["']?$/,
    /^engineering:$/,
    /^\s+adapter:\s*["']?codex["']?$/,
  ];
  if (meaningfulLines.length !== expected.length) return null;
  if (!meaningfulLines.every((line, index) => expected[index]?.test(line))) return null;
  return { schemaVersion: 1, projectRoot: ".", adapter: "codex" };
}

export function validateInitializedProject(projectRoot: string): InitializedProject {
  const root = realpathSync(projectRoot);
  const configPath = join(root, "azevedo.config.yaml");
  const agentsPath = join(root, "AGENTS.md");
  const statePath = join(root, ".azevedo");

  assertRegularFile(configPath, "azevedo.config.yaml");
  assertRegularFile(agentsPath, "AGENTS.md");
  const stateStats = lstatOrNull(statePath);
  if (!stateStats || stateStats.isSymbolicLink() || !stateStats.isDirectory()) {
    throw new Error(".azevedo is missing or is not a safe directory.");
  }

  const relativeState = relative(root, realpathSync(statePath));
  if (relativeState === ".." || relativeState.startsWith(`..${sep}`) || resolve(root, relativeState) !== realpathSync(statePath)) {
    throw new Error(".azevedo escapes the project root.");
  }

  const config = parseConfig(readFileSync(configPath, "utf8"));
  if (!config) throw new Error("azevedo.config.yaml is invalid or unsupported by plan v0.4.");
  return config;
}
