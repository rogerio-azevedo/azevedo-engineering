import type {
  FindingVerification,
  ReviewContext,
  ReviewFindingCandidate,
} from "./review-contracts.js";

export type ReviewLens = "change" | "acceptance" | "security";

/**
 * A coding-agent adapter may implement this interface, but the core never names
 * or invokes a concrete provider. Candidate production is intentionally
 * separate from adversarial verification.
 */
export interface ReviewCandidateProvider {
  readonly providerId: string;
  review(context: ReviewContext, lens: ReviewLens): Promise<readonly ReviewFindingCandidate[]>;
}

/** A different reviewer instance should challenge candidates whenever possible. */
export interface FindingVerificationProvider {
  readonly providerId: string;
  verify(context: ReviewContext, candidate: ReviewFindingCandidate): Promise<FindingVerification>;
}
