import { canonicalJson, sha256Digest } from "../filesystem/canonical-digest.js";
import { coverageSatisfies, providedCoverage, requiredCoverage } from "./coverage.js";
import type { Claim, ProjectKnowledge, ProjectSnapshot } from "./contracts.js";
import { finishSnapshot, knowledgeRecord, ProjectOnboardingError, semanticSnapshotBody } from "./identity.js";
import { loadProject, writeImmutableJson, writeRegistryPointer } from "./registry.js";

export type KnowledgeSubmission = {
  kind: ProjectKnowledge["kind"];
  statement: string;
  claim: Claim;
  supports: string[];
  factRefs: string[];
  submittedBy: string;
};

function withKnowledge(snapshot: ProjectSnapshot, knowledge: ProjectKnowledge[]): ProjectSnapshot {
  const { id: _id, ...rest } = snapshot;
  return finishSnapshot({
    ...rest,
    previousSnapshotId: snapshot.id,
    knowledge,
    changes: { superseded: [] },
  });
}

function persist(workspace: string, projectId: string, current: ProjectSnapshot, next: ProjectSnapshot): ProjectSnapshot {
  if (canonicalJson(semanticSnapshotBody(current)) === canonicalJson(semanticSnapshotBody(next))) return current;
  const result = writeImmutableJson(workspace, `var/projects/${projectId}/snapshots/${next.id}.json`, next);
  if (result === "conflict") throw new ProjectOnboardingError("Historical snapshot already exists with different content.");
  writeRegistryPointer(workspace, {
    schemaVersion: 1,
    projectId,
    snapshotId: next.id,
    snapshotDigest: sha256Digest(next),
  }, current.id);
  return next;
}

export function submitProjectKnowledge(workspace: string, projectId: string, submission: KnowledgeSubmission): ProjectKnowledge {
  const loaded = loadProject(workspace, projectId);
  const observations = loaded.snapshot.observations.filter((observation) => submission.supports.includes(observation.id));
  if (observations.length !== new Set(submission.supports).size) {
    throw new ProjectOnboardingError("Knowledge submission cites observations that are not in the current snapshot.");
  }
  if (submission.factRefs.some((id) => !loaded.snapshot.facts.some((fact) => fact.id === id))) {
    throw new ProjectOnboardingError("Knowledge submission cites facts that are not in the current snapshot.");
  }
  const status = submission.claim.form === "behavior" || !coverageSatisfies(requiredCoverage(submission.claim), providedCoverage(submission.claim, observations))
    ? "needs-revalidation" as const
    : "validated" as const;
  if (submission.claim.form !== "behavior" && status !== "validated") {
    throw new ProjectOnboardingError("Knowledge submission does not have evidence coverage for its claim.");
  }
  const knowledge = knowledgeRecord({
    kind: submission.kind,
    statement: submission.statement,
    claim: submission.claim,
    supports: submission.supports,
    factRefs: submission.factRefs,
    state: "candidate",
    status,
    submittedBy: submission.submittedBy,
    acceptedBy: null,
    validatedRevisions: loaded.snapshot.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      revision: repository.commit,
    })),
  });
  if (loaded.snapshot.knowledge.some((item) => item.id === knowledge.id)) {
    throw new ProjectOnboardingError(`Project knowledge ${knowledge.id} already exists.`);
  }
  persist(workspace, projectId, loaded.snapshot, withKnowledge(loaded.snapshot, [...loaded.snapshot.knowledge, knowledge]));
  return knowledge;
}

export function acceptProjectKnowledge(workspace: string, projectId: string, knowledgeId: string, acceptedBy: string): ProjectKnowledge {
  const loaded = loadProject(workspace, projectId);
  const current = loaded.snapshot.knowledge.find((item) => item.id === knowledgeId);
  if (!current) throw new ProjectOnboardingError(`Unknown project knowledge: ${knowledgeId}`);
  if (current.state !== "candidate") throw new ProjectOnboardingError(`Project knowledge ${knowledgeId} is already ${current.state}.`);
  const accepted: ProjectKnowledge = {
    ...current,
    state: "accepted",
    acceptedBy,
    status: current.claim.form === "behavior" ? "needs-revalidation" : current.status,
  };
  persist(workspace, projectId, loaded.snapshot, withKnowledge(
    loaded.snapshot,
    loaded.snapshot.knowledge.map((item) => item.id === knowledgeId ? accepted : item),
  ));
  return accepted;
}
