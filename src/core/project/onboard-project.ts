import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalJson, sha256Digest } from "../filesystem/canonical-digest.js";
import type { ProjectFact, ProjectObservation, ProjectSnapshot, ProjectUnknown } from "./contracts.js";
import { detectorSet, PROJECT_FACT_DETECTORS } from "./detectors/registry.js";
import { MAX_FACTS_PER_REPOSITORY } from "./detectors/support.js";
import { discoverRepositories } from "./discover-repositories.js";
import {
  definitionDigest,
  factRecord,
  finishSnapshot,
  observationRecord,
  ProjectOnboardingError,
  semanticSnapshotBody,
  suggestProjectId,
  unknownRecord,
} from "./identity.js";
import { presenceDigest } from "./repository-view.js";
import { createRepositoryView } from "./repository-view.js";
import {
  ensureRegistryParent,
  findProjectByBindingRoot,
  loadProject,
  projectDirectory,
  writeImmutableJson,
  writeRegistryPointer,
} from "./registry.js";
import { captureTargetFingerprint } from "./target-state.js";
import { assertRegistryDisjoint, registryRoot } from "./workspace.js";

export type OnboardRequest = {
  workspace: string;
  target: string;
  name?: string | undefined;
  projectId?: string | undefined;
  dryRun?: boolean | undefined;
};

export type OnboardReport = {
  schemaVersion: 1;
  outcome: "created" | "updated" | "unchanged" | "blocked";
  projectId: string | null;
  snapshotId: string | null;
  registryRoot: string;
  reason: string | null;
  summary: {
    repositories: number;
    facts: number;
    unknowns: number;
    sensitivePaths: number;
  };
  operations: Array<{ action: string; artifact: string }>;
};

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function limitFacts(facts: ProjectFact[], unknowns: ProjectUnknown[]): { facts: ProjectFact[]; unknowns: ProjectUnknown[] } {
  const rank = { direct: 0, corroborated: 1, indirect: 2 };
  const kept: ProjectFact[] = [];
  const dropped: ProjectFact[] = [];
  const byRepository = new Map<string, ProjectFact[]>();
  for (const fact of facts) {
    const key = fact.repositoryId ?? "";
    byRepository.set(key, [...(byRepository.get(key) ?? []), fact]);
  }
  for (const group of byRepository.values()) {
    const ordered = [...group].sort((left, right) => rank[left.evidenceQuality] - rank[right.evidenceQuality] || left.id.localeCompare(right.id));
    kept.push(...ordered.slice(0, MAX_FACTS_PER_REPOSITORY));
    dropped.push(...ordered.slice(MAX_FACTS_PER_REPOSITORY));
  }
  const extra = dropped.map((fact) => unknownRecord({
    repositoryId: fact.repositoryId,
    topic: "fact-limit",
    reason: `Fact ${fact.key} was not kept because the repository fact budget was exhausted.`,
  }));
  return { facts: uniqueById(kept), unknowns: uniqueById([...unknowns, ...extra]) };
}

