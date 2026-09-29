import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertNoPersistedSecrets } from "../execution/execution-contracts.js";
import { sha256Digest } from "../filesystem/canonical-digest.js";
import { applyImmutableArtifactOperation, buildImmutableArtifactOperation } from "../filesystem/immutable-artifact.js";
import {
  ProjectBindingSchema,
  ProjectDefinitionSchema,
  ProjectRegistryPointerSchema,
  ProjectSnapshotSchema,
  type ProjectBinding,
  type ProjectDefinition,
  type ProjectRegistryPointer,
  type ProjectSnapshot,
} from "./contracts.js";
import { definitionDigest, ProjectOnboardingError, snapshotIdentity } from "./identity.js";

export type LoadedProject = {
  definition: ProjectDefinition;
  binding: ProjectBinding | null;
  pointer: ProjectRegistryPointer;
  snapshot: ProjectSnapshot;
};

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProjectOnboardingError(`Project registry artifact is unreadable: ${path}. ${reason}`);
  }
}

function assertContained(root: string, path: string): void {
  const value = relative(root, path);
  if (value.startsWith("..") || value === ".." || resolve(root, value) !== path) {
    throw new ProjectOnboardingError(`Registry path escapes the workspace: ${path}`);
  }
}

export function projectDirectory(workspace: string, projectId: string): string {
  return join(realpathSync(workspace), "var", "projects", projectId);
}

export function bindingFile(workspace: string, projectId: string): string {
  return join(realpathSync(workspace), "var", "local", "bindings", `${projectId}.json`);
}

