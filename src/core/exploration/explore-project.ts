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
type FileRecord = {
  path: string;
  content: string;
  pathScore: number;
  contentScore: number;
  capabilityScore: number;
};

type CapabilityDescriptor = {
  id: string;
  description: string;
  requirement: RegExp;
  path: RegExp;
  role: string;
};

const CAPABILITY_DESCRIPTORS: readonly CapabilityDescriptor[] = [
  {
    id: "persistence",
    description: "Domain state, identifiers, lifecycle transitions, repositories, and durable records.",
    requirement: /persist|banco|database|schema|repository|repositorio|registro|identificador|estado|status|codigo|código|colis|retirad|cancelad|derivad/i,
    path: /(?:^|\/)(?:repositories?|database|prisma|migrations?)(?=$|[\/._-])|(?:^|\/)(?:application|domain)\/(?:entities?|models?)(?=$|\/)|schema\.prisma$/i,
    role: "persistence or domain-model pattern",
  },
  {
    id: "api-boundary",
    description: "Public controller, resolver, route, DTO, schema, or view-model boundary.",
    requirement: /\bapi\b|backend|endpoint|resolver|controller|route|dto|contrato|contract|entrada|saída|input|output/i,
    path: /(?:^|\/)(?:controllers?|resolvers?|routes?|dtos?|schemas?|view-models?)(?=$|[\/._-])|\.(?:graphql|gql)$/i,
    role: "public contract or transport boundary",
  },
  {
    id: "address-data",
    description: "Existing condominium, block, unit, address, and resident data.",
    requirement: /condom[ií]nio|condominium|bloco|block|unidade|unit|unity|endere[cç]o|address|morador|resident/i,
    path: /(?:^|[\/._-])(?:condo|condominium|blocks?|units?|unities|address|resident)(?=$|[\/._-])/i,
    role: "existing condominium address-data capability",
  },
  {
    id: "identity-authorization",
    description: "Current-user context, authorization, permission, guard, policy, or capability checks.",
    requirement: /usu[aá]rio|user|autoriza|permission|permiss[aã]o|capabilit|guard|policy|perfil|profile/i,
    path: /(?:^|[\/._-])(?:auth|authorization|permissions?|guards?|polic(?:y|ies)|abilities|person-context|current-user|profiles?|features?[-_]?slugs?)(?=$|[\/._-])/i,
    role: "identity or authorization pattern",
  },
  {
    id: "file-storage",
    description: "File selection, upload, image handling, attachments, and durable storage.",
    requirement: /foto|photo|imagem|image|c[aâ]mera|camera|upload|storage|arquivo|file|anexo|attachment/i,
    path: /(?:^|[\/._-])(?:uploads?|storage|files?|images?|photos?|camera|attachments?|anexos?|s3|bucket)(?=$|[\/._-])/i,
    role: "file upload or storage capability",
  },
  {
    id: "email-delivery",
    description: "Outbound e-mail, notification delivery, provider result, and retry behavior.",
    requirement: /e-?mail|notifica|comunica|delivery|entregue|provider|retry|destinat[aá]rio|recipient/i,
    path: /(?:^|[\/._-])(?:mail|email|notifications?|delivery|retry|messages?)(?=$|[\/._-])/i,
    role: "outbound communication capability",
  },
  {
    id: "audit-history",
    description: "Event, audit, history, logging, and traceability patterns.",
    requirement: /auditor|hist[oó]r|evento|event|rastre|trilha|log|timeline|passado/i,
    path: /(?:^|[\/._-])(?:audit|history|events?|logs?|timeline|tracking)(?=$|[\/._-])/i,
    role: "audit or append-only history pattern",
  },
  {
    id: "query-listing",
    description: "Operational listing, search, filtering, ordering, and pagination.",
    requirement: /list|consulta|pesquis|busca|search|filtro|filter|pagina|query|orden|prioriza/i,
    path: /(?:^|[\/._-])(?:list|listing|search|filters?|queries|query|pagination|tables?|grids?)(?=$|[\/._-])/i,
    role: "listing or query interaction pattern",
  },
  {
    id: "web-ui",
    description: "Web page, mobile-first form, modal, component, and user interaction patterns.",
    requirement: /mobile|web|interface|tela|formul[aá]rio|form|modal|componente|component|next\.js|toque|browser/i,
    path: /(?:^|\/)(?:app|pages?|components?|forms?|modals?)(?=\/|$)|(?:^|\/)page\.[mc]?[jt]sx?$/i,
    role: "web interaction or form pattern",
  },
];

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
    + (isStructuralFile(path) ? 1 : 0)
    + (/\.(?:test|spec|e2e-spec)\.[mc]?[jt]sx?$/i.test(path) ? 1 : 0);
}

function capabilityPathScore(path: string, capabilities: readonly CapabilityDescriptor[]): number {
  return capabilities.reduce((score, capability) => score + capabilityEvidenceScore(capability, path), 0);
}

function isStructuralFile(path: string): boolean {
  const basename = posix.basename(path);
  return STRUCTURAL_FILES.has(basename) ||
    /(?:^|\/)(?:[^/]+\.)?module\.[mc]?[jt]s$/i.test(path) ||
    /(?:^|\/)codegen\.[mc]?[jt]s$/i.test(path);
}

