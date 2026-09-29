import { existsSync } from "node:fs";
import { join } from "node:path";
import { sha256Digest } from "../filesystem/canonical-digest.js";
import type { ProjectContext, ProjectFact, ProjectKnowledge } from "./contracts.js";
import { ProjectContextSchema } from "./contracts.js";
import { readGitRepository, type GitRead } from "./git-reader.js";
import { loadProject, type LoadedProject } from "./registry.js";
import { recheckObservation, statusFromRechecks } from "./revalidate.js";
import { createRepositoryView, type RepositoryView } from "./repository-view.js";

function bucketFact(fact: ProjectFact, buckets: ProjectContext["facts"]): void {
  if (fact.status === "validated" && (fact.evidenceQuality === "direct" || fact.evidenceQuality === "corroborated")) buckets.current.push(fact);
  else if (fact.status === "validated") buckets.weakSignals.push(fact);
  else if (fact.status === "needs-revalidation") buckets.needsRevalidation.push(fact);
  else if (fact.status === "stale") buckets.stale.push(fact);
  else buckets.conflicted.push(fact);
}

export function buildProjectContext(workspace: string, projectId: string): ProjectContext {
  const loaded = loadProject(workspace, projectId);
  const bindingAvailable = loaded.binding !== null && existsSync(loaded.binding.root);
  const views = new Map<string, RepositoryView>();
  const gits = new Map<string, GitRead>();
  const notices: ProjectContext["notices"] = [];
  if (!bindingAvailable) {
    notices.push({
      code: "binding-unavailable",
      repositoryId: null,
      message: "The local checkout binding is missing or unavailable. Project identity was preserved.",
    });
  }
  const containerRoot = bindingAvailable && loaded.binding ? loaded.binding.root : null;
  if (containerRoot) {
    views.set("", createRepositoryView(containerRoot, "root", null));
    gits.set("", readGitRepository(containerRoot));
  }
  const liveRepositories: ProjectContext["live"]["repositories"] = [];
  const contextRepositories: ProjectContext["repositories"] = [];
  for (const repository of loaded.snapshot.repositories) {
    const bound = loaded.binding?.repositories.find((item) => item.repositoryId === repository.repositoryId);
    const relativePath = bound?.path ?? repository.repositoryId;
    const absolute = containerRoot ? join(containerRoot, relativePath === "." ? "" : relativePath) : null;
    const available = absolute !== null && existsSync(absolute);
    const git = available && absolute ? readGitRepository(absolute) : null;
    if (git && absolute) {
      gits.set(repository.repositoryId, git);
      views.set(repository.repositoryId, createRepositoryView(absolute, repository.repositoryId, git.commit));
    }
    if (!available) {
      notices.push({
        code: "repository-unavailable",
        repositoryId: repository.repositoryId,
        message: `Repository ${repository.repositoryId} is not available in the local binding.`,
      });
    } else if (git && git.commit !== repository.commit) {
      notices.push({
        code: "revision-changed",
        repositoryId: repository.repositoryId,
        message: `Repository ${repository.repositoryId} moved from ${repository.commit ?? "no commit"} to ${git.commit ?? "no commit"}.`,
      });
    }
    if (git && git.remote !== repository.remote) {
      notices.push({
        code: "remote-changed",
        repositoryId: repository.repositoryId,
        message: `Remote for ${repository.repositoryId} differs from the snapshot. Project identity was not changed.`,
      });
    }
    const name = loaded.definition.repositories.find((item) => item.repositoryId === repository.repositoryId)?.name ?? repository.repositoryId;
    contextRepositories.push({
      repositoryId: repository.repositoryId,
      name,
      role: null,
      roleBasis: "no-evidence",
      snapshotRevision: repository.commit,
      available,
    });
    liveRepositories.push({
      repositoryId: repository.repositoryId,
      path: absolute ?? relativePath,
      branch: git?.branch ?? null,
      revision: git?.commit ?? null,
      dirty: git?.dirty ?? false,
    });
  }
  const observations = new Map(loaded.snapshot.observations.map((observation) => [observation.id, observation]));
  const facts = loaded.snapshot.facts.map((fact) => revalidateFact(loaded, fact, views, gits, bindingAvailable));
  const knowledge = loaded.snapshot.knowledge.map((item) => revalidateKnowledge(loaded, item, views, gits, bindingAvailable));
  const buckets: ProjectContext["facts"] = { current: [], weakSignals: [], needsRevalidation: [], stale: [], conflicted: [] };
  for (const fact of facts) bucketFact(fact, buckets);
  for (const bucket of Object.values(buckets)) bucket.sort((left, right) => left.id.localeCompare(right.id));
  const accepted = knowledge.filter((item) => item.state === "accepted");
  const sensitiveMaterial = loaded.snapshot.observations
    .filter((observation) => observation.sensitive)
    .map((observation) => ({ repositoryId: observation.location.repositoryId, path: observation.location.path }))
    .sort((left, right) => `${left.repositoryId ?? ""}:${left.path}`.localeCompare(`${right.repositoryId ?? ""}:${right.path}`));
  if (sensitiveMaterial.length > 0) {
    notices.push({
      code: "sensitive-material",
      repositoryId: null,
      message: "Sensitive-looking paths were recorded by presence only. Their contents were not read or stored.",
    });
  }
  const contextWithoutDigest = {
    schemaVersion: 1 as const,
    projectId: loaded.definition.projectId,
    name: loaded.definition.name,
    snapshotId: loaded.snapshot.id,
    definitionDigest: loaded.snapshot.definitionDigest,
    layout: loaded.snapshot.layout,
    repositories: contextRepositories.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    facts: buckets,
    knowledge: {
      current: accepted.filter((item) => item.status === "validated" && item.claim.form !== "behavior"),
      needsRevalidation: accepted.filter((item) => item.status === "needs-revalidation"),
      stale: accepted.filter((item) => item.status === "stale" || item.status === "conflicted"),
      candidateCount: knowledge.filter((item) => item.state === "candidate").length,
    },
    unknowns: [...loaded.snapshot.unknowns].sort((left, right) => left.id.localeCompare(right.id)),
    sensitiveMaterial,
    notices: notices.sort((left, right) => `${left.code}:${left.repositoryId ?? ""}:${left.message}`.localeCompare(`${right.code}:${right.repositoryId ?? ""}:${right.message}`)),
    boundaries: {
      authorizesMutation: false as const,
      replacesExploration: false as const,
      reviewTrust: "untrusted-context" as const,
    },
  };
  return ProjectContextSchema.parse({
    ...contextWithoutDigest,
    digest: sha256Digest(contextWithoutDigest),
    live: {
      bindingRoot: bindingAvailable && loaded.binding ? loaded.binding.root : null,
      repositories: liveRepositories.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    },
  });
}

