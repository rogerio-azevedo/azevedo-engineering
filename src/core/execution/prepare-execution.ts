import { createHash } from "node:crypto";
import type { ProjectInspectResult } from "../inspection/inspect-result.js";
import { KNOWLEDGE_CATALOG } from "../knowledge/catalog.js";
import { resolveContextManifest } from "../knowledge/resolve-context.js";
import { ExplorationArtifactSchema, type ExplorationArtifact } from "../exploration/exploration-artifact.js";
import { EngineeringPlanRevisionSchema, type EngineeringPlanRevision } from "../planning/plan-revision.js";
import { FeatureSpecificationSchema, type FeatureSpecification } from "../specification/feature-specification.js";
import {
  ExecutionContextSchema,
  ExecutionPreparationSchema,
  ExecutionReadinessSchema,
  ExecutionSessionSchema,
  stableDigest,
  type ExecutionContext,
  type ExecutionPermission,
  type ExecutionPreparation,
  type ExecutionReadiness,
  type ExecutionSession,
  type ExecutionUnknown,
  type ProjectCheckpoint,
} from "./execution-contracts.js";
import { humanDirtyPaths } from "./project-checkpoint.js";

export type PrepareExecutionInput = {
  inspection: ProjectInspectResult;
  revision: EngineeringPlanRevision;
  specification: FeatureSpecification;
  exploration: ExplorationArtifact;
  checkpoint: ProjectCheckpoint;
  executionSequence: number;
  writeAuthorized?: boolean;
  requireIsolation?: boolean;
  maxContextTokens?: number;
};

export type PreparedExecution = {
  preparation: ExecutionPreparation;
  context: ExecutionContext | null;
  session: ExecutionSession | null;
  instructions: string | null;
};

function equalRevision(left: ProjectCheckpoint["subjectRevision"], right: ProjectCheckpoint["subjectRevision"]): boolean {
  return left.head === right.head && left.worktreeDigest === right.worktreeDigest && left.dirty === right.dirty;
}

function classifyUnknowns(specification: FeatureSpecification, exploration: ExplorationArtifact): ExecutionUnknown[] {
  const allCriteria = specification.acceptanceCriteria.map((criterion) => criterion.id);
  const product: ExecutionUnknown[] = specification.openQuestions.map((question) => ({
    category: "product-decision",
    question,
    disposition: "block",
    basis: "The supplied specification marks this product question as open; repository similarity cannot decide it.",
    affectedAcceptanceCriteria: allCriteria,
    evidenceIds: [],
    sourceReferences: [`.azevedo/specifications/${specification.id}.json`],
  }));
  const remaining = exploration.unknowns.filter((unknown) => unknown.status === "remaining").map((unknown) => {
    const external = /external|consumer|provider|service|credential|network|webhook/i.test(`${unknown.question} ${unknown.resolution}`);
    return {
      category: external ? "external-dependency" as const : "technical-unknown" as const,
      question: unknown.question,
      disposition: external && /blocked|unavailable|required/i.test(unknown.resolution)
        ? "block" as const : external ? "observe" as const : "investigate" as const,
      basis: unknown.resolution,
      affectedAcceptanceCriteria: [],
      evidenceIds: unknown.evidenceIds,
      sourceReferences: [`.azevedo/explorations/${exploration.id}.json`],
    };
  });
  return [...product, ...remaining];
}