function capabilityEvidenceScore(capability: CapabilityDescriptor, path: string): number {
  const normalized = normalizeText(path);
  let score = capability.path.test(path) ? 1 : 0;
  if (capability.id === "web-ui" && /(?:^|[\/._-])(?:form|modal|page)(?:s)?(?=$|[\/._-])/.test(normalized)) score += 8;
  if (capability.id === "persistence" && /(?:repositories?|database|prisma|migrations?|schema\.prisma)/.test(normalized)) score += 8;
  if (capability.id === "api-boundary" && /(?:resolvers?|controllers?|routes?|dtos?|\.graphql$|\.gql$)/.test(normalized)) score += 8;
  if (capability.id === "address-data" && /(?:blocks?|units?|unities|address|resident)/.test(normalized)) score += 8;
  if (capability.id === "identity-authorization" && /features?[-_]?slugs?/.test(normalized)) score += 16;
  else if (capability.id === "identity-authorization" && /(?:auth|permissions?|guards?|polic(?:y|ies)|abilities|current-user)/.test(normalized)) score += 8;
  if (capability.id === "email-delivery" && /(?:mail|email|delivery|retry)/.test(normalized)) score += 12;
  else if (capability.id === "email-delivery" && /notifications?/.test(normalized)) score += 2;
  if (capability.id === "file-storage" && /(?:upload|storage|files?|images?|photos?|attachments?)/.test(normalized)) score += 8;
  if (capability.id === "audit-history" && /(?:audit|history|events?|logs?|timeline)/.test(normalized)) score += 8;
  if (capability.id === "query-listing" && /(?:list|search|filters?|queries|pagination)/.test(normalized)) score += 8;
  return score;
}

