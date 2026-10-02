import { realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expandIntentTerms } from "../exploration/explore-project.js";
import { canonicalDigest } from "../filesystem/canonical-digest.js";
import type { ProjectContext, ProjectFact } from "../project/contracts.js";
import { createRepositoryView, type RepositoryView } from "../project/repository-view.js";
import { isSensitivePath } from "../project/sensitive-paths.js";
import type { SubjectRevision } from "../schemas/evidence.js";
import {
  RepositoryExplorationSchema,
  type ExplorationCoverage,
  type RepositoryExploration,
  type RepositoryRelevance,
  type WorkEvidence,
  type WorkItemSpecification,
} from "./contracts.js";
import { repositoryExplorationIdentity } from "./identity.js";

const SKIP = new Set(["node_modules", "dist", "coverage", ".git", ".next", ".azevedo", ".codex", "var"]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|prisma|graphql|gql|vue|py|go|java|rb)$/i;

export type ExplorationLimits = {
  maxListings: number;
  maxReads: number;
  maxDepth: number;
};

export const DEFAULT_EXPLORATION_LIMITS: ExplorationLimits = {
  maxListings: 160,
  maxReads: 40,
  maxDepth: 8,
};

export function orientationFor(
  context: ProjectContext,
  repositoryId: string,
): { factIds: string[]; roots: string[] } {
  const facts = context.facts.current.filter((fact) => fact.repositoryId === repositoryId || fact.repositoryId === null);
  const useful = facts.filter((fact) =>
    fact.key === "architecture.source-root"
    || fact.key === "architecture.composition-root"
    || fact.key.startsWith("framework.")
    || fact.key.startsWith("persistence."));
  const roots = new Set<string>();
  for (const fact of useful) addFactRoots(fact, roots);
  return {
    factIds: useful.map((fact) => fact.id).sort(),
    roots: [...roots].sort(),
  };
}

function addFactRoots(fact: ProjectFact, roots: Set<string>): void {
  for (const prefix of fact.claim.scope.pathPrefixes) {
    const directory = prefix.replaceAll("\\", "/").split("/").filter((segment) => segment && segment !== "." && segment !== "..");
    if (directory.length === 0) continue;
    const last = directory[directory.length - 1] ?? "";
    if (last.includes(".")) directory.pop();
    if (directory.length > 0) roots.add(directory.join("/"));
  }
}