export function assessExecutionReadiness(input: Omit<PrepareExecutionInput, "executionSequence" | "maxContextTokens">): ExecutionReadiness {
  const revision = EngineeringPlanRevisionSchema.parse(input.revision);
  const specification = FeatureSpecificationSchema.parse(input.specification);
  const exploration = ExplorationArtifactSchema.parse(input.exploration);
  const reasons: ExecutionReadiness["reasons"] = [];
  const unknowns = classifyUnknowns(specification, exploration);
  if (revision.planId !== exploration.planId || exploration.specificationId !== specification.id) reasons.push({
    code: "artifacts-invalid", message: "Revision, exploration, and specification do not describe the same plan.", blocking: true,
  });
  if (
    revision.planSnapshot.task.description !== specification.objective ||
    JSON.stringify(revision.acceptanceCriteria) !== JSON.stringify([...specification.acceptanceCriteria].sort((left, right) => left.id.localeCompare(right.id)))
  ) reasons.push({
    code: "artifacts-invalid", message: "Revision intent or acceptance criteria differ from the supplied specification.", blocking: true,
  });
  const expectedSources = [
    `.azevedo/specifications/${specification.id}.json`,
    `.azevedo/explorations/${exploration.id}.json`,
  ];
  if (!expectedSources.every((source) => revision.basis.sourceArtifactIds.includes(source))) reasons.push({
    code: "artifacts-invalid", message: "Revision provenance does not reference both supplied source artifacts.", blocking: true,
  });
  const exploredScope = exploration.affectedPaths.filter((item) => item.confidence !== "supporting")
    .map((item) => item.path).sort();
  const revisedScope = [...revision.planSnapshot.scope.affectedPaths].sort();
  if (JSON.stringify(exploredScope) !== JSON.stringify(revisedScope)) reasons.push({
    code: "artifacts-invalid", message: "Revision scope does not match the supplied Exploration artifact.", blocking: true,
  });
  if (revision.acceptanceCriteria.length === 0) reasons.push({
    code: "acceptance-missing", message: "Execution requires at least one persisted acceptance criterion.", blocking: true,
  });
  if (exploration.status === "blocked") reasons.push({
    code: "exploration-blocked", message: `Exploration is blocked (${exploration.stopReason}).`, blocking: true,
  });
  const executablePaths = exploration.affectedPaths.filter((item) => item.confidence !== "supporting");
  const modeHasScope = exploration.featureMode === "existing-feature"
    ? exploration.entryPoints.length > 0 && executablePaths.length > 0
    : exploration.featureMode === "greenfield-feature"
      ? exploration.integrationSurfaces.length > 0 && executablePaths.some((item) => item.kind === "proposed")
      : false;
  if (!modeHasScope) reasons.push({
    code: "scope-insufficient",
    message: exploration.featureMode === "greenfield-feature"
      ? "Greenfield execution requires integration surfaces and an evidence-backed proposed scope."
      : "Existing-feature execution requires an evidence-backed entry point and implementation scope.",
    blocking: true,
  });
  const weakScope = executablePaths.filter((item) =>
    item.evidenceIds.length === 0 || item.acceptanceCriterionIds.length === 0 ||
    (item.kind === "proposed" && !["architectural-pattern", "capability-match", "acceptance-criterion-match"].includes(item.basis)),
  );
  if (weakScope.length > 0) reasons.push({
    code: "scope-quality-insufficient",
    message: `Mutation scope lacks substantive provenance: ${weakScope.map((item) => item.path).join(", ")}.`,
    blocking: true,
  });
  for (const unknown of unknowns.filter((item) => item.category === "product-decision")) reasons.push({
    code: "product-decision-open", message: unknown.question, blocking: true,
  });
  for (const unknown of unknowns.filter((item) => item.category === "external-dependency" && item.disposition === "block")) reasons.push({
    code: "external-dependency-blocked", message: `${unknown.question}: ${unknown.basis}`, blocking: true,
  });
  const requiredUnavailable = revision.planSnapshot.verification.filter((item) => item.required && !item.available);
  if (requiredUnavailable.length > 0) reasons.push({
    code: "verification-unavailable",
    message: `Required verification is unavailable: ${requiredUnavailable.map((item) => item.targetId).join(", ")}.`,
    blocking: true,
  });
  if (!equalRevision(exploration.sourceRevision, input.checkpoint.subjectRevision)) reasons.push({
    code: "source-revision-changed", message: "Project source changed after exploration; refresh evidence before execution.", blocking: true,
  });
  const dirtyPaths = humanDirtyPaths(input.checkpoint);
  if (dirtyPaths.length > 0) reasons.push({
    code: "dirty-human-work", message: `Preserve existing human changes before execution: ${dirtyPaths.join(", ")}.`, blocking: true,
  });
  return ExecutionReadinessSchema.parse({
    schemaVersion: 1,
    status: reasons.some((reason) => reason.blocking) ? "blocked" : "ready",
    reasons,
    unknowns,
    requiredVerificationTargetIds: revision.planSnapshot.verification
      .filter((item) => item.required).map((item) => item.targetId).sort(),
  });
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function requiredEnvironmentVariables(specification: FeatureSpecification): string[] {
  const matches = JSON.stringify(specification).match(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\b/g) ?? [];
  return [...new Set(matches)].sort();
}

function executionPermission(
  exploration: ExplorationArtifact,
  specification: FeatureSpecification,
  mutationAuthorized: boolean,
): ExecutionPermission {
  return {
    sourceWrite: mutationAuthorized ? "isolated-worktree-only" : "denied",
    allowedPaths: exploration.affectedPaths.filter((item) => item.confidence !== "supporting").map((item) => item.path).sort(),
    excludedCandidatePaths: exploration.candidates.map((item) => item.path).sort(),
    requiredEnvironmentVariables: requiredEnvironmentVariables(specification),
    allowNetwork: false,
    allowCommit: false,
    allowPush: false,
    allowedActions: [
      "read", "write-authorized-scope", "create-tests", "run-authorized-verification",
      "investigate-technical-unknown", "propose-scope-expansion",
    ],
    deniedActions: [
      "invent-product-decision", "change-acceptance-criteria", "reduce-risk", "erase-human-work",
      "commit", "push", "write-outside-project", "read-unnecessary-secrets", "mutate-external-infrastructure",
    ],
  };
}

const RISK_ORDER = ["trivial", "normal", "high-risk", "critical"] as const;

function preserveRisk(exploration: ExplorationArtifact, revision: EngineeringPlanRevision): ExplorationArtifact["risk"] {
  const revisionRisk = revision.planSnapshot.risk.class;
  const className = RISK_ORDER.indexOf(revisionRisk) > RISK_ORDER.indexOf(exploration.risk.class)
    ? revisionRisk : exploration.risk.class;
  return { class: className, findings: exploration.risk.findings };
}

function buildExecutionContext(
  input: PrepareExecutionInput,
  readiness: ExecutionReadiness,
  mutationAuthorized: boolean,
): ExecutionContext {
  const { specification, exploration, revision, inspection } = input;
  const defaultEstimatedTokens = 6_000;
  const explorationReference = `.azevedo/explorations/${exploration.id}.json`;
  const knowledgeManifest = resolveContextManifest(KNOWLEDGE_CATALOG, {
    phase: "implement",
    taskType: revision.planSnapshot.task.type,
    riskClass: revision.planSnapshot.risk.class,
    signals: revision.planSnapshot.risk.signals,
    technologies: inspection.technologies.map((technology) => technology.id),
    capabilities: inspection.capabilities.filter((item) => ["detected", "configured"].includes(item.state)).map((item) => item.id),
    affectedPaths: revision.planSnapshot.scope.affectedPaths,
  });
  const evidenceById = new Map(exploration.evidence.map((item) => [item.id, item]));
  const referencedIds = new Set([
    ...exploration.affectedPaths.flatMap((item) => item.evidenceIds),
    ...exploration.entryPoints.flatMap((item) => item.evidenceIds),
    ...exploration.integrationSurfaces.flatMap((item) => item.evidenceIds),
    ...exploration.candidates.flatMap((item) => item.evidenceIds),
    ...exploration.contracts.flatMap((item) => item.evidenceIds),
    ...exploration.tests.flatMap((item) => item.evidenceIds),
  ]);
  const seed = {
    schemaVersion: 1 as const,
    kind: "execution-context" as const,
    id: "execution-context-000000000000",
    planId: revision.planId,
    revisionId: revision.id,
    specificationId: specification.id,
    explorationId: exploration.id,
    intent: {
      title: specification.title,
      objective: specification.objective,
      businessRules: [...specification.businessRules],
      decisions: [...specification.decisions],
      constraints: [...specification.constraints],
      outOfScope: [...specification.outOfScope],
    },
    acceptanceCriteria: revision.acceptanceCriteria,
    scope: {
      initialPaths: exploration.affectedPaths.filter((item) => item.confidence !== "supporting").map((item) => item.path).sort(),
      entryPoints: exploration.entryPoints.map((item) => item.path).sort(),
      integrationSurfaces: exploration.integrationSurfaces.map((surface) => ({
        capability: surface.capability,
        candidatePaths: surface.candidatePaths.map((candidate) => candidate.path).sort(),
        acceptanceCriterionIds: [...surface.acceptanceCriterionIds].sort(),
      })),
      contracts: exploration.contracts.map((item) => item.path).sort(),
      testPaths: exploration.tests.flatMap((item) => item.path ? [item.path] : []).sort(),
      flows: exploration.flows.map((item) => ({ from: item.from, to: item.to, relation: item.relation })),
      omittedReferences: [] as string[],
    },
    knownPatterns: exploration.similarImplementations.map((item) => ({
      path: item.path, pattern: item.reusablePattern, differences: item.differences,
    })),
    risks: preserveRisk(exploration, revision),
    technicalUnknowns: readiness.unknowns.filter((item) => item.category !== "product-decision"),
    verification: revision.planSnapshot.verification,
    knowledgeManifest,
    evidence: [...referencedIds].flatMap((id) => {
      const evidence = evidenceById.get(id);
      return evidence ? [{ id, path: evidence.path, reason: evidence.reason }] : [];
    }).sort((left, right) => left.id.localeCompare(right.id)),
    permissions: executionPermission(exploration, specification, mutationAuthorized),
    stopConditions: [
      "Stop before changing behavior when a product decision is missing.",
      "Stop when a requested path is outside the authorized scope until an evidence-backed expansion is recorded.",
      "Stop after the bounded attempt limit; preserve the failure and diagnosis.",
      "Never commit, push, or persist secret values.",
    ],
    budget: {
      defaultEstimatedTokens,
      requestedEstimatedTokens: input.maxContextTokens ?? null,
      requiredCoreEstimatedTokens: 0,
      maxEstimatedTokens: input.maxContextTokens ?? defaultEstimatedTokens,
      estimatedTokens: 0,
      selectionReason: (input.maxContextTokens === undefined ? "default" : "explicit") as
        "default" | "explicit" | "required-core-auto-expansion",
      truncated: false,
      omittedReferences: [] as string[],
    },
  };
  const coreProjection = {
    ...seed,
    scope: { ...seed.scope, contracts: [], testPaths: [], flows: [], omittedReferences: [] },
    knownPatterns: [],
    budget: { ...seed.budget, estimatedTokens: 0, omittedReferences: [] },
  };
  const requiredCoreEstimatedTokens = tokenEstimate(coreProjection);
  const explicitBudget = input.maxContextTokens;
  const effectiveBudget = explicitBudget ?? (requiredCoreEstimatedTokens > defaultEstimatedTokens
    ? Math.ceil(requiredCoreEstimatedTokens * 1.15) : defaultEstimatedTokens);
  seed.budget.requiredCoreEstimatedTokens = requiredCoreEstimatedTokens;
  seed.budget.maxEstimatedTokens = effectiveBudget;
  seed.budget.selectionReason = explicitBudget !== undefined
    ? "explicit"
    : requiredCoreEstimatedTokens > defaultEstimatedTokens ? "required-core-auto-expansion" : "default";
  const maxEstimatedTokens = effectiveBudget;
  const optionalCollections: Array<{ values: unknown[]; reference: string; remove: () => void }> = [];
  for (let index = seed.scope.contracts.length - 1; index >= 0; index -= 1) optionalCollections.push({
    values: seed.scope.contracts, reference: `${explorationReference}#contracts`, remove: () => { seed.scope.contracts.splice(index, 1); },
  });
  for (let index = seed.scope.testPaths.length - 1; index >= 0; index -= 1) optionalCollections.push({
    values: seed.scope.testPaths, reference: `${explorationReference}#tests`, remove: () => { seed.scope.testPaths.splice(index, 1); },
  });
  for (let index = seed.knownPatterns.length - 1; index >= 0; index -= 1) optionalCollections.push({
    values: seed.knownPatterns, reference: `${explorationReference}#similarImplementations`, remove: () => { seed.knownPatterns.splice(index, 1); },
  });
  for (let index = seed.scope.flows.length - 1; index >= 0; index -= 1) optionalCollections.push({
    values: seed.scope.flows, reference: `${explorationReference}#flows`, remove: () => { seed.scope.flows.splice(index, 1); },
  });
  let estimatedTokens = tokenEstimate(seed);
  for (const optional of optionalCollections) {
    if (estimatedTokens <= maxEstimatedTokens) break;
    if (optional.values.length === 0) continue;
    optional.remove();
    if (!seed.budget.omittedReferences.includes(optional.reference)) seed.budget.omittedReferences.push(optional.reference);
    seed.budget.truncated = true;
    estimatedTokens = tokenEstimate(seed);
  }
  seed.budget.estimatedTokens = tokenEstimate(seed);
  if (requiredCoreEstimatedTokens > maxEstimatedTokens) throw new Error(
    `Required execution context core is ${requiredCoreEstimatedTokens} tokens and exceeds the explicit ${maxEstimatedTokens}-token budget.`,
  );
  if (seed.budget.estimatedTokens > maxEstimatedTokens) throw new Error(
    `Execution context remains ${seed.budget.estimatedTokens} tokens after optional-content truncation and exceeds the ${maxEstimatedTokens}-token budget; omitted references were preserved.`,
  );
  const identity = { ...seed, id: undefined, budget: { ...seed.budget, estimatedTokens: 0 } };
  return ExecutionContextSchema.parse({ ...seed, id: `execution-context-${stableDigest(identity)}` });
}

function createSession(input: PrepareExecutionInput, context: ExecutionContext): ExecutionSession {
  const executionId = `execution-${input.executionSequence}-${stableDigest({
    revisionId: input.revision.id,
    planId: input.revision.planId,
    specificationId: input.specification.id,
    explorationId: input.exploration.id,
    contextId: context.id,
    before: input.checkpoint,
    sequence: input.executionSequence,
  }, 10)}`;
  const snapshotSequence = 1;
  const snapshotId = `execution-snapshot-${snapshotSequence}-${createHash("sha256")
    .update(`${executionId}:${snapshotSequence}`).digest("hex").slice(0, 10)}`;
  return ExecutionSessionSchema.parse({
    schemaVersion: 1,
    kind: "execution-session",
    id: executionId,
    snapshotSequence,
    parentSnapshotId: null,
    snapshotId,
    revisionId: input.revision.id,
    planId: input.revision.planId,
    specificationId: input.specification.id,
    explorationId: input.exploration.id,
    contextId: context.id,
    status: "prepared",
    maxAttempts: 3,
    before: input.checkpoint,
    after: null,
    attempts: [],
    changes: [],
    scopeExpansions: [],
    verificationEvidence: [],
    requiredVerificationTargetIds: input.revision.planSnapshot.verification.filter((item) => item.required)
      .map((item) => item.targetId).sort(),
    acceptanceCoverage: input.revision.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.id,
      state: "blocked",
      changedPaths: [],
      evidenceIds: [],
      note: "No implementation attempt has been recorded.",
    })),
    decisions: [],
  });
}

