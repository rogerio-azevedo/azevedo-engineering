import { basename } from "node:path";
import { canonicalDigest, sha256Digest } from "../filesystem/canonical-digest.js";
import {
  ProjectDefinitionSchema,
  ProjectFactSchema,
  ProjectKnowledgeSchema,
  ProjectObservationSchema,
  ProjectSnapshotSchema,
  ProjectUnknownSchema,
  type ProjectDefinition,
  type ProjectFact,
  type ProjectKnowledge,
  type ProjectObservation,
  type ProjectSnapshot,
  type ProjectUnknown,
} from "./contracts.js";

export class ProjectOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectOnboardingError";
  }
}

export function slugify(value: string): string {
  const separated = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
  const slug = separated.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ProjectOnboardingError(`Cannot derive a stable project id from "${value}". Pass --project-id.`);
  }
  return slug;
}

export function suggestProjectId(input: { projectId?: string | undefined; name?: string | undefined; targetPath: string }): string {
  if (input.projectId) return slugify(input.projectId);
  if (input.name) return slugify(input.name);
  return slugify(basename(input.targetPath));
}

export function suggestRepositoryId(directoryName: string, singleRepository: boolean): string {
  return singleRepository ? "root" : slugify(directoryName);
}

export function definitionDigest(definition: ProjectDefinition): string {
  const parsed = ProjectDefinitionSchema.parse(definition);
  return sha256Digest({
    schemaVersion: parsed.schemaVersion,
    projectId: parsed.projectId,
    name: parsed.name,
    repositories: [...parsed.repositories].sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
  });
}

export function observationRecord(input: Omit<ProjectObservation, "id">): ProjectObservation {
  const id = `observation-${canonicalDigest({
    location: input.location,
    basis: input.basis,
    subject: input.subject,
    basisDigest: input.basisDigest,
    sensitive: input.sensitive,
    coverage: input.coverage,
  })}`;
  return ProjectObservationSchema.parse({ ...input, id });
}

export function factRecord(input: Omit<ProjectFact, "id">): ProjectFact {
  const id = `fact-${canonicalDigest({
    repositoryId: input.repositoryId,
    category: input.category,
    key: input.key,
    value: input.value,
    cardinality: input.cardinality,
    claim: input.claim,
    supports: [...input.supports].sort(),
    contradictionProbes: [...input.contradictionProbes].sort(),
    evidenceQuality: input.evidenceQuality,
    derivation: input.derivation,
  })}`;
  return ProjectFactSchema.parse({ ...input, id });
}

export function unknownRecord(input: Omit<ProjectUnknown, "id">): ProjectUnknown {
  const id = `unknown-${canonicalDigest(input)}`;
  return ProjectUnknownSchema.parse({ ...input, id });
}

export function knowledgeRecord(input: Omit<ProjectKnowledge, "id">): ProjectKnowledge {
  const id = `project-knowledge-${canonicalDigest({
    kind: input.kind,
    statement: input.statement,
    claim: input.claim,
    supports: [...input.supports].sort(),
    factRefs: [...input.factRefs].sort(),
    submittedBy: input.submittedBy,
  })}`;
  return ProjectKnowledgeSchema.parse({ ...input, id });
}

export function snapshotIdentity(snapshot: Omit<ProjectSnapshot, "id">): string {
  return `snapshot-${canonicalDigest(snapshot, 16)}`;
}

export function finishSnapshot(snapshot: Omit<ProjectSnapshot, "id">): ProjectSnapshot {
  return ProjectSnapshotSchema.parse({ ...snapshot, id: snapshotIdentity(snapshot) });
}

export function semanticSnapshotBody(snapshot: ProjectSnapshot): unknown {
  const { id: _id, previousSnapshotId: _previous, changes: _changes, ...body } = snapshot;
  return body;
}
