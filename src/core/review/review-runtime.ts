import {
  CorrectionPolicySchema,
  ReviewFindingCandidateSchema,
  ReviewPreparationSchema,
  ReviewReportSchema,
  ReviewSubmissionSchema,
  reviewDigest,
  type ConsolidatedFinding,
  type ReviewFindingCandidate,
  type ReviewPreparation,
  type ReviewReadiness,
  type ReviewReport,
  type ReviewSubmission,
} from "./review-contracts.js";

const SEVERITY_ORDER = ["low", "medium", "high", "critical"] as const;
const ATTRIBUTION_ORDER = ["pre-existing-unrelated", "unknown", "exposed", "introduced"] as const;

export function createReviewFindingCandidate(
  input: Omit<ReviewFindingCandidate, "schemaVersion" | "id" | "status">,
): ReviewFindingCandidate {
  const seed = { schemaVersion: 1 as const, status: "candidate" as const, ...input };
  return ReviewFindingCandidateSchema.parse({
    ...seed,
    id: `finding-candidate-${reviewDigest(seed)}`,
  });
}

function validateSubmission(preparation: ReviewPreparation, submission: ReviewSubmission): void {
  const context = preparation.context;
  if (submission.contextId !== context.id) throw new Error("Review submission belongs to a different context.");
  const evidenceIds = new Set(context.evidence.map((item) => item.id));
  const boundaryIds = new Set(context.trustBoundaries.map((item) => item.id));
  const criterionIds = new Set(context.acceptanceCriteria.map((item) => item.id));
  const changePaths = new Set(context.changeSet.files.map((item) => item.path));
  const planStepIds = new Set(context.changeSet.files.flatMap((item) => item.planStepIds));
  const completedReviewerRuns = new Set<string>();
  const candidateById = new Map(submission.candidates.map((candidate) => [candidate.id, candidate]));
  for (const run of submission.reviewerRuns) {
    for (const id of run.reviewedEvidenceIds) if (!evidenceIds.has(id)) throw new Error(
      `Reviewer ${run.reviewerId} cites unknown review evidence ${id}.`,
    );
    if (run.completed) completedReviewerRuns.add(`${run.reviewerId}:${run.lens}`);
  }
  const candidateIds = new Set<string>();
  for (const candidate of submission.candidates) {
    const { id: candidateId, schemaVersion: _schemaVersion, status: _status, ...candidateInput } = candidate;
    if (createReviewFindingCandidate(candidateInput).id !== candidateId) throw new Error(
      `Finding candidate ${candidateId} does not match its deterministic content identity.`,
    );
    if (candidateIds.has(candidate.id)) throw new Error(`Duplicate finding candidate: ${candidate.id}.`);
    candidateIds.add(candidate.id);
    if (!completedReviewerRuns.has(`${candidate.source.reviewerId}:${candidate.source.lens}`)) throw new Error(
      `Finding ${candidate.id} has no completed reviewer run for its source and lens.`,
    );
    for (const id of candidate.evidenceIds) if (!evidenceIds.has(id)) throw new Error(
      `Finding ${candidate.id} cites unknown review evidence ${id}.`,
    );
    for (const id of candidate.acceptanceCriterionIds) if (!criterionIds.has(id)) throw new Error(
      `Finding ${candidate.id} cites unknown acceptance criterion ${id}.`,
    );
    for (const id of candidate.trustBoundaryIds) if (!boundaryIds.has(id)) throw new Error(
      `Finding ${candidate.id} cites unknown trust boundary ${id}.`,
    );
    for (const path of candidate.executionChangePaths) if (!changePaths.has(path)) throw new Error(
      `Finding ${candidate.id} cites a path outside the captured change set: ${path}.`,
    );
    for (const id of candidate.planStepIds) if (!planStepIds.has(id)) throw new Error(
      `Finding ${candidate.id} cites an unknown plan step: ${id}.`,
    );
    if (candidate.rootCause.trustBoundaryId && !boundaryIds.has(candidate.rootCause.trustBoundaryId)) throw new Error(
      `Finding ${candidate.id} has an unknown root-cause trust boundary.`,
    );
  }
  const verificationIds = new Set<string>();
  for (const verification of submission.findingVerifications) {
    if (!candidateIds.has(verification.candidateId)) throw new Error(
      `Finding verification cites unknown candidate ${verification.candidateId}.`,
    );
    if (verificationIds.has(verification.candidateId)) throw new Error(
      `Candidate ${verification.candidateId} has more than one adversarial verification.`,
    );
    if (candidateById.get(verification.candidateId)?.source.reviewerId === verification.verifierId) throw new Error(
      `Candidate ${verification.candidateId} must be challenged by a different reviewer.`,
    );
    verificationIds.add(verification.candidateId);
    for (const id of verification.contraryEvidenceIds) if (!evidenceIds.has(id)) throw new Error(
      `Finding verification cites unknown contrary evidence ${id}.`,
    );
  }
  const reviewedCriteria = new Set<string>();
  for (const review of submission.acceptanceReviews) {
    if (!criterionIds.has(review.criterionId)) throw new Error(`Unknown reviewed acceptance criterion ${review.criterionId}.`);
    if (reviewedCriteria.has(review.criterionId)) throw new Error(`Acceptance criterion reviewed twice: ${review.criterionId}.`);
    reviewedCriteria.add(review.criterionId);
    for (const id of review.evidenceIds) if (!evidenceIds.has(id)) throw new Error(
      `Acceptance review cites unknown evidence ${id}.`,
    );
    for (const id of review.candidateFindingIds) if (!candidateIds.has(id)) throw new Error(
      `Acceptance review cites unknown finding candidate ${id}.`,
    );
  }
}