export function renderExecutionInstructions(context: ExecutionContext): string {
  const lines = (values: readonly string[], empty = "None.") => values.length > 0
    ? values.map((value) => `- ${value}`).join("\n") : empty;
  return [
    "# INTENT", `${context.intent.title}\n\n${context.intent.objective}`,
    "# EVIDENCE", lines(context.evidence.map((item) => `${item.id}: ${item.path} — ${item.reason}`)),
    "# ACCEPTANCE CRITERIA", lines(context.acceptanceCriteria.map((item) => `${item.id}: ${item.statement}`)),
    "# SCOPE", lines([
      ...context.scope.initialPaths,
      ...context.scope.integrationSurfaces.map((surface) =>
        `integration:${surface.capability} -> ${surface.candidatePaths.join(", ")}`),
    ]),
    "# KNOWN PATTERNS", lines([
      ...context.scope.flows.map((item) => `${item.from} ${item.relation} ${item.to}`),
      ...context.knownPatterns.map((item) => `${item.path}: ${item.pattern}`),
    ]),
    "# RISKS", lines(context.risks.findings.map((item) => `${item.signal}: ${item.reason}`)),
    "# UNKNOWN TECHNICAL QUESTIONS", lines(context.technicalUnknowns.map((item) => `${item.category}: ${item.question}`)),
    "# IMPLEMENTATION CONSTRAINTS", lines([
      ...context.intent.businessRules,
      ...context.intent.decisions,
      ...context.intent.constraints,
      `Source write: ${context.permissions.sourceWrite}`,
      "Do not commit or push.",
      "Record evidence before expanding scope.",
    ]),
    "# VERIFICATION", lines(context.verification.map((item) => `${item.targetId}: ${item.available ? item.script ?? "structural check" : "UNAVAILABLE"}`)),
    "# STOP CONDITIONS", lines(context.stopConditions),
  ].join("\n\n") + "\n";
}

