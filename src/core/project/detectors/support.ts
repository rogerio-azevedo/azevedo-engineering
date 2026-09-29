import { sha256Digest } from "../../filesystem/canonical-digest.js";
import type { ProjectInspection } from "../../schemas/discovery.js";
import type { Claim, FactStatus, ProjectFact, ProjectObservation, ProjectUnknown } from "../contracts.js";
import type { GitRead } from "../git-reader.js";
import { factRecord, observationRecord, unknownRecord } from "../identity.js";
import { presenceDigest, textDigest, type RepositoryView } from "../repository-view.js";

export const MAX_FACTS_PER_REPOSITORY = 40;

export function prismaDatasourceProvider(text: string): string | undefined {
  const block = text.match(/datasource\s+[A-Za-z0-9_]+\s*\{([^}]*)\}/);
  return block?.[1]?.match(/provider\s*=\s*"([a-z0-9_-]+)"/)?.[1];
}

export type DetectorClaim = {
  category: ProjectFact["category"];
  key: string;
  cardinality: ProjectFact["cardinality"];
  form: "existence" | "enumeration";
};

export type DetectorOutput = {
  observations: ProjectObservation[];
  facts: ProjectFact[];
  unknowns: ProjectUnknown[];
};

export type ProjectFactDetector = {
  id: string;
  version: number;
  claims: readonly DetectorClaim[];
  detect(input: { view: RepositoryView; inspection: ProjectInspection | null; git: GitRead }): DetectorOutput;
};

type JsonObject = Record<string, unknown>;

export function emptyOutput(): DetectorOutput {
  return { observations: [], facts: [], unknowns: [] };
}

export function readJson(view: RepositoryView, relativePath: string): JsonObject | null {
  const text = view.readText(relativePath);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

export function dependencyNames(packageJson: JsonObject): string[] {
  const names = new Set<string>();
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    const value = packageJson[section];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const name of Object.keys(value)) names.add(name);
    }
  }
  return [...names].sort();
}

export function packagePaths(inspection: ProjectInspection | null): string[] {
  const packages = inspection?.packages ?? [];
  if (packages.length === 0) return ["package.json"];
  return packages.map((path) => path === "." ? "package.json" : `${path}/package.json`);
}

export function hasDependency(view: RepositoryView, inspection: ProjectInspection | null, dependency: string): string[] {
  return packagePaths(inspection).filter((path) => {
    const json = readJson(view, path);
    return json ? dependencyNames(json).includes(dependency) : false;
  });
}

export function scope(repositoryId: string, level: Claim["scope"]["level"], pathPrefixes: string[]): Claim["scope"] {
  return {
    level,
    repositoryIds: level === "project" ? [] : [repositoryId],
    pathPrefixes,
  };
}

export function addObservation(
  output: DetectorOutput,
  view: RepositoryView,
  input: {
    path: string;
    basis: ProjectObservation["basis"];
    subject: string;
    basisDigest?: string;
    sensitive?: boolean;
    coverage?: ProjectObservation["coverage"];
  },
): ProjectObservation {
  const path = input.path === "." ? "." : input.path.replace(/^\.\//, "");
  const observation = observationRecord({
    location: { repositoryId: view.repositoryId, path },
    basis: input.basis,
    subject: input.subject,
    basisDigest: input.basisDigest ?? (input.basis === "presence" ? presenceDigest() : textDigest(input.subject)),
    sensitive: input.sensitive ?? false,
    coverage: input.coverage ?? "not-applicable",
    revision: view.revision,
  });
  output.observations.push(observation);
  return observation;
}

export function addFact(
  output: DetectorOutput,
  view: RepositoryView,
  detector: { id: string; version: number },
  input: {
    category: ProjectFact["category"];
    key: string;
    value: ProjectFact["value"];
    cardinality: ProjectFact["cardinality"];
    form: Claim["form"];
    level?: Claim["scope"]["level"];
    pathPrefixes: string[];
    supports: string[];
    contradictionProbes?: string[];
    evidenceQuality: ProjectFact["evidenceQuality"];
    rule: string;
    status?: FactStatus;
  },
): void {
  if (input.supports.length === 0) return;
  output.facts.push(factRecord({
    repositoryId: view.repositoryId,
    category: input.category,
    key: input.key,
    value: input.value,
    cardinality: input.cardinality,
    claim: {
      form: input.form,
      scope: scope(view.repositoryId, input.level ?? "repository", input.pathPrefixes),
    },
    supports: input.supports,
    contradictionProbes: input.contradictionProbes ?? [],
    evidenceQuality: input.evidenceQuality,
    derivation: { detectorId: detector.id, detectorVersion: detector.version, rule: input.rule },
    status: input.status ?? "validated",
    observedRevisions: [{ repositoryId: view.repositoryId, revision: view.revision }],
  }));
}

export function addUnknown(output: DetectorOutput, view: RepositoryView, topic: string, reason: string): void {
  output.unknowns.push(unknownRecord({ repositoryId: view.repositoryId, topic, reason }));
}

export function digestOf(value: unknown): string {
  return sha256Digest(value);
}