export function onboardProject(request: OnboardRequest): OnboardReport {
  if (!existsSync(request.workspace)) throw new ProjectOnboardingError(`Workspace does not exist: ${request.workspace}`);
  if (!existsSync(request.target)) throw new ProjectOnboardingError(`Onboarding target is not a directory: ${request.target}`);
  const workspace = realpathSync(request.workspace);
  const targetRoot = realpathSync(request.target);
  if (!lstatSync(targetRoot).isDirectory()) {
    throw new ProjectOnboardingError(`Onboarding target is not a directory: ${targetRoot}`);
  }
  assertRegistryDisjoint(workspace, targetRoot);
  const before = captureTargetFingerprint(targetRoot);
  const discovery = discoverRepositories(targetRoot);
  const observations: ProjectObservation[] = [];
  const facts: ProjectFact[] = [];
  const unknowns: ProjectUnknown[] = [];
  const budgets: ProjectSnapshot["budget"] = [];
  for (const repository of discovery.repositories) {
    const view = createRepositoryView(repository.absolutePath, repository.repositoryId, repository.git.commit);
    for (const detector of PROJECT_FACT_DETECTORS) {
      const found = detector.detect({ view, inspection: repository.inspection, git: repository.git });
      observations.push(...found.observations);
      facts.push(...found.facts);
      unknowns.push(...found.unknowns);
    }
    budgets.push({
      repositoryId: repository.repositoryId,
      filesRead: view.filesRead,
      listings: view.listings,
      stopReason: view.stopReason,
    });
  }
  for (const path of discovery.containerSensitivePaths) {
    observations.push(observationRecord({
      location: { repositoryId: null, path },
      basis: "presence",
      subject: "sensitive-file",
      basisDigest: presenceDigest(),
      sensitive: true,
      coverage: "complete",
      revision: null,
    }));
  }
  for (const nested of discovery.nestedRepositoryPaths) {
    unknowns.push(unknownRecord({
      repositoryId: discovery.repositories[0]?.repositoryId ?? null,
      topic: "nested-repository",
      reason: `Nested git repository ${nested} was not added as a separate repository.`,
    }));
  }
  if (discovery.repositories.length === 0) {
    unknowns.push(unknownRecord({
      repositoryId: null,
      topic: "repository",
      reason: "No git repository or recognizable project manifest was observed.",
    }));
  }
  const after = captureTargetFingerprint(targetRoot);
  if (before !== after) {
    throw new ProjectOnboardingError("Onboarding refused to continue because the target changed while it was being read.");
  }

  const limited = limitFacts(uniqueById(facts), uniqueById(unknowns));
  const containerFact = containerSensitiveFact(observations);
  const allFacts = uniqueById(containerFact ? [...limited.facts, containerFact] : limited.facts);
  const boundProjectId = findProjectByBindingRoot(workspace, targetRoot);
  const suggestedId = suggestProjectId({
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.name ? { name: request.name } : {}),
    targetPath: targetRoot,
  });
  if (boundProjectId && request.projectId && request.projectId !== boundProjectId) {
    return report("blocked", boundProjectId, null, workspace, "The checkout is already bound to a different project id.", discovery, allFacts, limited.unknowns, []);
  }
  // A renamed checkout is not rebound. Remote, commit and folder name are not identity.
  // Restoring or naming the existing project id is explicit; project bind is a later command.
  const projectId = boundProjectId ?? suggestedId;
  const existing = existsSync(join(projectDirectory(workspace, projectId), "project.json")) ? loadProject(workspace, projectId) : null;
  if (!boundProjectId && existing) {
    return report("blocked", projectId, existing.snapshot.id, workspace, "Project id already exists for a different checkout. Identity is not recalculated.", discovery, allFacts, limited.unknowns, []);
  }
  const definition = {
    schemaVersion: 1 as const,
    projectId,
    name: request.name ?? existing?.definition.name ?? basename(targetRoot),
    repositories: discovery.repositories
      .map((repository) => ({
        repositoryId: repository.repositoryId,
        name: repository.relativePath === "."
          ? (request.name ?? existing?.definition.repositories.find((item) => item.repositoryId === repository.repositoryId)?.name ?? "root")
          : repository.name,
      }))
      .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
  };
  if (existing && canonicalJson(existing.definition) !== canonicalJson(definition)) {
    return report("blocked", projectId, existing.snapshot.id, workspace, "Discovered repositories do not match the persisted project definition.", discovery, allFacts, limited.unknowns, []);
  }
  const binding = {
    schemaVersion: 1 as const,
    projectId,
    root: targetRoot,
    repositories: discovery.repositories
      .map((repository) => ({ repositoryId: repository.repositoryId, path: repository.relativePath }))
      .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
  };
  if (existing?.binding && canonicalJson({ ...existing.binding, root: realpathSync(existing.binding.root) }) !== canonicalJson(binding)) {
    return report("blocked", projectId, existing.snapshot.id, workspace, "Local binding paths differ. Rebinding is outside v0.8.", discovery, allFacts, limited.unknowns, []);
  }
  const superseded = existing
    ? existing.snapshot.facts.map((fact) => fact.id).filter((id) => !allFacts.some((fact) => fact.id === id)).sort()
    : [];
  const snapshot = finishSnapshot({
    schemaVersion: 1,
    projectId,
    definitionDigest: definitionDigest(definition),
    previousSnapshotId: existing?.snapshot.id ?? null,
    layout: discovery.layout,
    detectorSet: detectorSet(),
    repositories: discovery.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      vcs: repository.git.isRepository ? "git" as const : "none" as const,
      commit: repository.git.commit,
      dirty: repository.git.dirty,
      remote: repository.git.remote,
    })).sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    observations: uniqueById(observations),
    facts: allFacts,
    unknowns: limited.unknowns,
    knowledge: existing?.snapshot.knowledge ?? [],
    budget: budgets.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    changes: { superseded },
  });
  if (existing && canonicalJson(semanticSnapshotBody(existing.snapshot)) === canonicalJson(semanticSnapshotBody(snapshot))) {
    return report("unchanged", projectId, existing.snapshot.id, workspace, null, discovery, allFacts, limited.unknowns, []);
  }
  const operations = [
    { action: existing ? "unchanged" : "create", artifact: `var/projects/${projectId}/project.json` },
    { action: existing?.binding ? "unchanged" : "create", artifact: `var/local/bindings/${projectId}.json` },
    { action: "create", artifact: `var/projects/${projectId}/snapshots/${snapshot.id}.json` },
    { action: "replace", artifact: `var/projects/${projectId}/current.json` },
  ];
  if (!request.dryRun) {
    ensureRegistryParent(workspace, projectId);
    const definitionResult = writeImmutableJson(workspace, `var/projects/${projectId}/project.json`, definition);
    if (definitionResult === "conflict") throw new ProjectOnboardingError("Project definition already exists with different content.");
    const bindingResult = writeImmutableJson(workspace, relativeBinding(projectId), binding);
    if (bindingResult === "conflict") throw new ProjectOnboardingError("Project binding already exists with different content.");
    const snapshotResult = writeImmutableJson(workspace, `var/projects/${projectId}/snapshots/${snapshot.id}.json`, snapshot);
    if (snapshotResult === "conflict") throw new ProjectOnboardingError("Historical snapshot already exists with different content.");
    writeRegistryPointer(workspace, {
      schemaVersion: 1,
      projectId,
      snapshotId: snapshot.id,
      snapshotDigest: sha256Digest(snapshot),
    }, existing?.pointer.snapshotId ?? null);
  }
  return report(existing ? "updated" : "created", projectId, snapshot.id, workspace, null, discovery, allFacts, limited.unknowns, operations);
}