export function prepareExecution(input: PrepareExecutionInput): PreparedExecution {
  const readiness = assessExecutionReadiness(input);
  const canBuildContext = !readiness.reasons.some((reason) => [
    "artifacts-invalid", "acceptance-missing", "exploration-blocked", "scope-insufficient",
    "scope-quality-insufficient", "source-revision-changed",
  ].includes(reason.code));
  const authorizationReasons: ExecutionPreparation["authorizationReasons"] = [];
  if (readiness.status !== "ready") authorizationReasons.push("readiness-blocked");
  if (input.writeAuthorized !== true) authorizationReasons.push("write-not-authorized");
  if (input.requireIsolation !== false && input.checkpoint.gitMode !== "linked-worktree") authorizationReasons.push("isolation-required");
  if (!input.checkpoint.subjectRevision) authorizationReasons.push("checkpoint-not-captured");
  const mutationAuthorized = authorizationReasons.length === 0;
  const contextCandidate = canBuildContext ? buildExecutionContext(input, readiness, mutationAuthorized) : null;
  const context = mutationAuthorized ? contextCandidate : null;
  const session = context ? createSession(input, context) : null;
  const preparationId = `preparation-${stableDigest({
    revisionId: input.revision.id,
    checkpoint: input.checkpoint,
    writeAuthorized: input.writeAuthorized === true,
    readiness,
  })}`;
  const preparation = ExecutionPreparationSchema.parse({
    schemaVersion: 1,
    kind: "execution-preparation",
    id: preparationId,
    mode: "prepare",
    writeAuthorized: input.writeAuthorized === true,
    mutationAuthorized,
    authorizationReasons,
    contextBudget: contextCandidate?.budget ?? {
      defaultEstimatedTokens: 6_000,
      requestedEstimatedTokens: input.maxContextTokens ?? null,
      requiredCoreEstimatedTokens: 0,
      maxEstimatedTokens: input.maxContextTokens ?? 6_000,
      estimatedTokens: 0,
      selectionReason: input.maxContextTokens === undefined ? "default" : "explicit",
      truncated: false,
      omittedReferences: [],
    },
    readiness,
    contextId: context?.id ?? null,
    sessionId: session?.id ?? null,
  });
  return { preparation, context, session, instructions: context ? renderExecutionInstructions(context) : null };
}