export function exploreBoundRepository(input: {
  projectId: string;
  workItemId: string;
  repositoryId: string;
  root: string;
  specification: WorkItemSpecification;
  context: ProjectContext;
  sourceRevision: SubjectRevision;
  contextUnits: readonly string[];
  limits?: ExplorationLimits;
}): RepositoryExploration {
  const limits = input.limits ?? DEFAULT_EXPLORATION_LIMITS;
  const orientation = orientationFor(input.context, input.repositoryId);
  const terms = expandIntentTerms(`${input.specification.title}\n${input.specification.objective}`);
  const wantsSuggestion = /sugest/.test(normalize(input.specification.objective));
  const view = createRepositoryView(input.root, input.repositoryId, input.sourceRevision.head, {
    maxReads: limits.maxReads,
    maxListings: limits.maxListings,
    maxListingEntries: 200,
  });
  const found = walk(view, orientation.roots, terms, limits);
  const evidence: WorkEvidence[] = [];
  let reads = 0;
  const ranked = [...found.files].sort((left, right) => score(right, terms) - score(left, terms) || left.localeCompare(right));
  const readPaths: string[] = [];
  for (const path of ranked) {
    if (reads >= limits.maxReads) break;
    if (isSensitivePath(path)) continue;
    const content = view.readText(path);
    reads += 1;
    readPaths.push(path);
    if (content === null) continue;
    evidence.push(...classify(input.repositoryId, path, content, terms, wantsSuggestion));
  }
  const unread = ranked.filter((path) => !readPaths.includes(path));
  const budgetLimited = found.budgetLimited || unread.length > 0 || view.stopReason === "budget-exhausted";
  const unexamined = [...new Set([...found.unexamined, ...unread])].sort();
  const coverage: ExplorationCoverage = {
    complete: unexamined.length === 0 && !budgetLimited,
    budgetLimited,
    examined: [...new Set(found.examined)].sort(),
    unexamined,
  };
  if (evidence.length === 0 && readPaths.length > 0) {
    const sample = readPaths[0];
    if (sample) evidence.push(record(input.repositoryId, sample, "examined", "Examined and no relation to the intent was found."));
  }
  const direct = evidence.filter((item) => item.relation === "direct" || item.relation === "analogous");
  const candidates = evidence.filter((item) => item.relation === "candidate");
  const orientationRecord = {
    factIds: orientation.factIds,
    boundaries: input.context.boundaries,
  };
  const contextUnits = [...input.contextUnits].sort();
  const sortedEvidence = evidence.sort((left, right) => left.id.localeCompare(right.id));
  let stopReason: RepositoryExploration["stopReason"];
  let relevanceWithoutId: RepositoryRelevance;
  if (direct.length > 0) {
    stopReason = coverage.budgetLimited
      ? "budget-exhausted"
      : coverage.complete ? "sufficient-evidence" : "scope-boundary";
    relevanceWithoutId = {
      state: "RELEVANT",
      statement: "Current exploration evidence relates this repository to the work item.",
      explorationId: "exploration-000000000000",
      evidenceIds: direct.map((item) => item.id),
    };
  } else if (!coverage.complete) {
    stopReason = coverage.budgetLimited ? "budget-exhausted" : "scope-boundary";
    relevanceWithoutId = {
      state: "UNKNOWN",
      cause: "exploration",
      stopReason,
      statement: coverageStatement(coverage),
      explorationId: "exploration-000000000000",
    };
  } else if (candidates.length > 0 || sortedEvidence.length === 0) {
    stopReason = sortedEvidence.length === 0 ? "blocked-by-missing-context" : "blocked-by-ambiguity";
    relevanceWithoutId = {
      state: "UNKNOWN",
      cause: "exploration",
      stopReason,
      statement: sortedEvidence.length === 0
        ? "Exploration did not examine enough of the repository to decide relevance."
        : "Exploration found only lexical candidates, which are insufficient to decide relevance.",
      explorationId: "exploration-000000000000",
    };
  } else {
    stopReason = "sufficient-evidence";
    relevanceWithoutId = {
      state: "NOT_RELEVANT",
      statement: `Examined ${coverage.examined.join(", ")} and found no relation to the work item. No in-scope region remained unexamined.`,
      explorationId: "exploration-000000000000",
      evidenceIds: sortedEvidence.filter((item) => item.relation === "examined").map((item) => item.id),
    };
  }
  const explorationId = repositoryExplorationIdentity({
    projectId: input.projectId,
    workItemId: input.workItemId,
    repositoryId: input.repositoryId,
    specificationId: input.specification.id,
    sourceRevision: input.sourceRevision,
    orientation: orientationRecord,
    contextUnits,
    coverage,
    evidence: sortedEvidence,
    stopReason,
    relevance: relevanceWithoutId,
  });
  const relevance = { ...relevanceWithoutId, explorationId };
  return RepositoryExplorationSchema.parse({
    schemaVersion: 1,
    kind: "repository-exploration",
    id: explorationId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    repositoryId: input.repositoryId,
    specificationId: input.specification.id,
    sourceRevision: input.sourceRevision,
    orientation: orientationRecord,
    contextUnits,
    coverage,
    evidence: sortedEvidence,
    relevance,
    stopReason,
  });
}

function coverageStatement(coverage: ExplorationCoverage): string {
  const sample = coverage.unexamined.slice(0, 8).join(", ");
  const extra = coverage.unexamined.length > 8 ? ` and ${coverage.unexamined.length - 8} more` : "";
  const limit = coverage.budgetLimited ? " The read or listing budget was exhausted." : "";
  return `Coverage is insufficient to conclude that the repository is not relevant. Unexamined in-scope regions: ${sample}${extra}.${limit}`;
}

