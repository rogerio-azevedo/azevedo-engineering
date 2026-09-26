import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Capability, ProjectInspection } from "../schemas/discovery.js";
import { ProjectInspectionSchema } from "../schemas/discovery.js";
import { matchStackProfiles } from "../profiles/stack-profiles.js";

type JsonObject = Record<string, unknown>;

type PackageRecord = {
  path: string;
  directory: string;
  data: JsonObject;
};

const IGNORED_DIRECTORIES = new Set([".git", ".azevedo", "node_modules", "dist", "coverage", ".next"]);

const TECHNOLOGY_DEPENDENCIES = [
  { id: "nestjs", category: "framework", dependencies: ["@nestjs/core"] },
  { id: "nextjs", category: "framework", dependencies: ["next"] },
  { id: "zod", category: "validation", dependencies: ["zod"] },
  { id: "tailwind", category: "styling", dependencies: ["tailwindcss"] },
  { id: "zustand", category: "state", dependencies: ["zustand"] },
  { id: "postgresql", category: "database", dependencies: ["pg", "postgres", "@neondatabase/serverless"] },
  { id: "drizzle", category: "orm", dependencies: ["drizzle-orm"] },
  { id: "mongodb", category: "database", dependencies: ["mongodb", "mongoose"] },
  { id: "mongoose", category: "orm", dependencies: ["mongoose"] },
  { id: "prisma", category: "orm", dependencies: ["prisma", "@prisma/client"] },
  { id: "react-native", category: "framework", dependencies: ["react-native"] },
  { id: "expo", category: "framework", dependencies: ["expo"] },
  { id: "vitest", category: "testing", dependencies: ["vitest"] },
  { id: "jest", category: "testing", dependencies: ["jest"] },
  { id: "playwright", category: "testing", dependencies: ["@playwright/test", "playwright"] },
  { id: "turbo", category: "build", dependencies: ["turbo"] },
] as const;

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function displayPath(root: string, path: string): string {
  const value = toPortablePath(relative(root, path));
  return value === "" ? "." : value;
}

function readJsonObject(path: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read valid JSON from ${path}: ${reason}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${path}.`);
  }
  return parsed as JsonObject;
}

function findPackageFiles(root: string, directory = root, depth = 0): string[] {
  if (depth > 6) return [];
  const results: string[] = [];
  const packagePath = join(directory, "package.json");
  if (existsSync(packagePath)) results.push(packagePath);

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read directory ${displayPath(root, directory)}: ${reason}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
    results.push(...findPackageFiles(root, join(directory, entry.name), depth + 1));
  }
  return results.sort();
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function detectPackageManager(root: string, rootPackage: JsonObject | null): ProjectInspection["packageManager"] {
  const lockfiles = [
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ] as const;
  const candidates = new Set<"npm" | "pnpm" | "yarn" | "bun">();
  const evidence: string[] = [];

  for (const [file, manager] of lockfiles) {
    if (!existsSync(join(root, file))) continue;
    candidates.add(manager);
    evidence.push(file);
  }

  const declared = rootPackage?.packageManager;
  if (typeof declared === "string") {
    const manager = declared.split("@")[0];
    if (manager === "npm" || manager === "pnpm" || manager === "yarn" || manager === "bun") {
      candidates.add(manager);
      evidence.push(`package.json#packageManager=${declared}`);
    }
  }

  const values = [...candidates].sort();
  if (values.length === 0) return { state: "unknown", value: null, candidates: [], evidence: [] };
  if (values.length > 1) return { state: "ambiguous", value: null, candidates: values, evidence };
  return { state: "detected", value: values[0] ?? null, candidates: values, evidence };
}

function detectTopology(root: string, rootPackage: JsonObject | null): ProjectInspection["topology"] {
  const evidence: string[] = [];
  if (existsSync(join(root, "pnpm-workspace.yaml"))) evidence.push("pnpm-workspace.yaml");
  if (rootPackage && "workspaces" in rootPackage) evidence.push("package.json#workspaces");

  if (evidence.length > 0) return { state: "detected", value: "monorepo", evidence };
  if (rootPackage) return { state: "detected", value: "single-repo", evidence: ["package.json"] };
  return { state: "unknown", value: null, evidence: [] };
}

function workspacePatterns(root: string, rootPackage: JsonObject | null): string[] {
  const patterns = new Set<string>();
  const workspaces = rootPackage?.workspaces;
  const declared = Array.isArray(workspaces)
    ? workspaces
    : workspaces !== null && typeof workspaces === "object" && !Array.isArray(workspaces)
      ? (workspaces as JsonObject).packages
      : [];
  if (Array.isArray(declared)) {
    for (const value of declared) if (typeof value === "string" && !value.startsWith("!")) patterns.add(value);
  }

  const pnpmWorkspacePath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    const contents = readFileSync(pnpmWorkspacePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*$/);
      const value = match?.[1]?.trim();
      if (value && !value.startsWith("!")) patterns.add(value);
    }
  }
  return [...patterns];
}

