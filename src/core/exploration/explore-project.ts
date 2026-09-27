import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { extname, join, posix, relative, resolve, sep } from "node:path";
import type { ProjectInspectResult } from "../inspection/inspect-result.js";
import { KNOWLEDGE_CATALOG } from "../knowledge/catalog.js";
import { resolveContextManifest } from "../knowledge/resolve-context.js";
import { EngineeringPlanSchema, type EngineeringPlan } from "../planning/engineering-plan.js";
import {
  createEngineeringPlanRevision,
  type EngineeringPlanRevision,
} from "../planning/plan-revision.js";
import { classifyTask } from "../risk/classify-task.js";
import { FeatureSpecificationSchema, type FeatureSpecification } from "../specification/feature-specification.js";
import { captureSubjectRevision } from "../verification/subject-revision.js";
import { resolveVerificationPlan } from "../verification/verification-plan.js";
import {
  ExplorationArtifactSchema,
  type ExplorationArtifact,
  type ExplorationEvidence,
} from "./exploration-artifact.js";

const IGNORED_DIRECTORIES = new Set([
  ".git", ".azevedo", ".cache", ".next", "build", "coverage", "dist", "node_modules", "vendor",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".graphql", ".gql",
  ".json", ".prisma", ".sql", ".md", ".yaml", ".yml",
]);
const STRUCTURAL_FILES = new Set([
  "package.json", "tsconfig.json", "nest-cli.json", "next.config.js", "next.config.mjs", "next.config.ts",
  "schema.prisma", "schema.gql", "drizzle.config.ts",
]);
const STOP_WORDS = new Set([
  "a", "as", "ao", "aos", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos",
  "o", "os", "para", "por", "que", "um", "uma", "the", "to", "of", "and", "in", "on", "for", "with",
  "adicionar", "add", "create", "novo", "nova", "ser", "deve", "should", "quando", "when", "given", "then",
]);
const GENERIC_INTENT_TERMS = new Set([
  "adicionar", "aplicar", "assistente", "backend", "categoria", "categorias", "contexto", "decisao",
  "estado", "frontend", "fluxo", "humana", "humano", "implementar", "permitir", "primeira", "resposta",
  "respostas", "sistema", "sindico", "sugestao", "sugestoes", "versao",
]);
const HIGH_SIGNAL_INTENT_TERMS = new Set([
  "analysis", "analise", "classifier", "classificador", "confidence", "confianca", "fingerprint", "jev",
  "minimizacao", "provider", "provedor", "risk", "risco", "routine", "rotina", "template", "templates",
  "typesafe",
]);
const TERM_GROUPS: ReadonlyArray<readonly string[]> = [
  ["realizacao", "realizacoes", "realization", "realizations"],
  ["ocorrencia", "ocorrencias", "occurrence", "occurrences", "incident", "incidents"],
  ["arquivar", "arquivado", "arquivada", "archive", "archived", "archiving"],
  ["filtro", "filtrar", "filter", "filters", "filtering"],
  ["listagem", "lista", "listar", "list", "listing"],
  ["status", "situacao", "state"],
  ["condominio", "condominios", "condominium", "condominiums"],
  ["usuario", "usuarios", "user", "users"],
  ["analise", "analises", "analysis", "analyses"],
  ["classificacao", "classificar", "classification", "classify", "classifier"],
  ["template", "templates"],
  ["risco", "riscos", "risk", "risks"],
  ["confianca", "confidence"],
  ["provedor", "provider", "typesafe"],
];
const ACTION_TERM_GROUPS: ReadonlyArray<readonly string[]> = [TERM_GROUPS[2]!, TERM_GROUPS[3]!];
const ENTITY_TERM_GROUPS: ReadonlyArray<readonly string[]> = [TERM_GROUPS[0]!, TERM_GROUPS[1]!, TERM_GROUPS[6]!, TERM_GROUPS[7]!];
const ENTRY_PATTERNS: Array<[RegExp, ExplorationArtifact["entryPoints"][number]["kind"]]> = [
  [/(?:^|\/)(?:[^/]+\.)?controller\.[mc]?[jt]sx?$/i, "controller"],
  [/(?:^|\/)(?:[^/]+\.)?resolver\.[mc]?[jt]sx?$/i, "resolver"],
  [/(?:^|\/)route\.[mc]?[jt]sx?$/i, "route"],
  [/(?:^|\/)page\.[mc]?[jt]sx?$/i, "page"],
  [/(?:^|\/)[^/]+[.-](?:component|view)\.[mc]?[jt]sx?$/i, "component"],
  [/(?:^|\/)[^/]+[.-](?:handler|action)\.[mc]?[jt]sx?$/i, "handler"],
  [/(?:^|\/)[^/]+[.-](?:consumer|subscriber)\.[mc]?[jt]sx?$/i, "consumer"],
  [/(?:^|\/)[^/]+[.-](?:job|worker)\.[mc]?[jt]sx?$/i, "job"],
];