function revalidateFact(
  loaded: LoadedProject,
  fact: ProjectFact,
  views: ReadonlyMap<string, RepositoryView>,
  gits: ReadonlyMap<string, GitRead>,
  bindingAvailable: boolean,
): ProjectFact {
  if (!bindingAvailable) return { ...fact, status: "needs-revalidation" };
  const repository = loaded.snapshot.repositories.find((item) => item.repositoryId === fact.repositoryId);
  const git = gits.get(fact.repositoryId ?? "");
  if (fact.repositoryId && !views.has(fact.repositoryId)) return { ...fact, status: "needs-revalidation" };
  if (repository && git && git.commit === repository.commit && !git.dirty && !repository.dirty) return fact;
  return { ...fact, status: recheckedStatus(fact, loaded, views, gits) };
}

function revalidateKnowledge(
  loaded: LoadedProject,
  knowledge: ProjectKnowledge,
  views: ReadonlyMap<string, RepositoryView>,
  gits: ReadonlyMap<string, GitRead>,
  bindingAvailable: boolean,
): ProjectKnowledge {
  if (knowledge.claim.form === "behavior") return { ...knowledge, status: "needs-revalidation" };
  if (!bindingAvailable) return { ...knowledge, status: "needs-revalidation" };
  const repositoryId = knowledge.claim.scope.repositoryIds[0] ?? null;
  const repository = loaded.snapshot.repositories.find((item) => item.repositoryId === repositoryId);
  const git = gits.get(repositoryId ?? "");
  if (repository && git && git.commit === repository.commit && !git.dirty && !repository.dirty) return knowledge;
  return { ...knowledge, status: recheckedStatus(knowledge, loaded, views, gits) };
}

function recheckedStatus(
  item: ProjectFact | ProjectKnowledge,
  loaded: LoadedProject,
  views: ReadonlyMap<string, RepositoryView>,
  gits: ReadonlyMap<string, GitRead>,
): ProjectFact["status"] {
  const observations = new Map(loaded.snapshot.observations.map((observation) => [observation.id, observation]));
  const results = item.supports.map((id) => {
    const observation = observations.get(id);
    if (!observation) return "removed" as const;
    const view = views.get(observation.location.repositoryId ?? "");
    const git = gits.get(observation.location.repositoryId ?? "");
    if (!view || !git) return "removed" as const;
    return recheckObservation(view, git, observation);
  });
  const probeView = "contradictionProbes" in item ? views.get(item.repositoryId ?? "") : undefined;
  const probeTripped = "contradictionProbes" in item && probeView
    ? item.contradictionProbes.some((probe) => probeView.exists(probe))
    : false;
  return statusFromRechecks(
    { ...item, claim: item.claim, supports: item.supports } as ProjectFact,
    results,
    probeTripped,
  );
}