function hasCapabilityEvidence(capability: CapabilityDescriptor, record: FileRecord): boolean {
  if (!capability.path.test(record.path)) return false;
  const path = normalizeText(record.path);
  const content = normalizeText(record.content);
  switch (capability.id) {
    case "persistence":
      return /(?:schema\.prisma|migrations?\/|\.sql$)/.test(path) ||
        /(?:repositories?|database|prisma|drizzle|mongoose)/.test(path) &&
          /(?:repository|prisma|drizzle|mongoose|findmany|findunique|create|save|update|model\s)/.test(content) ||
        /(?:application|domain)\/(?:entities?|models?)\//.test(path) && /(?:class|interface|type|aggregate|entity)/.test(content);
    case "api-boundary":
      return /\.(?:graphql|gql)$/.test(path) && /\b(?:query|mutation|fragment)\b/.test(content) ||
        /(?:controllers?|resolvers?|routes?|dtos?|view-models?)(?:\/|[._-])/.test(path) &&
          /(?:@controller|@resolver|@query|@mutation|@inputtype|@objecttype|class|interface|type)/.test(content);
    case "address-data":
      return /(?:^|[\/._-])(?:blocks?|units?|unities|address|resident)(?=$|[\/._-])/.test(path) &&
        /(?:condo|condominium|block|unit|unity|address|resident)/.test(content);
    case "identity-authorization":
      return /(?:auth|permissions?|guards?|polic(?:y|ies)|abilities|current-user|features?[-_]?slugs?)/.test(path) &&
        /(?:permission|authorize|authorization|guard|policy|ability|currentuser|current-user|feature.*slug|auth)/.test(content);
    case "file-storage":
      return /(?:upload|storage|files?|images?|photos?|camera|attachments?|s3|bucket)/.test(path) &&
        /(?:upload|storage|file|image|photo|camera|attachment|s3|bucket)/.test(content);
    case "email-delivery":
      return /(?:mail|email|delivery|retry)/.test(path) &&
        /(?:send|recipient|subject|mailer|nodemailer|email|delivery|retry)/.test(content);
    case "audit-history":
      return /(?:audit|history|events?|logs?|timeline|tracking)/.test(path) &&
        /(?:audit|history|event|log|timeline|tracking|created_at|updated_at)/.test(content);
    case "query-listing":
      return /(?:list|search|filters?|queries|query|pagination|tables?|grids?)/.test(path) &&
        /(?:query|findmany|filter|search|pagination|table|list)/.test(content);
    case "web-ui":
      return /(?:^|\/)(?:app|pages?|components?|forms?|modals?)(?:\/|$)/.test(path) &&
        /(?:jsx|tsx|react|function|=>|return\s*\(|<form|<div)/.test(`${path}\n${content}`);
    default:
      return false;
  }
}

function criteriaForCapability(
  specification: FeatureSpecification,
  capability: CapabilityDescriptor,
): string[] {
  const matched = specification.acceptanceCriteria.filter((criterion) => capability.requirement.test([
    criterion.statement,
    criterion.scenario.given,
    criterion.scenario.when,
    criterion.scenario.then,
    ...criterion.prohibitedEffects,
  ].join(" "))).map((criterion) => criterion.id);
  return matched;
}

function capabilityDescriptors(specification: FeatureSpecification): CapabilityDescriptor[] {
  const text = sourceText(specification);
  return CAPABILITY_DESCRIPTORS.filter((capability) => capability.requirement.test(text));
}

function pathRegion(path: string): string {
  const segments = path.split("/");
  if (segments[0] !== "src") return segments[0] ?? path;
  if (segments[1] === "app" && segments.length >= 3) return segments.slice(0, 3).join("/");
  return segments.slice(0, Math.min(4, segments.length - 1)).join("/") || path;
}

function representativeCapabilityRecords(records: readonly FileRecord[], limit: number): FileRecord[] {
  const selected: FileRecord[] = [];
  const regions = new Set<string>();
  for (const record of records.filter((item) => isStructuralFile(item.path))) {
    selected.push(record);
    regions.add(pathRegion(record.path));
    if (selected.length === limit) return selected;
  }
  for (const record of records) {
    const region = pathRegion(record.path);
    if (regions.has(region)) continue;
    selected.push(record);
    regions.add(region);
    if (selected.length === limit) return selected;
  }
  for (const record of records) {
    if (selected.includes(record)) continue;
    selected.push(record);
    if (selected.length === limit) break;
  }
  return selected;
}

function representativeCapabilityPaths(
  paths: readonly string[],
  capability: CapabilityDescriptor,
  limit: number,
): string[] {
  const ranked = [...paths].sort((left, right) =>
    capabilityEvidenceScore(capability, right) - capabilityEvidenceScore(capability, left) || left.localeCompare(right));
  const selected: string[] = [];
  const regions = new Set<string>();
  for (const path of ranked) {
    const region = pathRegion(path);
    if (regions.has(region)) continue;
    selected.push(path);
    regions.add(region);
    if (selected.length === limit) return selected;
  }
  for (const path of ranked) {
    if (selected.includes(path)) continue;
    selected.push(path);
    if (selected.length === limit) break;
  }
  return selected;
}

function proposedBoundary(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  if (/^prisma\/migrations\/[^/]+\//.test(normalized)) return "prisma/migrations";
  if (normalized === "prisma/schema.prisma") return normalized;
  if (/(?:^|\/)(?:[^/]+\.)?module\.[mc]?[jt]s$/i.test(normalized)) return normalized;
  if (/(?:^|\/)(?:features?|permissions?|capabilit(?:y|ies))[-_]?(?:slugs?|types?|registry)\.[mc]?[jt]s$/i.test(normalized)) return normalized;
  if (/^src\/graphql\/generated\.[mc]?[jt]sx?$/i.test(normalized)) return normalized;
  const knownBoundaries = [
    "src/application/entities",
    "src/application/repositories",
    "src/application/services",
    "src/application/use-cases",
    "src/infra/database/mappers",
    "src/infra/database/repositories",
    "src/infra/http/dtos",
    "src/infra/http/resolvers",
    "src/infra/http/view-models",
    "src/infra/mail",
    "src/infra/storage",
    "src/mail",
    "src/graphql/mutations",
    "src/graphql/queries",
    "src/app/(app)",
    "src/components",
  ];
  return knownBoundaries.find((boundary) => normalized === boundary || normalized.startsWith(`${boundary}/`))
    ?? null;
}

function isCompositionRoot(record: FileRecord): boolean {
  return /(?:^|\/)(?:[^/]+\.)?module\.[mc]?[jt]s$/i.test(record.path) &&
    /@Module\s*\(/.test(record.content) && /\b(?:providers|controllers|imports|exports)\s*:/.test(record.content);
}

function generatedOutputs(record: FileRecord, knownPaths: ReadonlySet<string>): string[] {
  if (!/(?:^|\/)codegen\.[mc]?[jt]s$/i.test(record.path) || !/\bgenerates\s*:/.test(record.content)) return [];
  return unique([...record.content.matchAll(/["']([^"']+\.[mc]?[jt]sx?)["']\s*:/g)]
    .map((match) => match[1]!.replace(/^\.\//, ""))
    .filter((path) => knownPaths.has(path)));
}

function surfaceId(capability: string, candidatePaths: readonly string[], criterionIds: readonly string[]): string {
  const slug = capability.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const digest = createHash("sha256").update(JSON.stringify({ capability, candidatePaths, criterionIds })).digest("hex").slice(0, 8);
  return `surface-${slug}-${digest}`;
}

function deriveGreenfieldScope(
  surfaces: ExplorationArtifact["integrationSurfaces"],
): ExplorationArtifact["affectedPaths"] {
  const byBoundary = new Map<string, {
    capabilities: Set<string>;
    acceptanceCriterionIds: Set<string>;
    evidenceIds: Set<string>;
  }>();
  for (const surface of surfaces) {
    for (const candidate of surface.candidatePaths) {
      const boundary = proposedBoundary(candidate.path);
      if (boundary === null) continue;
      const accumulated = byBoundary.get(boundary) ?? {
        capabilities: new Set<string>(),
        acceptanceCriterionIds: new Set<string>(),
        evidenceIds: new Set<string>(),
      };
      accumulated.capabilities.add(surface.capability);
      surface.acceptanceCriterionIds.forEach((id) => accumulated.acceptanceCriterionIds.add(id));
      candidate.evidenceIds.forEach((id) => accumulated.evidenceIds.add(id));
      byBoundary.set(boundary, accumulated);
    }
  }
  return [...byBoundary.entries()].map(([path, accumulated]) => ({
    path,
    confidence: "likely" as const,
    kind: "proposed" as const,
    basis: "architectural-pattern" as const,
    acceptanceCriterionIds: [...accumulated.acceptanceCriterionIds].sort(),
    reason: `Proposed greenfield artifact boundary for ${[...accumulated.capabilities].sort().join(", ")}, derived from existing repository structure rather than lexical similarity.`,
    evidenceIds: [...accumulated.evidenceIds].sort(),
  })).sort((left, right) => left.path.localeCompare(right.path)).slice(0, 16);
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
  if (/(?:^|\/)schema\.prisma$|(?:^|\/)drizzle\.config\.[mc]?[jt]s$/i.test(path)) return "configuration";
  if (isStructuralFile(path)) return "manifest";
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

function explicitlyRequiredVerificationCapabilities(specification: FeatureSpecification): Set<"lint" | "typecheck" | "test" | "build"> {
  const authoritativeText = [
    ...specification.constraints,
    ...specification.businessRules,
    ...specification.decisions,
    ...specification.acceptanceCriteria.flatMap((criterion) => [
      criterion.statement,
      criterion.scenario.given,
      criterion.scenario.when,
      criterion.scenario.then,
      ...criterion.prohibitedEffects,
    ]),
  ].join(" ");
  const required = new Set<"lint" | "typecheck" | "test" | "build">();
  const obligation = "(?:must|shall|required|mandatory|obrigat[oó]ri[oa]|exige|deve ser)";
  const patterns: Array<["lint" | "typecheck" | "test" | "build", string]> = [
    ["lint", "(?:lint|eslint)"],
    ["typecheck", "(?:typecheck|type check|checagem de tipos|verifica[cç][aã]o de tipos)"],
    ["test", "(?:automated test|teste automatizado|test suite|su[ií]te de testes)"],
    ["build", "(?:production build|build de produ[cç][aã]o|compila[cç][aã]o de produ[cç][aã]o)"],
  ];
  for (const [capability, expression] of patterns) {
    if (new RegExp(`${obligation}[\\s\\S]{0,48}${expression}|${expression}[\\s\\S]{0,48}${obligation}`, "i").test(authoritativeText)) {
      required.add(capability);
    }
  }
  return required;
}

function revisionFor(
  inspection: ProjectInspectResult,
  plan: EngineeringPlan,
  specification: FeatureSpecification,
  artifact: ExplorationArtifact,
): EngineeringPlanRevision {
  const affectedPaths = artifact.affectedPaths
    .filter((item) => item.confidence !== "supporting")
    .map((item) => item.path)
    .sort();
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
    verification: resolveVerificationPlan(inspection, classification, {
      mandatoryCapabilities: explicitlyRequiredVerificationCapabilities(specification),
    }),
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
      `Bounded exploration identified ${affectedPaths.length} affected paths with project-relative evidence; status is ${artifact.status}.`,
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
  const capabilities = capabilityDescriptors(specification);
  const genericFeatureTerms = new Set([...GENERIC_INTENT_TERMS, "controle", "control", "completo", "conforme", "specification", "produto"]);
  const featureTerms = unique(tokens(specification.title).flatMap((term) => expansions.get(term) ?? [term])
    .filter((term) => term.length >= 4 && !genericFeatureTerms.has(term)));

  const rankedInventory = inventory.map((path) => ({
    path,
    lexical: pathScore(path, allTerms),
    capability: capabilityPathScore(path, capabilities),
    structural: isStructuralFile(path) ? 1 : 0,
  })).sort((left, right) =>
    (right.capability * 8 + right.lexical + right.structural * 4) -
      (left.capability * 8 + left.lexical + left.structural * 4) || left.path.localeCompare(right.path),
  );
  const passOneAllowance = Math.min(maxFilesInspected, Math.max(10, Math.floor(maxFilesInspected * 0.25)));
  const structuralPaths = rankedInventory.filter((item) => item.structural > 0).map((item) => item.path);
  const perCapabilityAllowance = Math.max(2, Math.floor(
    Math.max(0, passOneAllowance - Math.min(structuralPaths.length, Math.floor(passOneAllowance / 3))) /
      Math.max(1, capabilities.length),
  ));
  const capabilityBalancedPaths = capabilities.flatMap((capability) => representativeCapabilityPaths(
    inventory.filter((path) => capability.path.test(path)), capability, perCapabilityAllowance,
  ));
  const passOnePaths = unique([
    ...structuralPaths,
    ...capabilityBalancedPaths,
    ...rankedInventory.filter((item) => item.capability > 0 || item.lexical > 0 || item.structural > 0)
      .map((item) => item.path),
  ]).slice(0, passOneAllowance);
  const readRecords = (paths: readonly string[]): FileRecord[] => paths.flatMap((path): FileRecord[] => {
    const content = safeRead(root, path);
    if (content === null) return [];
    return [{
      path,
      content,
      pathScore: pathScore(path, allTerms),
      contentScore: contentScore(content, allTerms),
      capabilityScore: capabilityPathScore(path, capabilities),
    }];
  });
  const passOneRecords = readRecords(passOnePaths);
  const prioritizedRegions = unique(passOneRecords.filter((record) =>
    record.capabilityScore > 0 || pathHasExactTerm(record.path, featureTerms),
  ).map((record) => pathRegion(record.path))).slice(0, 16).sort();
  const selected = new Set(passOnePaths);
  const remainingAfterOne = rankedInventory.filter((item) => !selected.has(item.path)).map((item) => ({
    ...item,
    region: prioritizedRegions.some((region) => item.path === region || item.path.startsWith(`${region}/`)) ? 6 : 0,
  })).sort((left, right) =>
    (right.region + right.capability * 8 + right.lexical) - (left.region + left.capability * 8 + left.lexical) ||
      left.path.localeCompare(right.path),
  );
  const passTwoAllowance = Math.min(maxFilesInspected - selected.size, Math.floor(maxFilesInspected * 0.55));
  const passTwoPaths = remainingAfterOne.filter((item) => item.region > 0 || item.capability > 0 || item.lexical > 0)
    .slice(0, passTwoAllowance).map((item) => item.path);
  passTwoPaths.forEach((path) => selected.add(path));
  const firstTwoRecords = [...passOneRecords, ...readRecords(passTwoPaths)];
  const importedTargets = unique(firstTwoRecords.flatMap((record) => imports(record.content)
    .map((specifier) => resolveInternalImport(record.path, specifier, knownPaths))
    .filter((path): path is string => Boolean(path) && !selected.has(path!))));
  const remainingAfterTwo = rankedInventory.filter((item) => !selected.has(item.path));
  const passThreeAllowance = Math.max(0, maxFilesInspected - selected.size);
  const passThreePaths = unique([
    ...importedTargets,
    ...remainingAfterTwo.filter((item) => item.capability > 0 || item.lexical > 0).map((item) => item.path),
  ]).slice(0, passThreeAllowance);
  passThreePaths.forEach((path) => selected.add(path));
  const selectedPaths = [...selected];
  const records = [...firstTwoRecords, ...readRecords(passThreePaths)];
  const relevant = records.filter((record) =>
    record.pathScore > 0 || record.contentScore > 0 || record.capabilityScore > 0 || isStructuralFile(record.path),
  );
  const prioritizedCandidateCount = rankedInventory.filter((item) => item.capability > 0 || item.lexical > 0 || item.structural > 0).length;
  const exhausted = selectedPaths.length === maxFilesInspected && prioritizedCandidateCount > selectedPaths.length;

  const directFeatureMatch = (record: FileRecord): boolean => {
    if (featureTerms.length === 0) return false;
    if (pathHasExactTerm(record.path, featureTerms)) return true;
    const symbol = firstSymbol(record.content);
    return Boolean(symbol && featureTerms.some((term) => normalizeText(symbol).includes(term)));
  };
  const evidence: ExplorationEvidence[] = relevant.map((record) => {
    const direct = directFeatureMatch(record);
    const capability = capabilities.find((item) => hasCapabilityEvidence(item, record));
    const structural = isCompositionRoot(record) || generatedOutputs(record, knownPaths).length > 0;
    return createEvidence(
      record,
      direct ? featureTerms : allTerms,
      evidenceKind(record.path),
      direct
        ? "Repository path or symbol directly matches the feature domain."
        : capability ? `Repository structure implements the ${capability.id} capability required by the specification.`
          : structural ? "Repository configuration declares a composition or generated-contract boundary."
          : "Lexical correspondence produced a candidate that requires structural corroboration.",
      direct ? `Direct domain evidence for ${specification.title}.`
        : capability ? `Architectural capability evidence for ${specification.title}.`
          : structural ? `Architectural integration evidence for ${specification.title}.`
          : `Candidate evidence for ${specification.title}.`,
    );
  });
  const evidenceByPath = new Map(evidence.map((item) => [item.path, item]));

  const terminology = [...expansions.entries()].flatMap(([seed, values]) => {
    const matched = values.filter((term) => relevant.some((record) => normalizeText(`${record.path} ${record.content}`).includes(term)));
    const repositoryTerms = matched.filter((term) => term !== seed);
    const evidenceIds = unique(relevant.filter((record) => matched.some((term) => normalizeText(`${record.path} ${record.content}`).includes(term)))
      .map((record) => evidenceByPath.get(record.path)?.id).filter((id): id is string => Boolean(id))).slice(0, 12);
    return repositoryTerms.length > 0 && evidenceIds.length > 0 ? [{ specificationTerm: seed, repositoryTerms, evidenceIds }] : [];
  }).sort((left, right) => left.specificationTerm.localeCompare(right.specificationTerm));

  const directRecords = relevant.filter((record) =>
    !["documentation", "manifest", "configuration", "test"].includes(evidenceKind(record.path)) && directFeatureMatch(record),
  );
  const entryPoints = directRecords.flatMap((record) => {
    const kind = entryKind(record.path, record.content);
    const itemEvidence = evidenceByPath.get(record.path);
    return kind && itemEvidence ? [{ path: record.path, kind, symbol: itemEvidence.symbol, evidenceIds: [itemEvidence.id] }] : [];
  }).sort((left, right) => left.path.localeCompare(right.path));

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
        if (relevantPaths.has(internal) && evidenceByPath.has(internal)) flows.push({
          from: record.path,
          to: internal,
          relation: "imports",
          evidenceIds: unique([fromEvidence.id, evidenceByPath.get(internal)!.id]),
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

  const baseIntegrationSurfaces: ExplorationArtifact["integrationSurfaces"] = capabilities.flatMap((capability) => {
    const rankedMatches = relevant.filter((record) =>
      !["documentation", "manifest", "test"].includes(evidenceKind(record.path)) && hasCapabilityEvidence(capability, record),
    ).sort((left, right) =>
      capabilityEvidenceScore(capability, right.path) - capabilityEvidenceScore(capability, left.path) ||
      (right.capabilityScore + right.pathScore) - (left.capabilityScore + left.pathScore) || left.path.localeCompare(right.path),
    );
    const matches = representativeCapabilityRecords(rankedMatches, 8);
    const candidatePaths = matches.flatMap((record) => {
      const itemEvidence = evidenceByPath.get(record.path);
      return itemEvidence ? [{ path: record.path, role: capability.role, evidenceIds: [itemEvidence.id] }] : [];
    });
    if (candidatePaths.length === 0) return [];
    const acceptanceCriterionIds = criteriaForCapability(specification, capability);
    if (acceptanceCriterionIds.length === 0) return [];
    const evidenceIds = unique(candidatePaths.flatMap((candidate) => candidate.evidenceIds));
    return [{
      id: surfaceId(capability.id, candidatePaths.map((candidate) => candidate.path), acceptanceCriterionIds),
      capability: capability.id,
      description: capability.description,
      basis: "acceptance-criterion-match" as const,
      candidatePaths,
      acceptanceCriterionIds,
      evidenceIds,
    }];
  });
  const surfaceByCandidatePath = new Map<string, Array<(typeof baseIntegrationSurfaces)[number]>>();
  for (const surface of baseIntegrationSurfaces) for (const candidate of surface.candidatePaths) {
    const values = surfaceByCandidatePath.get(candidate.path) ?? [];
    values.push(surface);
    surfaceByCandidatePath.set(candidate.path, values);
  }
  const compositionCandidates = relevant.filter(isCompositionRoot).flatMap((record) => {
    const itemEvidence = evidenceByPath.get(record.path);
    if (!itemEvidence) return [];
    const linkedTargets = imports(record.content).flatMap((specifier) => {
      const target = resolveInternalImport(record.path, specifier, knownPaths);
      return target && surfaceByCandidatePath.has(target) ? [target] : [];
    });
    const linkedSurfaces = unique(linkedTargets.flatMap((target) => surfaceByCandidatePath.get(target) ?? []));
    if (unique(linkedTargets).length < 2 || linkedSurfaces.length === 0) return [];
    return [{
      path: record.path,
      role: "composition root that explicitly registers capability implementations",
      evidenceIds: [itemEvidence.id],
      linkedSurfaces,
    }];
  });
  const compositionSurface: ExplorationArtifact["integrationSurfaces"] = compositionCandidates.length === 0 ? [] : [{
    id: surfaceId(
      "composition-root",
      compositionCandidates.map((candidate) => candidate.path),
      unique(compositionCandidates.flatMap((candidate) => candidate.linkedSurfaces.flatMap((surface) => surface.acceptanceCriterionIds))).sort(),
    ),
    capability: "composition-root",
    description: "Explicit project composition roots that must register new feature providers, repositories, handlers, or resolvers.",
    basis: "architectural-pattern",
    candidatePaths: compositionCandidates.map(({ path, role, evidenceIds }) => ({ path, role, evidenceIds })),
    acceptanceCriterionIds: unique(compositionCandidates.flatMap((candidate) =>
      candidate.linkedSurfaces.flatMap((surface) => surface.acceptanceCriterionIds))).sort(),
    evidenceIds: compositionCandidates.map((candidate) => candidate.evidenceIds[0]!),
  }];
  const generatedContractCandidates = relevant.flatMap((record) => {
    const itemEvidence = evidenceByPath.get(record.path);
    if (!itemEvidence) return [];
    return generatedOutputs(record, knownPaths).map((path) => ({
      path,
      role: "generated contract output declared by repository codegen configuration",
      evidenceIds: [itemEvidence.id],
    }));
  });
  const generatedContractSurface: ExplorationArtifact["integrationSurfaces"] = generatedContractCandidates.length === 0 ||
    !baseIntegrationSurfaces.some((surface) => surface.capability === "api-boundary") ? [] : [{
      id: surfaceId("generated-contracts", generatedContractCandidates.map((candidate) => candidate.path),
        specification.acceptanceCriteria.map((criterion) => criterion.id)),
      capability: "generated-contracts",
      description: "Generated client contracts that repository codegen updates from API operation documents.",
      basis: "architectural-pattern",
      candidatePaths: generatedContractCandidates,
      acceptanceCriterionIds: specification.acceptanceCriteria.map((criterion) => criterion.id),
      evidenceIds: unique(generatedContractCandidates.flatMap((candidate) => candidate.evidenceIds)),
    }];
  const integrationSurfaces: ExplorationArtifact["integrationSurfaces"] = [
    ...baseIntegrationSurfaces,
    ...compositionSurface,
    ...generatedContractSurface,
  ];

  const preliminaryMode: ExplorationArtifact["featureMode"] = entryPoints.length > 0 && directRecords.length >= 2
    ? "existing-feature"
    : entryPoints.length === 0 && integrationSurfaces.length >= 2 ? "greenfield-feature" : "uncertain";
  const entryPathSet = new Set(entryPoints.map((entry) => entry.path));
  const directPathSet = new Set(directRecords.map((record) => record.path));
  const connectedPaths = new Set(entryPathSet);
  let addedConnection = true;
  while (addedConnection) {
    addedConnection = false;
    for (const flow of flows) if (connectedPaths.has(flow.from) && !connectedPaths.has(flow.to)) {
      connectedPaths.add(flow.to);
      addedConnection = true;
    }
  }
  const allCriterionIds = specification.acceptanceCriteria.map((criterion) => criterion.id);
  const affectedPaths: ExplorationArtifact["affectedPaths"] = preliminaryMode === "existing-feature"
    ? unique([...directPathSet, ...connectedPaths]).flatMap((path) => {
      const record = relevant.find((item) => item.path === path);
      const itemEvidence = evidenceByPath.get(path);
      if (!record || !itemEvidence || evidenceKind(path) === "test") return [];
      const entry = entryPathSet.has(path);
      const direct = directPathSet.has(path);
      return [{
        path,
        confidence: entry ? "confirmed" as const : "likely" as const,
        kind: "existing" as const,
        basis: direct ? "direct-symbol" as const : "import-flow" as const,
        acceptanceCriterionIds: allCriterionIds,
        reason: direct
          ? "Path or exported symbol directly matches the existing feature and is structurally connected to its entry flow."
          : "Path is reached through a deterministic internal import from the existing feature entry flow.",
        evidenceIds: [itemEvidence.id],
      }];
    }).sort((left, right) => left.path.localeCompare(right.path)).slice(0, 32)
    : preliminaryMode === "greenfield-feature"
      ? deriveGreenfieldScope(integrationSurfaces)
      : [];

  const affectedPathSet = new Set(affectedPaths.map((item) => item.path));
  const candidates: ExplorationArtifact["candidates"] = relevant.filter((record) =>
    !affectedPathSet.has(record.path) && !directPathSet.has(record.path) &&
    !["manifest", "documentation", "configuration"].includes(evidenceKind(record.path)) &&
    (record.pathScore > 0 || record.contentScore > 0),
  ).slice(0, 24).map((record) => ({
    path: record.path,
    reason: "Lexical correspondence is retained as a candidate, but it lacks a direct symbol, flow, contract, or capability relationship that could authorize mutation.",
    basis: "lexical-match" as const,
    acceptanceCriterionIds: specification.acceptanceCriteria.filter((criterion) => {
      const criterionTerms = tokens(`${criterion.statement} ${criterion.scenario.when} ${criterion.scenario.then}`);
      const normalized = normalizeText(`${record.path} ${record.content}`);
      return criterionTerms.filter((term) => normalized.includes(term)).length >= Math.max(2, Math.ceil(criterionTerms.length * 0.3));
    }).map((criterion) => criterion.id),
    evidenceIds: [evidenceByPath.get(record.path)!.id],
  }));

  const contracts = preliminaryMode === "existing-feature" ? relevant.filter((record) =>
    evidenceKind(record.path) === "contract" && (directPathSet.has(record.path) || connectedPaths.has(record.path)),
  ).map((record) => {
    const consumerPaths = relevant.filter((candidate) => imports(candidate.content)
      .some((specifier) => resolveInternalImport(candidate.path, specifier, knownPaths) === record.path))
      .map((candidate) => candidate.path).sort();
    return {
      path: record.path,
      symbol: evidenceByPath.get(record.path)?.symbol ?? null,
      consumerPaths,
      evidenceIds: [evidenceByPath.get(record.path)!.id],
    };
  }) : [];

  const behaviorPathPattern = /(?:^|[-_/])(?:archive|archiv|cancel|close|deactivat|delete|remove|update|filter|status|create|list|upload|notify|send|arquiv|cancel|fech|exclu|remov|atualiz|filtr|cri|list)\w*/i;
  const similarImplementations = relevant.filter((record) =>
    evidenceKind(record.path) === "source" && !affectedPathSet.has(record.path) &&
    integrationSurfaces.some((surface) => surface.candidatePaths.some((candidate) => candidate.path === record.path)) &&
    behaviorPathPattern.test(record.path),
  ).slice(0, 12).map((record) => ({
    path: record.path,
    similarity: "Implements an architectural capability required by the specification without being the requested feature itself.",
    reusablePattern: "Repository-local layering, dependency direction, and boundary convention.",
    differences: ["This analogous implementation supplies a convention only; it cannot define the feature's product behavior."],
    evidenceIds: [evidenceByPath.get(record.path)!.id],
  }));

  const testRecords = relevant.filter((record) => evidenceKind(record.path) === "test");
  const testCapability = inspection.capabilities.find((item) => item.id === "test");
  const tests: ExplorationArtifact["tests"] = testRecords.length > 0
    ? testRecords.slice(0, 24).map((record) => {
      const imported = imports(record.content).map((specifier) => resolveInternalImport(record.path, specifier, knownPaths))
        .filter((path): path is string => Boolean(path));
      const direct = imported.some((path) => affectedPathSet.has(path) || directPathSet.has(path));
      const analogous = imported.some((path) => similarImplementations.some((item) => item.path === path));
      return {
        path: record.path,
        state: direct ? "direct" as const : analogous ? "analogous" as const
          : record.capabilityScore > 0 ? "infrastructure" as const : "candidate" as const,
        reason: direct
          ? "The test imports a substantive feature path."
          : analogous ? "The test covers an analogous architectural pattern, not the requested feature."
            : record.capabilityScore > 0 ? "The test exercises shared infrastructure relevant to an integration surface."
              : "Lexical similarity alone is insufficient for direct test classification.",
        evidenceIds: [evidenceByPath.get(record.path)!.id],
      };
    })
    : [{
      path: null,
      state: testCapability?.state === "detected" ? "capability-without-coverage" : "capability-unavailable",
      reason: testCapability?.state === "detected"
        ? "A test capability exists, but bounded exploration found no directly related test."
        : "Project inspection did not detect an executable test capability.",
      evidenceIds: [],
    }];

  const riskFindings: ExplorationArtifact["risk"]["findings"] = [];
  const substantivePathSet = new Set(affectedPaths.filter((item) => item.confidence !== "supporting").map((item) => item.path));
  const surfaceCandidatePaths = new Set(integrationSurfaces.flatMap((surface) => surface.candidatePaths.map((candidate) => candidate.path)));
  const riskRecords = relevant.filter((record) =>
    substantivePathSet.has(record.path) || connectedPaths.has(record.path) || surfaceCandidatePaths.has(record.path),
  );
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
    if (implementationUnknown && resolvedPathEvidence.length > 0 && preliminaryMode !== "uncertain") return {
      question,
      status: "resolved" as const,
      resolution: "Repository exploration identified evidence-backed implementation paths.",
      evidenceIds: unique(resolvedPathEvidence),
    };
    return {
      question,
      status: "remaining" as const,
      resolution: implementationUnknown && preliminaryMode === "uncertain"
        ? "Exploration found candidates but did not establish an existing feature flow or sufficient greenfield integration surfaces."
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
    const surfaceEvidence = integrationSurfaces.filter((surface) => surface.acceptanceCriterionIds.includes(criterion.id))
      .flatMap((surface) => surface.evidenceIds);
    const directEvidence = preliminaryMode === "existing-feature" ? directRecords.filter((record) => {
      const criterionTerms = tokens(`${criterion.statement} ${criterion.scenario.given} ${criterion.scenario.when} ${criterion.scenario.then}`);
      const normalized = normalizeText(`${record.path} ${record.content}`);
      return criterionTerms.filter((term) => normalized.includes(term)).length >= Math.max(2, Math.ceil(criterionTerms.length * 0.25));
    }).map((record) => evidenceByPath.get(record.path)?.id).filter((id): id is string => Boolean(id)) : [];
    const matching = unique([...surfaceEvidence, ...directEvidence]).slice(0, 12);
    return {
      criterionId: criterion.id,
      source: "specification" as const,
      status: matching.length > 0 ? "evidence-found" as const : "not-found" as const,
      evidenceIds: matching,
      note: matching.length > 0
        ? preliminaryMode === "greenfield-feature"
          ? "An evidence-backed integration surface makes this supplied criterion plannable; implementation is not claimed."
          : "Direct feature evidence relates to this supplied criterion; it does not redefine the criterion."
        : "No substantive evidence for this supplied criterion was found within the exploration budget.",
    };
  });

  const substantivePaths = affectedPaths.filter((item) => item.confidence !== "supporting");
  const requiredCriterionIds = specification.acceptanceCriteria.filter((criterion) => criterion.priority === "required")
    .map((criterion) => criterion.id);
  const coveredCriterionIds = new Set(acceptanceCoverage.filter((item) => item.status === "evidence-found")
    .map((item) => item.criterionId));
  const requiredCoverage = requiredCriterionIds.every((id) => coveredCriterionIds.has(id));
  const sufficientExisting = preliminaryMode === "existing-feature" && entryPoints.length > 0 && substantivePaths.length > 1;
  const sufficientGreenfield = preliminaryMode === "greenfield-feature" && integrationSurfaces.length >= 2 &&
    substantivePaths.length >= 2 && requiredCoverage;
  let status: ExplorationArtifact["status"];
  let stopReason: ExplorationArtifact["stopReason"];
  if (sufficientExisting || sufficientGreenfield) {
    status = "ready";
    stopReason = "sufficient-evidence";
  } else if (substantivePaths.length === 0) {
    status = "blocked";
    stopReason = inventory.length === 0 ? "blocked-by-missing-context" : "blocked-by-ambiguity";
  } else if (exhausted) {
    status = "partial";
    stopReason = "budget-exhausted";
  } else {
    status = "partial";
    stopReason = "scope-boundary";
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
    featureMode: preliminaryMode,
    integrationSurfaceIds: integrationSurfaces.map((surface) => surface.id),
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
    featureMode: preliminaryMode,
    contextManifest,
    budget: {
      maxFilesInspected,
      filesInventoried: inventory.length,
      filesInspected: selectedPaths.length,
      exhausted,
      passes: [{
        phase: "reconnaissance",
        allowance: passOneAllowance,
        consumed: passOnePaths.length,
        reason: "Inspect manifests and the strongest structural or terminology candidates first.",
        prioritizedRegions: [],
      }, {
        phase: "targeted",
        allowance: passTwoAllowance,
        consumed: passTwoPaths.length,
        reason: "Concentrate the second pass on capability-bearing regions discovered during reconnaissance.",
        prioritizedRegions,
      }, {
        phase: "resolution",
        allowance: passThreeAllowance,
        consumed: passThreePaths.length,
        reason: "Spend the remaining bounded budget on internal imports and unresolved high-value capability candidates.",
        prioritizedRegions,
      }],
    },
    terminology,
    evidence,
    entryPoints,
    flows: flows.sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`)),
    similarImplementations,
    candidates,
    integrationSurfaces,
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