function containerSensitiveFact(observations: readonly ProjectObservation[]): ProjectFact | null {
  const supports = observations.filter((observation) => observation.sensitive && observation.location.repositoryId === null);
  if (supports.length === 0) return null;
  const paths = supports.map((observation) => observation.location.path).sort();
  return factRecord({
    repositoryId: null,
    category: "safety",
    key: "safety.sensitive-material",
    value: { kind: "list", items: paths },
    cardinality: "multiple",
    claim: { form: "existence", scope: { level: "project", repositoryIds: [], pathPrefixes: paths } },
    supports: supports.map((observation) => observation.id),
    contradictionProbes: [],
    evidenceQuality: "direct",
    derivation: { detectorId: "safety.sensitive-material", detectorVersion: 1, rule: "container-sensitive-path" },
    status: "validated",
    observedRevisions: [],
  });
}

function relativeBinding(projectId: string): string {
  return `var/local/bindings/${projectId}.json`;
}

function report(
  outcome: OnboardReport["outcome"],
  projectId: string | null,
  snapshotId: string | null,
  workspace: string,
  reason: string | null,
  discovery: ReturnType<typeof discoverRepositories>,
  facts: readonly ProjectFact[],
  unknowns: readonly ProjectUnknown[],
  operations: OnboardReport["operations"],
): OnboardReport {
  return {
    schemaVersion: 1,
    outcome,
    projectId,
    snapshotId,
    registryRoot: registryRoot(workspace),
    reason,
    summary: {
      repositories: discovery.repositories.length,
      facts: facts.length,
      unknowns: unknowns.length,
      sensitivePaths: facts.filter((fact) => fact.key === "safety.sensitive-material").length,
    },
    operations,
  };
}