export function listProjectIds(workspace: string): string[] {
  const directory = join(realpathSync(workspace), "var", "projects");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

export function loadProject(workspace: string, projectId: string): LoadedProject {
  const directory = projectDirectory(workspace, projectId);
  const definitionPath = join(directory, "project.json");
  const pointerPath = join(directory, "current.json");
  if (!existsSync(definitionPath) || !existsSync(pointerPath)) {
    throw new ProjectOnboardingError(`Unknown project: ${projectId}`);
  }
  let definition: ProjectDefinition;
  let pointer: ProjectRegistryPointer;
  try {
    definition = ProjectDefinitionSchema.parse(readJson(definitionPath));
    pointer = ProjectRegistryPointerSchema.parse(readJson(pointerPath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProjectOnboardingError(`Incompatible or corrupt project registry artifact for ${projectId}: ${reason}`);
  }
  if (definition.projectId !== projectId || pointer.projectId !== projectId || pointer.snapshotId.length === 0) {
    throw new ProjectOnboardingError(`Project registry identity does not match ${projectId}.`);
  }
  const snapshotPath = join(directory, "snapshots", `${pointer.snapshotId}.json`);
  if (!existsSync(snapshotPath)) throw new ProjectOnboardingError(`Current snapshot is missing: ${pointer.snapshotId}`);
  let snapshot: ProjectSnapshot;
  try {
    snapshot = ProjectSnapshotSchema.parse(readJson(snapshotPath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProjectOnboardingError(`Incompatible or corrupt snapshot ${pointer.snapshotId}: ${reason}`);
  }
  if (snapshot.id !== pointer.snapshotId || snapshot.projectId !== projectId) {
    throw new ProjectOnboardingError(`Snapshot ${pointer.snapshotId} does not match the registry pointer.`);
  }
  if (sha256Digest(snapshot) !== pointer.snapshotDigest) {
    throw new ProjectOnboardingError(`Snapshot digest does not match the registry pointer for ${pointer.snapshotId}.`);
  }
  if (definitionDigest(definition) !== snapshot.definitionDigest) {
    throw new ProjectOnboardingError(`Project definition digest does not match snapshot ${snapshot.id}.`);
  }
  assertSnapshotChain(directory, projectId, definition, snapshot);
  const bindingPath = bindingFile(workspace, projectId);
  const binding = existsSync(bindingPath) ? readBindingFile(bindingPath, `${projectId}.json`) : null;
  return { definition, binding, pointer, snapshot };
}

function readBindingFile(path: string, fileName: string): ProjectBinding {
  let parsed: unknown;
  try {
    parsed = readJson(path);
  } catch {
    throw new ProjectOnboardingError(`Project binding is corrupt: ${fileName}.`);
  }
  const result = ProjectBindingSchema.safeParse(parsed);
  if (!result.success) throw new ProjectOnboardingError(`Project binding is corrupt: ${fileName}.`);
  const binding = result.data;
  if (binding.projectId !== fileName.slice(0, -".json".length)) {
    throw new ProjectOnboardingError(`Project binding identity does not match ${fileName}.`);
  }
  if (!isAbsolute(binding.root)) throw new ProjectOnboardingError(`Project binding path is invalid: ${fileName}.`);
  return binding;
}

function readSnapshotFile(directory: string, snapshotId: string): ProjectSnapshot {
  const snapshotPath = join(directory, "snapshots", `${snapshotId}.json`);
  if (!existsSync(snapshotPath)) throw new ProjectOnboardingError(`Historical snapshot is missing: ${snapshotId}`);
  try {
    return ProjectSnapshotSchema.parse(readJson(snapshotPath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProjectOnboardingError(`Incompatible or corrupt snapshot ${snapshotId}: ${reason}`);
  }
}

function assertSnapshotCoherence(snapshot: ProjectSnapshot, projectId: string, definition: ProjectDefinition): void {
  if (snapshot.projectId !== projectId) {
    throw new ProjectOnboardingError(`Snapshot ${snapshot.id} belongs to a different project.`);
  }
  if (snapshot.definitionDigest !== definitionDigest(definition)) {
    throw new ProjectOnboardingError(`Snapshot ${snapshot.id} definition digest does not match the project definition.`);
  }
  const { id: _id, ...body } = snapshot;
  if (snapshotIdentity(body) !== snapshot.id) {
    throw new ProjectOnboardingError(`Snapshot ${snapshot.id} is not coherent with its content.`);
  }
}

function assertSnapshotChain(directory: string, projectId: string, definition: ProjectDefinition, current: ProjectSnapshot): void {
  const seen = new Set<string>();
  const chain: ProjectSnapshot[] = [];
  let snapshot = current;
  for (;;) {
    if (seen.has(snapshot.id)) throw new ProjectOnboardingError(`Snapshot chain contains a cycle at ${snapshot.id}.`);
    seen.add(snapshot.id);
    chain.push(snapshot);
    if (!snapshot.previousSnapshotId) break;
    const previous = readSnapshotFile(directory, snapshot.previousSnapshotId);
    if (previous.id !== snapshot.previousSnapshotId) {
      throw new ProjectOnboardingError(`Snapshot ${snapshot.previousSnapshotId} id does not match its file.`);
    }
    snapshot = previous;
  }
  for (const item of chain) assertSnapshotCoherence(item, projectId, definition);
}

export function findProjectByBindingRoot(workspace: string, targetRoot: string): string | null {
  const directory = join(realpathSync(workspace), "var", "local", "bindings");
  if (!existsSync(directory)) return null;
  const expected = realpathSync(targetRoot);
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".json")) continue;
    const binding = readBindingFile(join(directory, name), name);
    if (!existsSync(binding.root)) continue;
    let bound: string;
    try {
      bound = realpathSync(binding.root);
    } catch {
      throw new ProjectOnboardingError(`Project binding path is invalid: ${name}.`);
    }
    if (bound === expected) return binding.projectId;
  }
  return null;
}

export function writeRegistryPointer(
  workspace: string,
  pointer: ProjectRegistryPointer,
  expectedSnapshotId: string | null,
): void {
  const root = realpathSync(workspace);
  const directory = projectDirectory(root, pointer.projectId);
  const destination = join(directory, "current.json");
  assertContained(root, destination);
  const current = existsSync(destination) ? ProjectRegistryPointerSchema.parse(readJson(destination)) : null;
  if ((current?.snapshotId ?? null) !== expectedSnapshotId) {
    throw new ProjectOnboardingError(
      `Registry current pointer changed concurrently. Expected ${expectedSnapshotId ?? "no pointer"}, found ${current?.snapshotId ?? "no pointer"}.`,
    );
  }
  assertNoPersistedSecrets(pointer);
  const temp = join(directory, `.current.${process.pid}.tmp`);
  writeFileSync(temp, serialize(pointer), { flag: "wx" });
  const reread = existsSync(destination) ? ProjectRegistryPointerSchema.parse(readJson(destination)) : null;
  if ((reread?.snapshotId ?? null) !== expectedSnapshotId) {
    unlinkSync(temp);
    throw new ProjectOnboardingError("Registry current pointer changed concurrently.");
  }
  renameSync(temp, destination);
  const verified = ProjectRegistryPointerSchema.parse(readJson(destination));
  if (verified.snapshotId !== pointer.snapshotId || verified.snapshotDigest !== pointer.snapshotDigest) {
    throw new ProjectOnboardingError("Registry current pointer did not persist the expected snapshot.");
  }
}

export function writeImmutableJson(workspace: string, relativePath: string, value: unknown): "create" | "unchanged" | "conflict" {
  const root = realpathSync(workspace);
  assertNoPersistedSecrets(value);
  const operation = buildImmutableArtifactOperation(root, relativePath, serialize(value));
  if (operation.action === "conflict") return "conflict";
  if (operation.action === "create") applyImmutableArtifactOperation(root, operation);
  return operation.action;
}

export function ensureRegistryParent(workspace: string, projectId: string): void {
  const directory = projectDirectory(workspace, projectId);
  const root = realpathSync(workspace);
  let current = root;
  for (const segment of relative(root, directory).split(sep)) {
    if (!segment || segment === ".") continue;
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new ProjectOnboardingError(`Unsafe registry directory: ${current}`);
    }
  }
}
