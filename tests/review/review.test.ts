import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ExecutionSessionSchema,
  FindingVerificationSchema,
  ReviewPreparationSchema,
  ReviewReportSchema,
  ReviewSubmissionSchema,
  applyReviewArtifactOperations,
  buildEngineeringPlan,
  buildReviewArtifactOperations,
  captureProjectCheckpoint,
  createFeatureSpecification,
  createInspectResult,
  createReviewFindingCandidate,
  createReviewUnknown,
  exploreProject,
  finalizeReview,
  loadReviewPreparation,
  prepareReview,
  reviewDigest,
  runFilePresenceVerifier,
  type FindingVerificationProvider,
  type ReviewCandidateProvider,
  type ReviewFindingCandidate,
} from "../../src/index.js";
import { runCli } from "../../src/cli/command.js";

function write(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function digest(value: string): string {
  return `sha256:${Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function fixture(options: { includeUnmappedSurface?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "azevedo-review-"));
  write(root, "package.json", `${JSON.stringify({
    name: "review-fixture",
    packageManager: "pnpm@11.24.0",
    scripts: { typecheck: "tsc --noEmit" },
    dependencies: { "@nestjs/common": "11.0.0" },
  })}\n`);
  write(root, "tsconfig.json", "{}\n");
  write(root, "src/packages.controller.ts", `
import { storePhoto } from "./storage/uploads.js";
import { canManagePackages } from "./auth/permission.guard.js";
export const registerPackage = (photo: string) => canManagePackages() && storePhoto(photo);
`);
  write(root, "src/storage/uploads.ts", "export const storePhoto = (value: string) => value;\n");
  write(root, "src/auth/permission.guard.ts", "export const canManagePackages = () => true;\n");
  const specification = createFeatureSpecification({
    title: "Registrar encomenda com foto e autorização",
    objective: "Permitir que um usuário autorizado registre uma encomenda com foto no condomínio atual",
    expectedBehaviors: ["A encomenda autorizada é persistida com a foto."],
    constraints: ["A operação permanece limitada ao condomínio atual."],
    acceptanceCriteria: [{
      id: "ac-register-package",
      source: { kind: "user", reference: null },
      statement: "Um usuário autorizado registra uma encomenda no condomínio atual.",
      scenario: {
        given: "um usuário autorizado com foto válida",
        when: "registra a encomenda",
        then: "o registro fica disponível somente no condomínio atual",
      },
      prohibitedEffects: ["Não expor dados a outro condomínio."],
      verificationMethod: "Teste de autorização, isolamento e persistência.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project inspection.");
  const plan = buildEngineeringPlan(inspection, specification.objective);
  const explored = exploreProject(root, inspection, plan, specification);
  assert.ok(explored.revision);
  if (!explored.revision) throw new Error("Expected plan revision.");
  const captured = captureProjectCheckpoint(root);
  const reviewedPath = "src/packages.controller.ts";
  const sourceEvidenceId = explored.artifact.evidence[0]?.id;
  assert.ok(sourceEvidenceId);
  const reviewExploration = {
    ...explored.artifact,
    candidates: explored.artifact.candidates.filter((candidate) => candidate.path !== reviewedPath),
    affectedPaths: [{
      path: reviewedPath,
      confidence: "confirmed" as const,
      kind: "existing" as const,
      basis: "direct-symbol" as const,
      acceptanceCriterionIds: ["ac-register-package"],
      reason: "Controller is the observable registration entry point.",
      evidenceIds: [sourceEvidenceId!],
    }],
    integrationSurfaces: [
      ["identity-authorization", "Authorization boundary"],
      ["file-storage", "File storage boundary"],
      ["api-boundary", "External API boundary"],
      ["persistence", "Durable state boundary"],
      ...(options.includeUnmappedSurface ? [["novel-external-boundary", "A new external boundary"]] : []),
    ].map(([capability, description], index) => ({
      id: `surface-${capability}-${String(index + 1).padStart(8, "0")}`,
      capability: capability!,
      description: description!,
      basis: "acceptance-criterion-match" as const,
      candidatePaths: [{ path: reviewedPath, role: description!, evidenceIds: [sourceEvidenceId!] }],
      acceptanceCriterionIds: ["ac-register-package"],
      evidenceIds: [sourceEvidenceId!],
    })),
    risk: {
      class: "high-risk" as const,
      findings: (["authorization", "file_upload", "external_input", "persistence"] as const).map((signal) => ({
        signal,
        reason: `The change crosses the ${signal} boundary.`,
        evidenceIds: [sourceEvidenceId!],
      })),
    },
    status: "ready" as const,
    stopReason: "sufficient-evidence" as const,
  };
  const verification = runFilePresenceVerifier({
    taskId: plan.id,
    root,
    scope: ".",
    requiredPaths: [reviewedPath],
    subjectRevision: captured.subjectRevision,
  });
  const execution = ExecutionSessionSchema.parse({
    schemaVersion: 1,
    kind: "execution-session",
    id: "execution-1-aaaaaaaaaa",
    snapshotSequence: 1,
    parentSnapshotId: null,
    snapshotId: "execution-snapshot-1-aaaaaaaaaa",
    revisionId: explored.revision.id,
    planId: explored.revision.planId,
    specificationId: specification.id,
    explorationId: reviewExploration.id,
    contextId: "execution-context-aaaaaaaaaaaa",
    status: "prepared",
    maxAttempts: 3,
    before: captured,
    after: captured,
    attempts: [],
    verificationEvidence: [verification],
    changes: [{ path: reviewedPath, kind: "modified", attempt: 1, evidenceIds: [verification.id] }],
    scopeExpansions: [],
    requiredVerificationTargetIds: [],
    acceptanceCoverage: [{
      criterionId: "ac-register-package",
      state: "implemented",
      changedPaths: [reviewedPath],
      evidenceIds: [],
      note: "Prepared fixture for independent review.",
    }],
    decisions: [],
  });
  const changeSetSeed = {
    schemaVersion: 1 as const,
    source: "execution-checkpoints" as const,
    baseRevision: captured.subjectRevision,
    targetRevision: captured.subjectRevision,
    exactExecutionMatch: true,
    mismatchReasons: [],
    files: [{
      path: reviewedPath,
      kind: "modified" as const,
      previousPath: null,
      diffDigest: digest("diff"),
      acceptanceCriterionIds: ["ac-register-package"],
      planStepIds: ["implement-requested-change"],
      executionEvidenceIds: [verification.id],
      withinAuthorizedScope: true,
    }],
    diffDigest: digest("full-diff"),
  };
  const changeSet = { ...changeSetSeed, id: `change-set-${reviewDigest(changeSetSeed)}` };
  const preparation = prepareReview({
    inspection,
    specification,
    revision: explored.revision,
    exploration: reviewExploration,
    execution,
    changeSet,
  });
  return { root, preparation, path: reviewedPath };
}

function cleanSubmission(preparation: ReturnType<typeof prepareReview>) {
  const evidenceId = preparation.context.evidence[0]!.id;
  return ReviewSubmissionSchema.parse({
    contextId: preparation.context.id,
    reviewerRuns: preparation.context.requiredLenses.map((lens) => ({
      reviewerId: `${lens}-reviewer`, lens, provider: "fake-provider", reviewedEvidenceIds: [evidenceId], completed: true,
    })),
    acceptanceReviews: preparation.context.acceptanceCriteria.map((criterion) => ({
      criterionId: criterion.id,
      status: "satisfied",
      evidenceIds: [evidenceId],
      candidateFindingIds: [],
      rationale: "Implementation and verification evidence satisfy the observable scenario.",
    })),
    candidates: [],
    findingVerifications: [],
    residualUnknowns: [],
  });
}

function candidate(preparation: ReturnType<typeof prepareReview>, path: string, input?: {
  reviewerId?: string;
  runId?: string;
  lens?: "change" | "acceptance" | "security";
  title?: string;
  severity?: "critical" | "high" | "medium" | "low";
}): ReviewFindingCandidate {
  const evidenceId = preparation.context.evidence.find((item) => item.path === path)?.id ?? preparation.context.evidence[0]!.id;
  const boundaryId = preparation.context.trustBoundaries[0]?.id ?? null;
  return createReviewFindingCandidate({
    source: {
      reviewerId: input?.reviewerId ?? "security-reviewer",
      lens: input?.lens ?? "security",
      ...(input?.runId ? { runId: input.runId } : {}),
    },
    category: "security",
    severity: input?.severity ?? "high",
    title: input?.title ?? "Authorization is not scoped to the resource",
    locations: [{ path, line: 1, symbol: "registerPackage" }],
    failureScenario: {
      preconditions: ["The caller is authenticated for a different condominium."],
      action: "The caller submits a package registration for the target condominium.",
      observableFailure: "The package is accepted without resource-scoped authorization.",
      affectedParty: "Residents of the target condominium.",
    },
    impact: "A caller can write data across the tenant boundary.",
    evidenceIds: [evidenceId],
    acceptanceCriterionIds: ["ac-register-package"],
    planStepIds: ["implement-requested-change"],
    executionChangePaths: [path],
    trustBoundaryIds: boundaryId ? [boundaryId] : [],
    evidenceQuality: "direct",
    rootCause: {
      key: "authorization/resource-scope",
      category: "authorization",
      violatedInvariant: "Every write is authorized against its concrete tenant-owned resource.",
      primaryPath: path,
      trustBoundaryId: boundaryId,
    },
    attribution: "introduced",
    recommendedAction: "Authorize the requested condominium and add a negative cross-tenant test.",
    proposedVerification: "Exercise the action with an identity scoped only to a different tenant and assert denial.",
  });
}

test("review preparation selects evidence-backed security domains and keeps provider roles separate", async () => {
  const { preparation } = fixture();
  assert.equal(preparation.status, "ready");
  assert.ok(preparation.context.securityDomains.length > 0);
  assert.ok(preparation.context.trustBoundaries.length > 0);
  assert.ok(preparation.context.requiredLenses.includes("security"));
  assert.ok(preparation.context.knowledgeManifest.selected.some((item) => item.id === "knowledge.review.acceptance"));
  assert.ok(preparation.context.knowledgeManifest.selected.some((item) => item.id === "knowledge.review.adversarial-verification"));

  const producer: ReviewCandidateProvider = {
    providerId: "fake-producer",
    async review() { return []; },
  };
  const verifier: FindingVerificationProvider = {
    providerId: "fake-verifier",
    async verify(_context, value) {
      return FindingVerificationSchema.parse({
        candidateId: value.id,
        verifierId: "fake-verifier",
        outcome: "insufficient-evidence",
        attemptedRefutation: "Inspected guards and callers.",
        contraryEvidenceIds: [],
        rationale: "The fixture does not expose enough runtime behavior.",
        evidenceQuality: "insufficient",
      });
    },
  };
  assert.deepEqual(await producer.review(preparation.context, "change"), []);
  assert.equal(verifier.providerId, "fake-verifier");
});

test("a clean, fully evidenced review passes without manufactured findings", () => {
  const { preparation } = fixture();
  const report = finalizeReview({ preparation, submission: cleanSubmission(preparation) });
  assert.equal(report.readiness.status, "PASS");
  assert.deepEqual(report.findings, []);
});

test("structured review unknowns preserve provenance and use their explicit disposition", () => {
  const { preparation } = fixture();
  const evidenceId = preparation.context.evidence[0]!.id;
  const base = cleanSubmission(preparation);
  const nonBlocking = createReviewUnknown({
    description: "Large-dataset behavior has not been measured.",
    disposition: "non-blocking",
    evidenceQuality: "direct",
    evidenceIds: [evidenceId],
    relatedAcceptanceCriterionIds: [],
    relatedRiskDomainIds: [],
    source: { reviewerId: "acceptance-reviewer" },
    impact: "The current functional result is evidenced, but scale behavior remains unmeasured.",
    reason: "The specification does not require a large-volume service level in this review target.",
  });
  const notice = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({ ...base, residualUnknowns: [nonBlocking] }),
  });
  assert.equal(notice.readiness.status, "PASS_WITH_FINDINGS");
  assert.deepEqual(notice.residualUnknowns, [nonBlocking]);
  assert.equal(notice.readiness.reasons.find((reason) => reason.code === "residual-unknown")?.blocking, false);

  const blocking = createReviewUnknown({
    disposition: "blocking",
    description: "Tenant isolation for the write could not be verified.",
    evidenceQuality: "insufficient",
    evidenceIds: [evidenceId],
    relatedAcceptanceCriterionIds: ["ac-register-package"],
    relatedRiskDomainIds: [preparation.context.securityDomains[0]!.id],
    source: { reviewerId: "acceptance-reviewer" },
    impact: "A critical cross-tenant write may remain reachable.",
    reason: "Required negative authorization evidence is absent.",
  });
  const blocked = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({ ...base, residualUnknowns: [blocking] }),
  });
  assert.equal(blocked.readiness.status, "BLOCKED");
  assert.deepEqual(blocked.residualUnknowns, [blocking]);
});

test("legacy v0.7 unknown strings remain readable and conservatively blocking", () => {
  const { preparation } = fixture();
  const report = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({
      ...cleanSubmission(preparation),
      residualUnknowns: ["Legacy unknown without an explicit disposition."],
    }),
  });
  assert.equal(report.readiness.status, "BLOCKED");
  assert.deepEqual(report.residualUnknowns, ["Legacy unknown without an explicit disposition."]);
});

test("a non-blocking unknown cannot hide insufficient evidence for a required criterion", () => {
  const { preparation } = fixture();
  const evidenceId = preparation.context.evidence[0]!.id;
  const submission = cleanSubmission(preparation);
  submission.acceptanceReviews[0] = {
    ...submission.acceptanceReviews[0]!,
    status: "insufficient-evidence",
    evidenceIds: [],
    rationale: "The required negative path has no evidence.",
  };
  submission.residualUnknowns = [createReviewUnknown({
    description: "The required negative path is unknown.",
    disposition: "non-blocking",
    evidenceQuality: "indirect",
    evidenceIds: [evidenceId],
    relatedAcceptanceCriterionIds: ["ac-register-package"],
    relatedRiskDomainIds: [],
    source: { reviewerId: "acceptance-reviewer" },
    impact: "The criterion may not hold.",
    reason: "The reviewer could not execute the negative path.",
  })];
  const report = finalizeReview({ preparation, submission });
  assert.equal(report.readiness.status, "BLOCKED");
  assert.ok(report.readiness.reasons.some((reason) => reason.code === "acceptance-not-satisfied" && reason.blocking));
  assert.ok(report.readiness.reasons.some((reason) => reason.code === "residual-unknown" && !reason.blocking));
});

test("review identities are independent of object key insertion order", () => {
  assert.equal(reviewDigest({ b: 2, a: { d: 4, c: 3 } }), "c461c47a9133");
  assert.equal(
    reviewDigest({ b: 2, a: { d: 4, c: 3 } }),
    reviewDigest({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("every candidate is challenged and a confirmed high finding blocks readiness", () => {
  const { preparation, path } = fixture();
  const finding = candidate(preparation, path);
  const clean = cleanSubmission(preparation);
  const submission = ReviewSubmissionSchema.parse({
    ...clean,
    acceptanceReviews: clean.acceptanceReviews.map((review) => ({
      ...review,
      status: "contradicted",
      candidateFindingIds: [finding.id],
      rationale: "Negative tenant isolation is contradicted by the changed authorization path.",
    })),
    candidates: [finding],
    findingVerifications: [{
      candidateId: finding.id,
      verifierId: "adversarial-reviewer",
      outcome: "confirmed",
      attemptedRefutation: "Inspected caller guards and searched for a resource-scoped policy and negative test.",
      contraryEvidenceIds: [],
      rationale: "No resource authorization or negative tenant test protects the reachable write.",
      evidenceQuality: "corroborated",
    }],
  });
  const report = finalizeReview({ preparation, submission });

  assert.equal(report.readiness.status, "BLOCKED");
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.blocking, true);
  assert.equal(report.findings[0]?.verificationOutcomes[0]?.outcome, "confirmed");
  assert.deepEqual(report.candidateFindings, [finding]);
  assert.equal(report.findingVerifications.length, 1);
  assert.deepEqual(report.findings[0]?.locations, finding.locations);
  assert.deepEqual(report.findings[0]?.proposedVerifications, [finding.proposedVerification]);
});

test("a confirmed non-blocking finding produces PASS_WITH_FINDINGS", () => {
  const { preparation, path } = fixture();
  const finding = candidate(preparation, path, { severity: "low", title: "Non-blocking maintainability issue" });
  const clean = cleanSubmission(preparation);
  const report = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({
      ...clean,
      candidates: [finding],
      findingVerifications: [{
        candidateId: finding.id,
        verifierId: "adversarial-reviewer",
        outcome: "confirmed",
        attemptedRefutation: "Inspected the changed implementation for an existing shared abstraction.",
        contraryEvidenceIds: [],
        rationale: "The duplication is directly present but does not invalidate required behavior.",
        evidenceQuality: "direct",
      }],
    }),
  });

  assert.equal(report.readiness.status, "PASS_WITH_FINDINGS");
  assert.equal(report.findings[0]?.blocking, false);
});

test("root-cause consolidation preserves multiple reviewer sources without text deduplication", () => {
  const { preparation, path } = fixture();
  const first = candidate(preparation, path, {
    reviewerId: "change-reviewer",
    lens: "change",
    title: "Cross-tenant write is reachable",
  });
  const second = candidate(preparation, path, { reviewerId: "security-reviewer", title: "Resource authorization is absent" });
  const clean = cleanSubmission(preparation);
  const verification = (value: ReviewFindingCandidate) => ({
    candidateId: value.id,
    verifierId: "adversarial-reviewer",
    outcome: "confirmed" as const,
    attemptedRefutation: "Inspected all known guards and negative tests.",
    contraryEvidenceIds: [],
    rationale: "The same structured authorization root cause remains reachable.",
    evidenceQuality: "corroborated" as const,
  });
  const report = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({
      ...clean,
      candidates: [first, second],
      findingVerifications: [verification(first), verification(second)],
    }),
  });

  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0]?.sourceReviewers, ["change-reviewer", "security-reviewer"]);
  assert.equal(report.findings[0]?.candidateIds.length, 2);
});

test("rejection requires contrary evidence and unverified candidates block", () => {
  const { preparation, path } = fixture();
  const finding = candidate(preparation, path);
  assert.throws(() => FindingVerificationSchema.parse({
    candidateId: finding.id,
    verifierId: "adversarial-reviewer",
    outcome: "rejected",
    attemptedRefutation: "Looked for a guard.",
    contraryEvidenceIds: [],
    rationale: "Claimed false positive without evidence.",
    evidenceQuality: "direct",
  }), /contrary evidence/);

  const clean = cleanSubmission(preparation);
  const report = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({ ...clean, candidates: [finding] }),
  });
  assert.equal(report.readiness.status, "BLOCKED");
  assert.ok(report.readiness.reasons.some((reason) => reason.code === "finding-not-verified"));
});

test("rejected candidates and their refutation remain reconstructable in the report", () => {
  const { preparation, path } = fixture();
  const finding = candidate(preparation, path);
  const clean = cleanSubmission(preparation);
  const contraryEvidenceId = preparation.context.evidence[0]!.id;
  const report = finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({
      ...clean,
      candidates: [finding],
      findingVerifications: [{
        candidateId: finding.id,
        verifierId: "adversarial-reviewer",
        outcome: "rejected",
        attemptedRefutation: "Traced the concrete resource authorization path and its negative test.",
        contraryEvidenceIds: [contraryEvidenceId],
        rationale: "Direct counterevidence proves the candidate failure path is denied.",
        evidenceQuality: "direct",
      }],
    }),
  });

  assert.equal(report.readiness.status, "PASS");
  assert.deepEqual(report.rejectedCandidateIds, [finding.id]);
  assert.deepEqual(report.candidateFindings, [finding]);
  assert.equal(report.findingVerifications[0]?.outcome, "rejected");
});

test("required not-applicable needs a defensible cross-project responsibility claim", () => {
  const { preparation } = fixture();
  const criterionId = preparation.context.acceptanceCriteria[0]!.id;
  const scopeEvidence = preparation.context.evidence.find((item) => ["artifact", "contract"].includes(item.kind))!;
  const weak = cleanSubmission(preparation);
  weak.acceptanceReviews[0] = {
    criterionId,
    status: "not-applicable",
    evidenceIds: [scopeEvidence.id],
    candidateFindingIds: [],
    rationale: "The criterion is claimed to belong to another project without a responsibility claim.",
  };
  assert.equal(finalizeReview({ preparation, submission: weak }).readiness.status, "BLOCKED");

  const legitimate = cleanSubmission(preparation);
  legitimate.acceptanceReviews[0] = {
    ...weak.acceptanceReviews[0],
    rationale: "The database invariant belongs to the backend target and is consumed here only through its contract.",
    scopeClaim: {
      basis: "cross-project-ownership",
      responsibleTarget: "backend-project",
      evidenceIds: [scopeEvidence.id],
      rationale: "The project contract assigns persistence of this invariant to the backend slice.",
      claimedByReviewerId: "acceptance-reviewer",
      verification: {
        verifierId: "security-reviewer",
        outcome: "confirmed",
        evidenceIds: [scopeEvidence.id],
        rationale: "The contract boundary corroborates ownership by the backend project.",
        evidenceQuality: "direct",
      },
    },
  };
  const weaklyVerified = structuredClone(legitimate);
  weaklyVerified.acceptanceReviews[0]!.scopeClaim!.verification.evidenceQuality = "indirect";
  assert.equal(finalizeReview({ preparation, submission: weaklyVerified }).readiness.status, "BLOCKED");

  const report = finalizeReview({ preparation, submission: legitimate });
  assert.equal(report.readiness.status, "PASS");
  assert.deepEqual(report.acceptanceReviews[0]?.scopeClaim, legitimate.acceptanceReviews[0]?.scopeClaim);
});

test("optional not-applicable without a scope claim is visible but non-blocking", () => {
  const { preparation } = fixture();
  const optionalPreparation = ReviewPreparationSchema.parse({
    ...preparation,
    context: {
      ...preparation.context,
      acceptanceCriteria: preparation.context.acceptanceCriteria.map((criterion) => ({ ...criterion, priority: "optional" })),
    },
  });
  const submission = cleanSubmission(optionalPreparation);
  submission.acceptanceReviews[0] = {
    ...submission.acceptanceReviews[0]!,
    status: "not-applicable",
    rationale: "The optional criterion is outside the observed target, but no formal ownership claim was supplied.",
  };
  const report = finalizeReview({ preparation: optionalPreparation, submission });
  assert.equal(report.readiness.status, "PASS_WITH_FINDINGS");
  assert.ok(report.readiness.reasons.some((reason) =>
    reason.code === "acceptance-not-applicable-unsubstantiated" && !reason.blocking));
});

test("adversarial provenance distinguishes logical separation from an independent invocation", () => {
  const { preparation, path } = fixture();
  const contextDigest = `sha256:${reviewDigest(preparation.context, 64)}`;
  const finding = candidate(preparation, path, { runId: "candidate-run" });
  const submission = cleanSubmission(preparation);
  submission.reviewerRuns = submission.reviewerRuns.map((run) => run.reviewerId === "security-reviewer" ? {
    ...run,
    runId: "candidate-run",
    provenance: {
      invocationId: "provider-invocation-1",
      adapterId: "test-adapter",
      model: { id: "test-model", version: null },
      contextDigest,
    },
  } : run);
  submission.reviewerRuns.push({
    reviewerId: "adversarial-reviewer",
    lens: "adversarial",
    provider: "fake-provider",
    runId: "verification-run",
    provenance: {
      invocationId: "provider-invocation-2",
      adapterId: "test-adapter",
      model: { id: "test-model", version: null },
      contextDigest,
    },
    reviewedEvidenceIds: [preparation.context.evidence[0]!.id],
    completed: true,
  });
  submission.candidates = [finding];
  submission.findingVerifications = [{
    candidateId: finding.id,
    verifierId: "adversarial-reviewer",
    runId: "verification-run",
    outcome: "rejected",
    attemptedRefutation: "Traced the resource guard and its negative test.",
    contraryEvidenceIds: [preparation.context.evidence[0]!.id],
    rationale: "Counterevidence proves the proposed failure path is denied.",
    evidenceQuality: "direct",
  }];
  const report = finalizeReview({ preparation, submission });
  assert.equal(report.adversarialProvenance?.[0]?.separation, "independent-invocation");
  assert.equal(report.adversarialProvenance?.[0]?.providerIndependence, "not-claimed");
  assert.equal(report.submissionDigest, `sha256:${reviewDigest(submission, 64)}`);
  assert.equal(report.findingVerifications[0]?.runId, "verification-run");

  const sameInvocation = ReviewSubmissionSchema.parse({
    ...submission,
    reviewerRuns: submission.reviewerRuns.map((run) => run.runId === "verification-run"
      ? { ...run, provenance: { ...run.provenance!, invocationId: "provider-invocation-1" } }
      : run),
  });
  assert.equal(
    finalizeReview({ preparation, submission: sameInvocation }).adversarialProvenance?.[0]?.separation,
    "logical-only",
  );
});

test("the same logical reviewer cannot verify its own candidate", () => {
  const { preparation, path } = fixture();
  const finding = candidate(preparation, path);
  assert.throws(() => finalizeReview({
    preparation,
    submission: ReviewSubmissionSchema.parse({
      ...cleanSubmission(preparation),
      candidates: [finding],
      findingVerifications: [{
        candidateId: finding.id,
        verifierId: finding.source.reviewerId,
        outcome: "confirmed",
        attemptedRefutation: "Attempted to challenge the candidate.",
        contraryEvidenceIds: [],
        rationale: "The failure path remains reachable.",
        evidenceQuality: "direct",
      }],
    }),
  }), /different reviewer/);
});

test("risk coverage records unmapped evidence and requires an explicit evidence-backed disposition", () => {
  const { preparation } = fixture({ includeUnmappedSurface: true });
  assert.equal(preparation.context.riskCoverage?.status, "incomplete");
  assert.equal(preparation.context.riskCoverage?.gaps.length, 1);
  assert.ok(preparation.context.securityDomains.some((domain) => domain.id === "authorization"));
  assert.ok(!preparation.context.securityDomains.some((domain) => domain.id === "secrets-and-provider-permissions"));
  const gap = preparation.context.riskCoverage!.gaps[0]!;

  const unassessed = finalizeReview({ preparation, submission: cleanSubmission(preparation) });
  assert.equal(unassessed.readiness.status, "BLOCKED");
  assert.ok(unassessed.readiness.reasons.some((reason) => reason.code === "risk-coverage-unassessed"));

  const low = cleanSubmission(preparation);
  low.riskCoverageReviews = [{
    gapId: gap.id,
    reviewerId: "security-reviewer",
    impact: "low",
    disposition: "non-blocking",
    evidenceQuality: "direct",
    evidenceIds: gap.evidenceIds,
    rationale: "The boundary is read-only and has no sensitive data or external effect in the reviewed scope.",
  }];
  const notice = finalizeReview({ preparation, submission: low });
  assert.equal(notice.readiness.status, "PASS_WITH_FINDINGS");
  assert.deepEqual(notice.riskCoverageReviews, low.riskCoverageReviews);

  const critical = cleanSubmission(preparation);
  critical.riskCoverageReviews = [{
    ...low.riskCoverageReviews![0]!,
    impact: "critical",
    disposition: "blocking",
    rationale: "The unmapped boundary can cross tenant-owned secrets into an external system.",
  }];
  assert.equal(finalizeReview({ preparation, submission: critical }).readiness.status, "BLOCKED");
  assert.throws(() => ReviewSubmissionSchema.parse({
    ...critical,
    riskCoverageReviews: [{ ...critical.riskCoverageReviews![0]!, disposition: "non-blocking" }],
  }), /Critical coverage uncertainty must be blocking/);
});

test("historical v0.7 reports remain loadable without v0.7.1 additive fields", () => {
  const { preparation } = fixture();
  const report = finalizeReview({ preparation, submission: cleanSubmission(preparation) });
  const legacy = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  delete legacy.submissionDigest;
  delete legacy.adversarialProvenance;
  delete legacy.riskCoverageReviews;
  legacy.residualUnknowns = ["Historical v0.7 unknown."];
  const parsed = ReviewReportSchema.parse(legacy);
  assert.deepEqual(parsed.residualUnknowns, ["Historical v0.7 unknown."]);
});

test("initial review preparation and report are immutable create-only artifacts", () => {
  const { root, preparation } = fixture();
  const report = finalizeReview({ preparation, submission: cleanSubmission(preparation) });
  const first = buildReviewArtifactOperations(root, preparation, report);
  assert.ok(first.every((operation) => operation.action === "create"));
  applyReviewArtifactOperations(root, first);
  assert.equal(loadReviewPreparation(root, preparation.context.id).id, preparation.id);
  const repeated = buildReviewArtifactOperations(root, preparation, report);
  assert.ok(repeated.every((operation) => operation.action === "unchanged"));
  const conflict = buildReviewArtifactOperations(root, {
    ...preparation,
    reasons: [{ code: "source-drift", message: "Changed after persistence.", blocking: true }],
    status: "blocked",
  }, report);
  assert.ok(conflict.some((operation) => operation.action === "conflict"));
  assert.throws(() => applyReviewArtifactOperations(root, conflict), /conflict/);
});

test("review CLI finalizes and persists a provider-neutral submission", () => {
  const { root, preparation } = fixture();
  applyReviewArtifactOperations(root, buildReviewArtifactOperations(root, preparation));
  write(root, "review-submission.json", `${JSON.stringify(cleanSubmission(preparation), null, 2)}\n`);
  let stdout = "";
  let stderr = "";
  const status = runCli(
    ["review", ".", "--submission", "review-submission.json", "--json"],
    { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } },
    { cwd: root, version: "0.7.0" },
  );

  assert.equal(status, 0, stderr);
  const output = JSON.parse(stdout) as { report: { readiness: { status: string } }; operations: Array<Record<string, unknown>> };
  assert.equal(output.report.readiness.status, "PASS");
  assert.ok(output.operations.every((operation) => !("content" in operation)));
  assert.ok(output.operations.some((operation) => String(operation.artifact).includes("/reports/")));
});
