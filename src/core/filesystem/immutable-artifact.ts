import { lstatSync, mkdirSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { createExclusiveVerifiedFile } from "./safe-create.js";

const PortableArtifactPathSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  const segments = value.replaceAll("\\", "/").split("/");
  return !segments.includes("..") && !segments.includes("");
}, "Artifact paths must be project-relative and contained.");

export const ImmutableArtifactOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), artifact: PortableArtifactPathSchema, content: z.string().min(1) }).strict(),
  z.object({ action: z.literal("unchanged"), artifact: PortableArtifactPathSchema }).strict(),
  z.object({
    action: z.literal("conflict"),
    artifact: PortableArtifactPathSchema,
    reason: z.string().min(1),
  }).strict(),
]);

export type ImmutableArtifactOperation = z.infer<typeof ImmutableArtifactOperationSchema>;

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith(`..${sep}`) && resolve(root, value) === candidate;
}

function inspectDirectoryChain(root: string, destination: string): string | null {
  let current = dirname(destination);
  const chain: string[] = [];
  while (current !== root) {
    if (!isWithin(root, current)) return "Artifact parent escapes the project root.";
    chain.push(current);
    current = dirname(current);
  }
  for (const directory of chain.reverse()) {
    const stats = lstatOrNull(directory);
    if (!stats) continue;
    const display = relative(root, directory).split(sep).join("/");
    if (stats.isSymbolicLink() || !stats.isDirectory()) return `${display} exists with an unsafe filesystem type.`;
    if (!isWithin(root, realpathSync(directory))) return `${display} escapes the project root.`;
  }
  return null;
}

export function buildImmutableArtifactOperation(
  projectRoot: string,
  rawArtifact: string,
  content: string,
): ImmutableArtifactOperation {
  const artifact = PortableArtifactPathSchema.parse(rawArtifact.replaceAll("\\", "/"));
  if (!content) throw new Error("Immutable artifact content must not be empty.");
  const root = realpathSync(projectRoot);
  const destination = resolve(root, artifact);
  if (!isWithin(root, destination)) throw new Error(`Artifact escapes the project root: ${artifact}`);
  const unsafeDirectory = inspectDirectoryChain(root, destination);
  if (unsafeDirectory) return ImmutableArtifactOperationSchema.parse({
    action: "conflict",
    artifact,
    reason: unsafeDirectory,
  });

  const stats = lstatOrNull(destination);
  if (!stats) return ImmutableArtifactOperationSchema.parse({ action: "create", artifact, content });
  if (stats.isSymbolicLink() || !stats.isFile()) return ImmutableArtifactOperationSchema.parse({
    action: "conflict",
    artifact,
    reason: "The immutable artifact exists with an unsafe filesystem type.",
  });
  return readFileSync(destination).equals(Buffer.from(content, "utf8"))
    ? ImmutableArtifactOperationSchema.parse({ action: "unchanged", artifact })
    : ImmutableArtifactOperationSchema.parse({
      action: "conflict",
      artifact,
      reason: "Different content already exists for this deterministic artifact id.",
    });
}

function ensureDirectoryChain(root: string, destination: string): void {
  let current = root;
  const relativeParent = relative(root, dirname(destination));
  for (const segment of relativeParent.split(sep)) {
    if (!segment || segment === ".") continue;
    current = join(current, segment);
    const stats = lstatOrNull(current);
    if (!stats) mkdirSync(current);
    const resulting = lstatSync(current);
    if (resulting.isSymbolicLink() || !resulting.isDirectory() || !isWithin(root, realpathSync(current))) {
      throw new Error(`Unsafe immutable artifact directory: ${relative(root, current)}`);
    }
  }
}

export function applyImmutableArtifactOperation(
  projectRoot: string,
  rawOperation: ImmutableArtifactOperation,
): void {
  const operation = ImmutableArtifactOperationSchema.parse(rawOperation);
  if (operation.action === "conflict") throw new Error("A conflicting immutable artifact cannot be applied.");
  if (operation.action === "unchanged") return;
  const root = realpathSync(projectRoot);
  const destination = resolve(root, operation.artifact);
  if (!isWithin(root, destination)) throw new Error(`Artifact escapes the project root: ${operation.artifact}`);
  ensureDirectoryChain(root, destination);
  createExclusiveVerifiedFile(root, destination, operation.content);
}