function globMatchesPath(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped.replace(/\/$/, "")}$`).test(path);
}

function detectCapabilities(scripts: ProjectInspection["scripts"]): Capability[] {
  const matchers: Record<Capability["id"], (name: string) => boolean> = {
    lint: (name) => name === "lint" || name.startsWith("lint:"),
    typecheck: (name) => name === "typecheck" || name === "check:types" || name.includes("typecheck"),
    test: (name) => name === "test" || name.startsWith("test:"),
    build: (name) => name === "build" || name.startsWith("build:"),
  };

  return (Object.keys(matchers) as Capability["id"][]).map((id) => {
    const evidence = scripts
      .filter((script) => matchers[id](script.name))
      .map((script) => `${script.packagePath}/package.json#scripts.${script.name}`);
    return { id, state: evidence.length > 0 ? "detected" : "unknown", evidence };
  });
}

export function inspectProject(projectRoot: string): ProjectInspection {
  const root = resolve(projectRoot);
  const rootPackagePath = join(root, "package.json");
  const rootPackage = existsSync(rootPackagePath) ? readJsonObject(rootPackagePath) : null;
  const topology = detectTopology(root, rootPackage);
  const patterns = workspacePatterns(root, rootPackage);
  const packageFiles = topology.value === "monorepo"
    ? findPackageFiles(root).filter((path) => {
      if (path === rootPackagePath) return true;
      const packageDirectory = displayPath(root, dirname(path));
      return patterns.some((pattern) => globMatchesPath(pattern, packageDirectory));
    })
    : existsSync(rootPackagePath) ? [rootPackagePath] : [];
  const packages: PackageRecord[] = packageFiles.flatMap((path) => {
    const data = readJsonObject(path);
    return data ? [{ path, directory: dirname(path), data }] : [];
  });
  const packageManager = detectPackageManager(root, rootPackage);

  const scripts = packages.flatMap((record) =>
    Object.entries(stringRecord(record.data.scripts)).map(([name, command]) => ({
      packagePath: displayPath(root, record.directory),
      name,
      command,
    })),
  ).sort((left, right) => `${left.packagePath}:${left.name}`.localeCompare(`${right.packagePath}:${right.name}`));

  const technologyEvidence = new Map<string, { category: (typeof TECHNOLOGY_DEPENDENCIES)[number]["category"] | "language"; evidence: Set<string> }>();
  const addTechnology = (id: string, category: (typeof TECHNOLOGY_DEPENDENCIES)[number]["category"] | "language", evidence: string) => {
    const current = technologyEvidence.get(id) ?? { category, evidence: new Set<string>() };
    current.evidence.add(evidence);
    technologyEvidence.set(id, current);
  };

  for (const record of packages) {
    const dependencies = {
      ...stringRecord(record.data.dependencies),
      ...stringRecord(record.data.devDependencies),
      ...stringRecord(record.data.peerDependencies),
    };
    const packageDisplay = displayPath(root, record.path);
    for (const definition of TECHNOLOGY_DEPENDENCIES) {
      for (const dependency of definition.dependencies) {
        if (dependency in dependencies) {
          addTechnology(definition.id, definition.category, `${packageDisplay}#dependency=${dependency}`);
        }
      }
    }
    if ("typescript" in dependencies || existsSync(join(record.directory, "tsconfig.json"))) {
      addTechnology("typescript", "language", existsSync(join(record.directory, "tsconfig.json"))
        ? `${displayPath(root, join(record.directory, "tsconfig.json"))}`
        : `${packageDisplay}#dependency=typescript`);
    }
  }

  const technologies = [...technologyEvidence.entries()]
    .map(([id, value]) => ({ id, category: value.category, state: "detected" as const, evidence: [...value.evidence].sort() }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const technologyIds = new Set(technologies.map((technology) => technology.id));
  const capabilities = detectCapabilities(scripts);
  const unknowns: string[] = [];
  const conflicts: string[] = [];
  const ambiguities: string[] = [];

  if (packageManager.state === "unknown") unknowns.push("package-manager");
  if (topology.state === "unknown") unknowns.push("repository-topology");
  for (const capability of capabilities) {
    if (capability.state === "unknown") unknowns.push(`${capability.id}-command`);
  }
  if (packageManager.state === "ambiguous") {
    const message = `Conflicting package manager evidence: ${packageManager.candidates.join(", ")}`;
    conflicts.push(message);
    ambiguities.push("package-manager");
  }

  return ProjectInspectionSchema.parse({
    schemaVersion: 1,
    root,
    inspectedAt: new Date().toISOString(),
    packageManager,
    topology,
    packages: packages.map((record) => displayPath(root, record.directory)),
    technologies,
    scripts,
    capabilities,
    matchedProfiles: matchStackProfiles(technologyIds),
    unknowns,
    conflicts,
    ambiguities,
  });
}