function consolidateConfirmed(
  submission: ReviewSubmission,
): ConsolidatedFinding[] {
  const candidates = new Map(submission.candidates.map((candidate) => [candidate.id, candidate]));
  const confirmed = submission.findingVerifications
    .filter((verification) => verification.outcome === "confirmed")
    .map((verification) => ({ verification, candidate: candidates.get(verification.candidateId)! }));
  const groups = new Map<string, typeof confirmed>();
  for (const item of confirmed) groups.set(item.candidate.rootCause.key, [
    ...(groups.get(item.candidate.rootCause.key) ?? []),
    item,
  ]);
  return [...groups.entries()].map(([rootCauseKey, items]) => {
    const rootCause = items[0]!.candidate.rootCause;
    if (items.some((item) => JSON.stringify(item.candidate.rootCause) !== JSON.stringify(rootCause))) {
      throw new Error(`Candidates sharing root cause key ${rootCauseKey} disagree on structured root-cause identity.`);
    }
    const severity = items.map((item) => item.candidate.severity)
      .sort((left, right) => SEVERITY_ORDER.indexOf(right) - SEVERITY_ORDER.indexOf(left))[0]!;
    const attribution = items.map((item) => item.candidate.attribution)
      .sort((left, right) => ATTRIBUTION_ORDER.indexOf(right) - ATTRIBUTION_ORDER.indexOf(left))[0]!;
    const candidateIds = items.map((item) => item.candidate.id).sort();
    const blocking = ["critical", "high"].includes(severity) && attribution !== "pre-existing-unrelated";
    const seed = {
      rootCause,
      candidateIds,
      severity,
      attribution,
    };
    return {
      id: `review-finding-${reviewDigest(seed)}`,
      rootCause,
      title: items[0]!.candidate.title,
      severity,
      status: "open" as const,
      blocking,
      attribution,
      candidateIds,
      verificationOutcomes: items.map((item) => item.verification),
      sourceReviewers: [...new Set(items.map((item) => item.candidate.source.reviewerId))].sort(),
      evidenceIds: [...new Set(items.flatMap((item) => item.candidate.evidenceIds))].sort(),
      acceptanceCriterionIds: [...new Set(items.flatMap((item) => item.candidate.acceptanceCriterionIds))].sort(),
      planStepIds: [...new Set(items.flatMap((item) => item.candidate.planStepIds))].sort(),
      executionChangePaths: [...new Set(items.flatMap((item) => item.candidate.executionChangePaths))].sort(),
      trustBoundaryIds: [...new Set(items.flatMap((item) => item.candidate.trustBoundaryIds))].sort(),
      locations: [...new Map(items.flatMap((item) => item.candidate.locations).map((location) => [
        JSON.stringify(location), location,
      ])).values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      failureScenarios: items.map((item) => item.candidate.failureScenario),
      impacts: [...new Set(items.map((item) => item.candidate.impact))].sort(),
      recommendedAction: [...new Set(items.map((item) => item.candidate.recommendedAction))].join(" "),
      proposedVerifications: [...new Set(items.map((item) => item.candidate.proposedVerification))].sort(),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function evaluateReadiness(
  preparation: ReviewPreparation,
  submission: ReviewSubmission,
  findings: readonly ConsolidatedFinding[],
): ReviewReadiness {
  const reasons: ReviewReadiness["reasons"] = [];
  if (preparation.status === "blocked") reasons.push({
    code: "preparation-blocked",
    message: preparation.reasons.filter((reason) => reason.blocking).map((reason) => reason.message).join(" "),
    blocking: true,
  });
  const completedLenses = new Set(submission.reviewerRuns.filter((run) => run.completed).map((run) => run.lens));
  for (const lens of preparation.context.requiredLenses) if (!completedLenses.has(lens)) reasons.push({
    code: "required-review-missing",
    message: `Required ${lens} review did not complete.`,
    blocking: true,
  });
  const reviewByCriterion = new Map(submission.acceptanceReviews.map((review) => [review.criterionId, review]));
  for (const criterion of preparation.context.acceptanceCriteria) {
    const review = reviewByCriterion.get(criterion.id);
    const acceptable = review?.status === "satisfied" || review?.status === "not-applicable";
    if (!review || (criterion.priority === "required" && !acceptable)) reasons.push({
      code: "acceptance-not-satisfied",
      message: `${criterion.id} is ${review?.status ?? "not-reviewed"}.`,
      blocking: criterion.priority === "required",
    });
    else if (!acceptable) reasons.push({
      code: "acceptance-not-satisfied",
      message: `${criterion.id} is ${review.status}.`,
      blocking: false,
    });
  }
  const verifiedCandidates = new Set(submission.findingVerifications.map((item) => item.candidateId));
  for (const candidate of submission.candidates) if (!verifiedCandidates.has(candidate.id)) reasons.push({
    code: "finding-not-verified",
    message: `Finding candidate ${candidate.id} has no adversarial verification.`,
    blocking: true,
  });
  for (const verification of submission.findingVerifications.filter((item) => item.outcome === "insufficient-evidence")) reasons.push({
    code: "finding-not-verified",
    message: `Finding candidate ${verification.candidateId} remains insufficiently evidenced.`,
    blocking: true,
  });
  for (const finding of findings.filter((item) => item.blocking && item.status === "open")) reasons.push({
    code: "blocking-finding",
    message: `${finding.id} is an open ${finding.severity} finding.`,
    blocking: true,
  });
  if (submission.residualUnknowns.length > 0) reasons.push({
    code: "residual-unknown",
    message: submission.residualUnknowns.join(" "),
    blocking: true,
  });
  const blocked = reasons.some((reason) => reason.blocking);
  return {
    status: blocked ? "BLOCKED" : findings.length > 0 || reasons.length > 0 ? "PASS_WITH_FINDINGS" : "PASS",
    reasons,
  };
}

export function finalizeReview(input: {
  preparation: ReviewPreparation;
  submission: ReviewSubmission;
  correctionPolicy?: Parameters<typeof CorrectionPolicySchema.parse>[0] | null;
}): ReviewReport {
  const preparation = ReviewPreparationSchema.parse(input.preparation);
  const submission = ReviewSubmissionSchema.parse(input.submission);
  validateSubmission(preparation, submission);
  const findings = consolidateConfirmed(submission);
  const readiness = evaluateReadiness(preparation, submission, findings);
  const rejectedCandidateIds = submission.findingVerifications
    .filter((item) => item.outcome === "rejected").map((item) => item.candidateId).sort();
  const insufficientCandidateIds = submission.findingVerifications
    .filter((item) => item.outcome === "insufficient-evidence").map((item) => item.candidateId).sort();
  const correctionPolicy = input.correctionPolicy === undefined || input.correctionPolicy === null
    ? null : CorrectionPolicySchema.parse(input.correctionPolicy);
  const seed = {
    schemaVersion: 1 as const,
    kind: "review-report" as const,
    sequence: 1,
    parentReportId: null,
    contextId: preparation.context.id,
    initial: true,
    readiness,
    acceptanceReviews: submission.acceptanceReviews,
    candidateFindings: submission.candidates,
    findingVerifications: submission.findingVerifications,
    findings,
    rejectedCandidateIds,
    insufficientCandidateIds,
    reviewerRuns: submission.reviewerRuns,
    residualUnknowns: submission.residualUnknowns,
    correctionPolicy,
    correctionAttempts: [],
  };
  return ReviewReportSchema.parse({
    ...seed,
    id: `review-report-1-${reviewDigest(seed)}`,
  });
}

export function createReviewReportSnapshot(
  previous: ReviewReport,
  update: Pick<ReviewReport, "readiness" | "findings" | "acceptanceReviews" | "reviewerRuns" | "residualUnknowns" | "correctionAttempts">,
): ReviewReport {
  const parsed = ReviewReportSchema.parse(previous);
  if (!parsed.correctionPolicy) throw new Error("Review report has no explicit correction policy.");
  if (update.correctionAttempts.length < parsed.correctionAttempts.length ||
    JSON.stringify(update.correctionAttempts.slice(0, parsed.correctionAttempts.length)) !== JSON.stringify(parsed.correctionAttempts)) {
    throw new Error("Correction attempt history is append-only.");
  }
  const sequence = parsed.sequence + 1;
  const seed = {
    ...parsed,
    ...update,
    sequence,
    parentReportId: parsed.id,
    initial: false,
  };
  return ReviewReportSchema.parse({
    ...seed,
    id: `review-report-${sequence}-${reviewDigest(seed)}`,
  });
}