function walk(
  view: RepositoryView,
  roots: readonly string[],
  terms: readonly string[],
  limits: ExplorationLimits,
): { files: string[]; examined: string[]; unexamined: string[]; budgetLimited: boolean } {
  const files: string[] = [];
  const examined: string[] = [];
  const unexamined: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ path: string; depth: number; priority: number }> = [];
  const seeds = new Set<string>([".", ...roots]);
  for (const root of seeds) queue.push({ path: root, depth: 0, priority: score(root, terms) });
  let listings = 0;
  let budgetLimited = false;
  while (queue.length > 0) {
    queue.sort((left, right) => right.priority - left.priority || left.path.localeCompare(right.path));
    const current = queue.shift();
    if (!current || seen.has(current.path)) continue;
    if (current.depth > limits.maxDepth) {
      unexamined.push(current.path);
      continue;
    }
    seen.add(current.path);
    if (listings >= limits.maxListings) {
      budgetLimited = true;
      unexamined.push(current.path, ...queue.map((item) => item.path));
      break;
    }
    const listing = view.list(current.path === "" ? "." : current.path);
    listings += 1;
    examined.push(current.path === "" ? "." : current.path);
    if (listing.coverage === "truncated") {
      budgetLimited = true;
      unexamined.push(current.path === "" ? "." : current.path);
    }
    for (const entry of listing.entries) {
      if (SKIP.has(entry) || entry.startsWith(".")) continue;
      const path = current.path === "." || current.path === "" ? entry : `${current.path}/${entry}`;
      if (isSensitivePath(path) || !view.exists(path)) continue;
      const kind = entryKind(view.root, path);
      if (kind === "dir") {
        if (shouldExpand(path, terms)) queue.push({ path, depth: current.depth + 1, priority: score(path, terms) });
        else unexamined.push(path);
      } else if (kind === "file" && SOURCE.test(entry)) files.push(path);
    }
  }
  return {
    files: [...new Set(files)].sort(),
    examined,
    unexamined,
    budgetLimited,
  };
}

function entryKind(root: string, relativePath: string): "dir" | "file" | "other" {
  try {
    const absolute = join(root, ...relativePath.split("/"));
    const real = realpathSync(absolute);
    const value = relative(root, real);
    if (value.startsWith("..") || value === "..") return "other";
    const stats = statSync(real);
    if (stats.isDirectory()) return "dir";
    if (stats.isFile()) return "file";
    return "other";
  } catch {
    return "other";
  }
}

const STRUCTURAL = new Set([
  "src", "app", "application", "modules", "domain", "use-cases", "usecases",
  "services", "infra", "http", "resolvers", "prisma", "pages", "components",
]);

function shouldExpand(path: string, terms: readonly string[]): boolean {
  if (score(path, terms) > 0) return true;
  const segments = normalize(path).split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? "";
  const parent = segments[segments.length - 2] ?? "";
  return STRUCTURAL.has(name) || STRUCTURAL.has(parent);
}

function score(path: string, terms: readonly string[]): number {
  const normalized = normalize(path);
  const name = normalized.split("/").pop() ?? normalized;
  let value = terms.reduce((total, term) => total + (normalized.includes(term) ? 2 : 0), 0);
  if (STRUCTURAL.has(name)) value += 1;
  if (normalized.includes("from-occurrence") || normalized.includes("fromoccurrence")) value += 5;
  return value;
}

function classify(
  repositoryId: string,
  path: string,
  content: string,
  terms: readonly string[],
  wantsSuggestion: boolean,
): WorkEvidence[] {
  const haystack = normalize(`${path}\n${content}`);
  const hits = terms.filter((term) => haystack.includes(term));
  const structural = /resolver|schema|model|entity|service|page|workspace|controller|prisma|module/.test(normalize(path));
  const analogous = /from[-_\s]?occurrence|fromoccurrence/.test(normalize(`${path}\n${content}`));
  const suggestion = wantsSuggestion && /\bsuggestion\b/i.test(content);
  const records: WorkEvidence[] = [];
  if (analogous && hits.length > 0) {
    records.push(record(repositoryId, path, "analogous", "The file matches an analogous from-occurrence pattern. It is not a requirement."));
  }
  if (hits.length > 0 && structural && !analogous) {
    records.push(record(repositoryId, path, "direct", "The file matches the intent terms and a structural role in the current repository."));
  } else if (hits.length > 0 && !analogous && !structural) {
    records.push(record(repositoryId, path, "candidate", "Lexical match only. Not a requirement."));
  }
  if (suggestion) records.push(record(repositoryId, path, "candidate", "OccurrenceCategory-style SUGGESTION text is a lexical candidate, not a requirement."));
  if (records.length === 0) {
    records.push(record(repositoryId, path, "examined", "Examined and no relation to the intent was found."));
  }
  return records;
}

function record(
  repositoryId: string,
  path: string,
  relation: WorkEvidence["relation"],
  reason: string,
): WorkEvidence {
  const body = { repositoryId, path, relation, reason };
  return { id: `evidence-${canonicalDigest(body, 12)}`, ...body };
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