type RiskSignal = EngineeringPlan["risk"]["signals"][number];
type RiskClass = EngineeringPlan["risk"]["class"];
type FileRecord = { path: string; content: string; pathScore: number; contentScore: number };

export type ExploreProjectOptions = {
  maxFilesInspected?: number;
};

export type ExploreProjectResult = {
  artifact: ExplorationArtifact;
  revision: EngineeringPlanRevision | null;
};

function portable(path: string): string {
  return path.split(sep).join("/");
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith(`..${sep}`) && resolve(root, value) === candidate;
}

function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokens(value: string): string[] {
  return [...new Set(normalizeText(value).split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !STOP_WORDS.has(term)))];
}

function sourceText(specification: FeatureSpecification): string {
  return [
    specification.title,
    specification.objective,
    specification.description ?? "",
    specification.context ?? "",
    ...specification.expectedBehaviors,
    ...specification.businessRules,
    ...specification.scenarios.flatMap((scenario) => [scenario.given, scenario.when, scenario.then]),
    ...specification.edgeCases,
    ...specification.decisions,
    ...specification.constraints,
    ...specification.acceptanceCriteria.flatMap((criterion) => [
      criterion.statement, criterion.scenario.given, criterion.scenario.when, criterion.scenario.then,
    ]),
  ].join(" ");
}

function expandedTerms(specification: FeatureSpecification): { seeds: string[]; expansions: Map<string, string[]> } {
  const seeds = tokens(sourceText(specification));
  const expansions = new Map<string, string[]>();
  for (const seed of seeds) {
    const group = TERM_GROUPS.find((values) => values.includes(seed));
    expansions.set(seed, [...new Set(group ?? [seed])]);
  }
  return { seeds, expansions };
}

function inventoryFiles(root: string, directory = root): string[] {
  let entries;
  try {
    const realDirectory = realpathSync(directory);
    if (!isWithin(root, realDirectory)) return [];
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name)).flatMap((entry) => {
    if (IGNORED_DIRECTORIES.has(entry.name)) return [];
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return inventoryFiles(root, absolute);
    if (!entry.isFile()) return [];
    const path = portable(relative(root, absolute));
    return TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase()) || STRUCTURAL_FILES.has(entry.name) ? [path] : [];
  });
}

function pathScore(path: string, terms: readonly string[]): number {
  const normalized = normalizeText(path);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 4 : 0), 0)
    + (ENTRY_PATTERNS.some(([pattern]) => pattern.test(path)) ? 1 : 0)
    + (STRUCTURAL_FILES.has(posix.basename(path)) ? 1 : 0)
    + (/\.(?:test|spec|e2e-spec)\.[mc]?[jt]sx?$/i.test(path) ? 1 : 0);
}

