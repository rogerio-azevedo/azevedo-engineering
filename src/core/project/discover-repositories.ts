import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { inspectProject } from "../discovery/inspect-project.js";
import type { ProjectInspection } from "../schemas/discovery.js";
import { readGitRepository, type GitRead } from "./git-reader.js";
import { suggestRepositoryId } from "./identity.js";
import { isSensitivePath } from "./sensitive-paths.js";

const IGNORED_CHILDREN = new Set([".cache", ".git", ".next", "build", "coverage", "dist", "node_modules", "vendor"]);
const ROOT_MANIFESTS = ["package.json", "go.mod", "pyproject.toml", "Cargo.toml", "pom.xml", "Dockerfile", "compose.yaml", "docker-compose.yml"];

export type DiscoveredRepository = {
  repositoryId: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  git: GitRead;
  inspection: ProjectInspection | null;
};

export type RepositoryDiscovery = {
  layout: "single-repository" | "project-group";
  repositories: DiscoveredRepository[];
  containerSensitivePaths: string[];
  nestedRepositoryPaths: string[];
};

function hasManifest(directory: string): boolean {
  if (ROOT_MANIFESTS.some((name) => existsSync(join(directory, name)))) return true;
  try {
    return readdirSync(directory).some((name) => name.endsWith(".csproj"));
  } catch {
    return false;
  }
}

function safeInspection(directory: string): ProjectInspection | null {
  if (!existsSync(join(directory, "package.json"))) return null;
  try {
    return inspectProject(directory);
  } catch {
    return null;
  }
}

function childDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !IGNORED_CHILDREN.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function discoverRepositories(target: string): RepositoryDiscovery {
  const rootGit = readGitRepository(target);
  const rootSensitive = readdirSync(target)
    .filter((name) => {
      try {
        return lstatSync(join(target, name)).isFile() && isSensitivePath(name);
      } catch {
        return false;
      }
    })
    .sort();

  if (rootGit.isRepository || hasManifest(target)) {
    const nested = childDirectories(target).filter((name) => readGitRepository(join(target, name)).isRepository);
    return {
      layout: "single-repository",
      repositories: [{
        repositoryId: suggestRepositoryId(target, true),
        name: basename(target),
        relativePath: ".",
        absolutePath: target,
        git: rootGit,
        inspection: safeInspection(target),
      }],
      containerSensitivePaths: rootGit.isRepository ? [] : rootSensitive,
      nestedRepositoryPaths: nested,
    };
  }

  const children = childDirectories(target).flatMap((name) => {
    const absolutePath = join(target, name);
    const git = readGitRepository(absolutePath);
    const inspection = safeInspection(absolutePath);
    const recognizable = git.isRepository || inspection?.topology.state === "detected" || hasManifest(absolutePath);
    return recognizable ? [{ name, absolutePath, git, inspection }] : [];
  });
  const commonDirs = new Map<string, number>();
  for (const child of children) {
    if (child.git.commonDir) commonDirs.set(child.git.commonDir, (commonDirs.get(child.git.commonDir) ?? 0) + 1);
  }
  const repositories = children.filter((child) => {
    if (!child.git.linkedWorktree || !child.git.commonDir) return true;
    return (commonDirs.get(child.git.commonDir) ?? 0) < 2;
  });
  const layout = repositories.length > 0 ? "project-group" as const : "single-repository" as const;
  return {
    layout,
    repositories: repositories.map((child) => ({
      repositoryId: suggestRepositoryId(child.name, false),
      name: child.name,
      relativePath: child.name,
      absolutePath: child.absolutePath,
      git: child.git,
      inspection: child.inspection,
    })),
    containerSensitivePaths: rootSensitive,
    nestedRepositoryPaths: [],
  };
}