function safeRead(root: string, path: string): string | null {
  try {
    const absolute = resolve(root, path);
    if (!isWithin(root, absolute)) return null;
    const stats = lstatSync(absolute);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 512 * 1024 || !isWithin(root, realpathSync(absolute))) return null;
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function contentScore(content: string, terms: readonly string[]): number {
  const normalized = normalizeText(content);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function evidenceId(value: unknown): string {
  return `evidence-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12)}`;
}

function firstSymbol(content: string): string | null {
  return /(?:export\s+)?(?:default\s+)?(?:class|function|interface|type|const)\s+([A-Za-z_$][\w$]*)/.exec(content)?.[1] ?? null;
}

function firstTermLine(content: string, terms: readonly string[]): number | null {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => terms.some((term) => normalizeText(line).includes(term)));
  return index >= 0 ? index + 1 : null;
}

function createEvidence(
  record: Pick<FileRecord, "path" | "content">,
  terms: readonly string[],
  kind: ExplorationEvidence["kind"],
  reason: string,
  taskRelation: string,
): ExplorationEvidence {
  const symbol = firstSymbol(record.content);
  const line = firstTermLine(record.content, terms);
  const identity = { kind, path: record.path, symbol, line, reason, taskRelation };
  return {
    id: evidenceId(identity),
    kind,
    path: record.path,
    symbol,
    location: line === null ? null : { startLine: line, endLine: line },
    reason,
    taskRelation,
    links: [],
  };
}

function entryKind(path: string, content: string): ExplorationArtifact["entryPoints"][number]["kind"] | null {
  for (const [pattern, kind] of ENTRY_PATTERNS) if (pattern.test(path)) return kind;
  if (/@Controller\b/.test(content)) return "controller";
  if (/@Resolver\b/.test(content)) return "resolver";
  return null;
}

function evidenceKind(path: string): ExplorationEvidence["kind"] {
  if (STRUCTURAL_FILES.has(posix.basename(path))) return "manifest";
  if (/(?:^|\/)migrations?\//i.test(path) || /\.sql$/i.test(path)) return "configuration";
  if (/\.(?:test|spec|e2e-spec)\.[mc]?[jt]sx?$/i.test(path) || /(?:^|\/)tests?\//i.test(path)) return "test";
  if (/\.(?:graphql|gql)$|(?:^|\/)(?:dto|contracts?|types?|schemas?|view-models?)(?:\/|\.)/i.test(path)) return "contract";
  if (/\.md$/i.test(path)) return "documentation";
  return "source";
}

function imports(content: string): string[] {
  const values = new Set<string>();
  const pattern = /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+|require\s*\()\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) if (match[1]) values.add(match[1]);
  return [...values].sort();
}

function resolveInternalImport(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const sourceBase = base.replace(/\.(?:mjs|cjs|jsx?|mts|cts)$/i, "");
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].flatMap((extension) => [
      `${base}${extension}`,
      `${sourceBase}${extension}`,
    ]),
    ...[".ts", ".tsx", ".js", ".jsx"].flatMap((extension) => [
      `${base}/index${extension}`,
      `${sourceBase}/index${extension}`,
    ]),
  ];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

function maxRisk(left: RiskClass, right: RiskClass): RiskClass {
  const rank: Record<RiskClass, number> = { trivial: 0, normal: 1, "high-risk": 2, critical: 3 };
  return rank[left] >= rank[right] ? left : right;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function pathHasExactTerm(path: string, terms: readonly string[]): boolean {
  const segments = normalizeText(path).split(/[\/._]+/).filter(Boolean);
  return terms.some((term) => segments.some((segment) =>
    segment === term || new RegExp(`^${term}-(?:view-model|input|resolver|repository|controller|service|type|schema)s?$`).test(segment),
  ));
}

function domainEntryDistance(path: string, terms: readonly string[]): number {
  const segments = normalizeText(path).split("/").filter(Boolean);
  const index = segments.findIndex((segment) => terms.some((term) => segment === term));
  return index < 0 ? Number.MAX_SAFE_INTEGER : segments.length - index - 1;
}

function revisionFor(
  inspection: ProjectInspectResult,
  plan: EngineeringPlan,
  specification: FeatureSpecification,
  artifact: ExplorationArtifact,
): EngineeringPlanRevision | null {
  if (artifact.status === "blocked" || artifact.affectedPaths.length === 0) return null;
  const affectedPaths = artifact.affectedPaths
    .filter((item) => item.confidence !== "supporting")
    .map((item) => item.path)
    .sort();
  if (affectedPaths.length === 0) return null;
  const classification = classifyTask({
    taskId: plan.id,
    title: plan.task.description,
    description: specification.description ?? specification.objective,
    type: plan.task.type,
    affectedPaths,
    targetScopes: plan.scope.targetScopes,
    signals: artifact.risk.findings.map((finding) => finding.signal),
  });
  const risk = maxRisk(plan.risk.class, classification.risk);
  const remainingUnknowns = artifact.unknowns.filter((unknown) => unknown.status === "remaining").map((unknown) => unknown.question);
  const explorationPath = `.azevedo/explorations/${artifact.id}.json`;
  const sourceArtifactIds = [
    `.azevedo/specifications/${specification.id}.json`,
    explorationPath,
  ];
  const planSnapshot = EngineeringPlanSchema.parse({
    ...plan,
    scope: { ...plan.scope, affectedPaths },
    risk: {
      class: risk,
      reasons: unique([
        ...plan.risk.reasons,
        ...classification.rationale,
        ...artifact.risk.findings.map((finding) => finding.reason),
      ]),
      signals: unique([...plan.risk.signals, ...classification.signals]),
    },
    understanding: {
      summary: `Evidence-backed exploration refined the implementation context for: ${plan.task.description}`,
      evidence: [...plan.understanding.evidence, {
        kind: "inspection" as const,
        source: explorationPath,
        statement: `Exploration ${artifact.id} identified ${affectedPaths.length} evidence-backed affected paths.`,
      }].sort((left, right) => `${left.source}:${left.statement}`.localeCompare(`${right.source}:${right.statement}`)),
      assumptions: unique([
        ...plan.understanding.assumptions,
        ...artifact.assumptions.map((assumption) => assumption.statement),
      ]),
      unknowns: remainingUnknowns,
    },
    verification: resolveVerificationPlan(inspection, classification),
    governance: {
      tdd: classification.tdd,
      architectReviewRequired: plan.governance.architectReviewRequired || classification.architectRequired,
      securityReviewRequired: plan.governance.securityReviewRequired || classification.securityReviewRequired,
    },
    decisions: {
      required: plan.decisions.required || classification.architectRequired || classification.securityReviewRequired,
      items: unique([
        ...plan.decisions.items,
        ...(classification.architectRequired ? ["Architecture review is required before implementation."] : []),
        ...(classification.securityReviewRequired ? ["Security review is required before completion."] : []),
      ]),
    },
  });
  return createEngineeringPlanRevision({
    planSnapshot,
    basis: {
      subjectRevision: artifact.sourceRevision,
      sourceArtifactIds,
      knowledgeUnitIds: artifact.contextManifest.selected.map((unit) => unit.id),
    },
    acceptanceCriteria: specification.acceptanceCriteria,
    changeSummary: [
      `Bounded exploration identified ${affectedPaths.length} affected paths with project-relative evidence.`,
      `Specification ${specification.id} remains the authority for supplied acceptance criteria.`,
      `Exploration stopped with ${artifact.stopReason}; ${remainingUnknowns.length} unknowns remain.`,
    ],
  });
}

export function exploreProject(
  projectRoot: string,
  rawInspection: ProjectInspectResult,
  rawPlan: EngineeringPlan,
  rawSpecification: FeatureSpecification,
  options: ExploreProjectOptions = {},
): ExploreProjectResult {
  const root = realpathSync(projectRoot);
  const inspection = rawInspection;
  const plan = EngineeringPlanSchema.parse(rawPlan);
  const specification = FeatureSpecificationSchema.parse(rawSpecification);
  if (plan.task.description !== specification.objective) {
    throw new Error("Specification objective must match the Engineering Plan task exactly.");
  }
  const maxFilesInspected = options.maxFilesInspected ?? 240;
  if (!Number.isInteger(maxFilesInspected) || maxFilesInspected < 10) throw new Error("Exploration budget must inspect at least 10 files.");

  const inventory = inventoryFiles(root);
  const knownPaths = new Set(inventory);
  const { seeds, expansions } = expandedTerms(specification);
  const allTerms = unique([...expansions.values()].flat());
  const requestedActionGroups = ACTION_TERM_GROUPS.filter((group) => group.some((term) => seeds.includes(term)));
  const requestedEntityGroups = ENTITY_TERM_GROUPS.filter((group) => group.some((term) => seeds.includes(term)));
  const domainTerms = unique(requestedEntityGroups.flat());
  const specificIntentTerms = unique([...expansions.entries()]
    .filter(([seed]) => !requestedEntityGroups.some((group) => group.includes(seed)))
    .flatMap(([, values]) => values)
    .filter((term) => !GENERIC_INTENT_TERMS.has(term)));
  const highSignalIntentTerms = specificIntentTerms.filter((term) => HIGH_SIGNAL_INTENT_TERMS.has(term));
  const ranked = inventory.map((path) => ({ path, score: pathScore(path, allTerms) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const selectedPaths = ranked.slice(0, maxFilesInspected).map((candidate) => candidate.path);
  const records = selectedPaths.flatMap((path): FileRecord[] => {
    const content = safeRead(root, path);
    if (content === null) return [];
    return [{ path, content, pathScore: pathScore(path, allTerms), contentScore: contentScore(content, allTerms) }];
  });
  const relevant = records.filter((record) => record.pathScore >= 4 || record.contentScore > 0);

  const evidence: ExplorationEvidence[] = relevant.map((record) => createEvidence(
    record,
    allTerms,
    evidenceKind(record.path),
    record.pathScore >= 4 ? "Repository path matches terminology derived from the specification." : "Repository content matches specification terminology.",
    `Supports exploration of ${specification.title}.`,
  ));
  const evidenceByPath = new Map(evidence.map((item) => [item.path, item]));

  const terminology = [...expansions.entries()].flatMap(([seed, values]) => {
    const matched = values.filter((term) => relevant.some((record) => normalizeText(`${record.path} ${record.content}`).includes(term)));
    const repositoryTerms = matched.filter((term) => term !== seed);
    const evidenceIds = unique(relevant.filter((record) => matched.some((term) => normalizeText(`${record.path} ${record.content}`).includes(term)))
      .map((record) => evidenceByPath.get(record.path)?.id).filter((id): id is string => Boolean(id))).slice(0, 12);
    return repositoryTerms.length > 0 && evidenceIds.length > 0
      ? [{ specificationTerm: seed, repositoryTerms, evidenceIds }]
      : [];
  }).sort((left, right) => left.specificationTerm.localeCompare(right.specificationTerm));

  const filterRequested = TERM_GROUPS[3]!.some((term) => seeds.includes(term));
  const statusRequested = TERM_GROUPS[5]!.some((term) => seeds.includes(term));
  const filterStatusPattern = domainTerms.length > 0
    ? new RegExp(`(?:${domainTerms.join("|")})\\.filter[\\s\\S]{0,320}(?:${domainTerms.join("|")})\\.status`, "i")
    : null;
  const actionMatch = (record: FileRecord): boolean => {
    const normalized = normalizeText(`${record.path} ${record.content}`);
    if (filterRequested && statusRequested && filterStatusPattern) return filterStatusPattern.test(normalized);
    if (requestedActionGroups.length > 0) return requestedActionGroups.every((group) => group.some((term) => normalized.includes(term)));
    const normalizedPath = normalizeText(record.path);
    const terms = highSignalIntentTerms.length > 0 ? highSignalIntentTerms : specificIntentTerms;
    const pathHits = terms.filter((term) => normalizedPath.includes(term)).length;
    const contentHits = terms.filter((term) => normalizeText(record.content).includes(term)).length;
    return pathHits >= 1 || contentHits >= (highSignalIntentTerms.length > 0 ? 2 : 3);
  };
  const domainPathMatch = (record: FileRecord): boolean => domainTerms.length === 0 || pathHasExactTerm(record.path, domainTerms);
  const domainEvidenceMatch = (record: FileRecord): boolean => domainTerms.length === 0 || domainPathMatch(record) ||
    domainTerms.some((term) => normalizeText(record.content).includes(term));
  const actionCoverage = relevant.some((record) =>
    !["documentation", "manifest", "configuration"].includes(evidenceKind(record.path)) &&
    domainEvidenceMatch(record) && actionMatch(record));

  const entryCandidates = relevant.flatMap((record) => {
    const kind = entryKind(record.path, record.content);
    const itemEvidence = evidenceByPath.get(record.path);
    return kind && itemEvidence && (domainTerms.length > 0 ? domainPathMatch(record) : actionMatch(record))
      ? [{ path: record.path, kind, symbol: itemEvidence.symbol, evidenceIds: [itemEvidence.id] }]
      : [];
  });
  const minimumEntryDistance = Math.min(...entryCandidates.map((entry) => domainEntryDistance(entry.path, domainTerms)));
  const entryPoints = entryCandidates
    .filter((entry) => domainTerms.length === 0 || domainEntryDistance(entry.path, domainTerms) === minimumEntryDistance)
    .sort((left, right) => left.path.localeCompare(right.path));

  const relevantPaths = new Set(relevant.map((record) => record.path));
  const flows: ExplorationArtifact["flows"] = [];
  const dependencies = new Map<string, { kind: "internal" | "external"; usedBy: Set<string>; evidenceIds: Set<string> }>();
  for (const record of relevant) {
    const fromEvidence = evidenceByPath.get(record.path);
    if (!fromEvidence) continue;
    for (const specifier of imports(record.content)) {
      const internal = resolveInternalImport(record.path, specifier, knownPaths);
      if (internal) {
        const dependency = dependencies.get(internal) ?? { kind: "internal" as const, usedBy: new Set(), evidenceIds: new Set() };
        dependency.usedBy.add(record.path);
        dependency.evidenceIds.add(fromEvidence.id);
        dependencies.set(internal, dependency);
        if (relevantPaths.has(internal)) flows.push({
          from: record.path,
          to: internal,
          relation: "imports",
          evidenceIds: unique([fromEvidence.id, evidenceByPath.get(internal)?.id].filter((id): id is string => Boolean(id))),
        });
      } else if (!specifier.startsWith(".")) {
        const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] ?? specifier;
        const dependency = dependencies.get(name) ?? { kind: "external" as const, usedBy: new Set(), evidenceIds: new Set() };
        dependency.usedBy.add(record.path);
        dependency.evidenceIds.add(fromEvidence.id);
        dependencies.set(name, dependency);
      }
    }
  }

  const testRecords = relevant.filter((record) => evidenceKind(record.path) === "test");
  const capability = inspection.capabilities.find((item) => item.id === "test");
  const tests: ExplorationArtifact["tests"] = testRecords.length > 0
    ? testRecords.map((record) => ({
      path: record.path,
      state: record.contentScore > 0 ? "direct" as const : "similar" as const,
      reason: record.contentScore > 0 ? "Test content matches the explored terminology." : "Test is adjacent to the explored implementation pattern.",
      evidenceIds: [evidenceByPath.get(record.path)!.id],
    }))
    : [{
      path: null,
      state: capability?.state === "detected" ? "capability-without-coverage" : "capability-unavailable",
      reason: capability?.state === "detected"
        ? "A test capability exists, but bounded exploration found no directly related test."
        : "Project inspection did not detect an executable test capability.",
      evidenceIds: [],
    }];

  const contracts = relevant.filter((record) => evidenceKind(record.path) === "contract" && (domainPathMatch(record) || actionMatch(record))).map((record) => {
    const consumerPaths = relevant.filter((candidate) => imports(candidate.content)
      .some((specifier) => resolveInternalImport(candidate.path, specifier, knownPaths) === record.path))
      .map((candidate) => candidate.path).sort();
    return {
      path: record.path,
      symbol: evidenceByPath.get(record.path)?.symbol ?? null,
      consumerPaths,
      evidenceIds: [evidenceByPath.get(record.path)!.id],
    };
  });

  const entryPathSet = new Set(entryPoints.map((entry) => entry.path));
  const connectedPaths = new Set(entryPathSet);
  let addedConnection = true;
  while (addedConnection) {
    addedConnection = false;
    for (const flow of flows) if (connectedPaths.has(flow.from) && !connectedPaths.has(flow.to)) {
      connectedPaths.add(flow.to);
      addedConnection = true;
    }
  }
  const behaviorPathPattern = /(?:^|[-_/])(?:archive|archiv|cancel|close|deactivat|delete|remove|update|filter|status|arquiv|fech|exclu|remov|atualiz|filtr)\w*/i;
  const similarImplementations = relevant.filter((record) =>
    evidenceKind(record.path) === "source" &&
    !entryPathSet.has(record.path) &&
    (requestedActionGroups.length > 0 || domainEvidenceMatch(record) || actionMatch(record)) &&
    (behaviorPathPattern.test(record.path) || (domainPathMatch(record) && /\.filter\s*\(/.test(record.content))),
  )
    .slice(0, 12).map((record) => ({
      path: record.path,
      similarity: domainPathMatch(record)
        ? "Uses a related behavior or state transition inside the same repository domain."
        : "Uses a related behavior or state transition in another repository domain.",
      reusablePattern: "Repository-local organization and dependency direction for state-changing behavior.",
      differences: [domainPathMatch(record)
        ? "The discovered behavior may use a different verb or lifecycle transition than the requested change."
        : "The discovered implementation belongs to another domain and cannot define this feature's business rules."],
      evidenceIds: [evidenceByPath.get(record.path)!.id],
    }));
  const supportingPaths = new Set([
    ...contracts.map((contract) => contract.path),
    ...testRecords.map((record) => record.path),
    ...similarImplementations.map((item) => item.path),
    ...flows.filter((flow) => entryPathSet.has(flow.from)).map((flow) => flow.to),
  ]);
  const affectedPathCandidates = relevant.flatMap((record) => {
    const kind = evidenceKind(record.path);
    const confidence: "confirmed" | "likely" | "supporting" = entryPathSet.has(record.path)
      ? "confirmed"
      : kind === "source" && actionMatch(record) && domainEvidenceMatch(record) ? "likely" : "supporting";
    if (confidence === "supporting" && !supportingPaths.has(record.path)) return [];
    return [{
      path: record.path,
      confidence,
      reason: confidence === "confirmed"
        ? "A task-related execution entry point was found."
        : confidence === "likely" ? "Source content and terminology indicate a likely implementation path."
          : "This artifact supports the explored flow, contract, test, or structure.",
      evidenceIds: [evidenceByPath.get(record.path)!.id],
    }];
  }).sort((left, right) => left.path.localeCompare(right.path));
  const affectedPaths = [
    ...affectedPathCandidates.filter((item) => item.confidence !== "supporting"),
    ...affectedPathCandidates.filter((item) => item.confidence === "supporting").slice(0, 24),
  ].sort((left, right) => left.path.localeCompare(right.path));

  const riskFindings: ExplorationArtifact["risk"]["findings"] = [];
  const substantivePathSet = new Set(affectedPaths.filter((item) => item.confidence !== "supporting").map((item) => item.path));
  const riskRecords = relevant.filter((record) => substantivePathSet.has(record.path) || connectedPaths.has(record.path));
  const addRisk = (signal: RiskSignal, pattern: RegExp, reason: string): void => {
    const ids = riskRecords.filter((record) => pattern.test(`${record.path}\n${record.content}`))
      .map((record) => evidenceByPath.get(record.path)?.id).filter((id): id is string => Boolean(id));
    if (ids.length > 0) riskFindings.push({ signal, reason, evidenceIds: unique(ids).slice(0, 20) });
  };
  addRisk("public_contract", /(?:controller|resolver|route|graphql|gql|endpoint)/i, "The explored scope includes a public request or schema boundary.");
  addRisk("persistence", /(?:repositories?|database|prisma|mongoose|drizzle|\.prisma)/i, "The explored scope reaches a persistence boundary.");
  addRisk("authorization", /(?:authorization|permission|permissions|guard|policy|ability)/i, "The explored scope contains authorization controls or policy checks.");
  addRisk("auth", /(?:authentication|auth-guard|jwt|session)/i, "The explored scope contains an authentication boundary.");
  addRisk("credentials", /(?:api[-_ ]?key|credentials?|secrets?|token provider)/i, "The explored scope references credentials or provider secrets.");
  addRisk("pii", /(?:personally identifiable|\bpii\b|cpf|email|phone|telefone|endereco|address)/i, "The explored scope references potentially identifying personal data.");
  addRisk("integration", /(?:integration|provider|third[- ]party|external service)/i, "The explored scope crosses an integration boundary.");
  addRisk("filesystem", /(?:node:fs|from [\"']fs[\"']|filesystem|readFile|writeFile)/i, "The explored scope accesses a filesystem boundary.");
  addRisk("external_input", /(?:request|input|payload|body|query|params)/i, "The explored scope processes input arriving through a request or handler boundary.");
  addRisk("file_upload", /(?:upload|multipart|file input)/i, "The explored scope handles uploaded files.");
  addRisk("external_url", /(?:external url|remote url|fetch\s*\(|axios|https?:\/\/)/i, "The explored scope references a remote URL or outbound request.");
  addRisk("webhook", /(?:webhook|callback endpoint)/i, "The explored scope contains a webhook or callback boundary.");
  addRisk("serialization", /(?:serialize|deserialize|JSON\.parse|JSON\.stringify)/i, "The explored scope serializes or deserializes data.");
  addRisk("sensitive_logging", /(?:logger|console\.)[\s\S]{0,120}(?:token|secret|password|cpf|email)/i, "The explored scope may log sensitive values.");
  addRisk("data_exposure", /(?:public response|expose|select:[\s\S]{0,160}(?:password|token|secret))/i, "The explored scope may expose protected data.");

  const classification = classifyTask({
    taskId: plan.id,
    title: plan.task.description,
    description: specification.description ?? specification.objective,
    type: plan.task.type,
    affectedPaths: affectedPaths.filter((item) => item.confidence !== "supporting").map((item) => item.path),
    targetScopes: plan.scope.targetScopes,
    signals: riskFindings.map((finding) => finding.signal),
  });
  const riskClass = maxRisk(plan.risk.class, classification.risk);
  const evidenceIds = evidence.map((item) => item.id);
  const resolvedPathEvidence = affectedPaths.filter((item) => item.confidence !== "supporting")
    .flatMap((item) => item.evidenceIds).slice(0, 20);
  const unknowns: ExplorationArtifact["unknowns"] = plan.understanding.unknowns.map((question) => {
    const implementationUnknown = /implementation files|package scope/i.test(question);
    if (implementationUnknown && resolvedPathEvidence.length > 0 && actionCoverage) return {
      question,
      status: "resolved" as const,
      resolution: "Repository exploration identified evidence-backed implementation paths.",
      evidenceIds: unique(resolvedPathEvidence),
    };
    return {
      question,
      status: "remaining" as const,
      resolution: implementationUnknown && !actionCoverage
        ? "No repository evidence of the requested behavior was found; entry and comparable patterns are context, not proof of the final implementation scope."
        : "Bounded exploration did not establish this fact.",
      evidenceIds: [],
    };
  });
  for (const question of specification.openQuestions) unknowns.push({
    question,
    status: "remaining",
    resolution: "The specification explicitly leaves this question open; repository behavior cannot decide product intent.",
    evidenceIds: [],
  });
  for (const contract of contracts.filter((item) => item.consumerPaths.length === 0)) unknowns.push({
    question: `Which internal or external consumer uses contract ${contract.path}?`,
    status: "remaining",
    resolution: "Bounded import tracing found no repository consumer; external consumers remain outside the inspected scope.",
    evidenceIds: [],
  });

  const acceptanceCoverage = specification.acceptanceCriteria.map((criterion) => {
    const criterionTerms = tokens(`${criterion.statement} ${criterion.scenario.given} ${criterion.scenario.when} ${criterion.scenario.then}`);
    const minimumMatches = Math.max(2, Math.ceil(criterionTerms.length * 0.25));
    const matching = relevant
      .filter((record) => !["documentation", "manifest"].includes(evidenceKind(record.path)))
      .map((record) => ({
        record,
        score: criterionTerms.filter((term) => normalizeText(record.content).includes(term)).length,
      }))
      .filter((candidate) => candidate.score >= minimumMatches)
      .sort((left, right) => right.score - left.score || left.record.path.localeCompare(right.record.path))
      .slice(0, 8)
      .map((candidate) => evidenceByPath.get(candidate.record.path)?.id)
      .filter((id): id is string => Boolean(id));
    return {
      criterionId: criterion.id,
      source: "specification" as const,
      status: matching.length > 1 ? "evidence-found" as const : matching.length === 1 ? "partial" as const : "not-found" as const,
      evidenceIds: unique(matching),
      note: matching.length > 0
        ? "Repository evidence relates to this supplied criterion; it does not redefine the criterion."
        : "No evidence for this supplied criterion was found within the exploration budget.",
    };
  });

  const exhausted = ranked.length > selectedPaths.length;
  const substantivePaths = affectedPaths.filter((item) => item.confidence !== "supporting");
  let status: ExplorationArtifact["status"];
  let stopReason: ExplorationArtifact["stopReason"];
  if (substantivePaths.length === 0) {
    status = "blocked";
    stopReason = inventory.length === 0 ? "blocked-by-missing-context" : "blocked-by-ambiguity";
  } else if (!actionCoverage) {
    status = "partial";
    stopReason = "scope-boundary";
  } else if (exhausted) {
    status = "partial";
    stopReason = "budget-exhausted";
  } else if (entryPoints.length === 0) {
    status = "partial";
    stopReason = "scope-boundary";
  } else {
    status = "ready";
    stopReason = "sufficient-evidence";
  }

  const contextManifest = resolveContextManifest(KNOWLEDGE_CATALOG, {
    phase: "research",
    taskType: plan.task.type,
    riskClass,
    signals: unique([...plan.risk.signals, ...riskFindings.map((finding) => finding.signal)]),
    technologies: inspection.technologies.map((technology) => technology.id),
    capabilities: inspection.capabilities.filter((item) => item.state === "detected" || item.state === "configured")
      .map((item) => item.id),
    affectedPaths: affectedPaths.map((item) => item.path),
  });
  const sourceRevision = captureSubjectRevision(root);
  const contentForId = {
    planId: plan.id,
    specificationId: specification.id,
    sourceRevision,
    evidenceIds,
    stopReason,
  };
  const id = `exploration-${createHash("sha256").update(JSON.stringify(contentForId)).digest("hex").slice(0, 12)}`;
  const artifact = ExplorationArtifactSchema.parse({
    schemaVersion: 1,
    kind: "exploration-artifact",
    id,
    planId: plan.id,
    specificationId: specification.id,
    project: {
      root: ".",
      topology: plan.project.topology,
      technologies: [...plan.project.technologies].sort(),
      packages: [...inspection.packages].sort(),
    },
    contextManifest,
    budget: {
      maxFilesInspected,
      filesInventoried: inventory.length,
      filesInspected: selectedPaths.length,
      exhausted,
    },
    terminology,
    evidence,
    entryPoints,
    flows: flows.sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`)),
    similarImplementations,
    affectedPaths,
    contracts,
    tests,
    dependencies: [...dependencies.entries()].map(([name, dependency]) => ({
      name,
      kind: dependency.kind,
      usedBy: [...dependency.usedBy].sort(),
      evidenceIds: [...dependency.evidenceIds].sort(),
    })).sort((left, right) => left.name.localeCompare(right.name)),
    risk: { class: riskClass, findings: riskFindings },
    unknowns,
    assumptions: plan.understanding.assumptions.map((statement) => ({ statement, basis: "plan" as const })),
    hypotheses: [],
    acceptanceCoverage,
    stopReason,
    status,
    sourceRevision,
  });
  return { artifact, revision: revisionFor(inspection, plan, specification, artifact) };
}
