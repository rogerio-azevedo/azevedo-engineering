import { createHash } from "node:crypto";
import {
  type ExecutionContext,
  ExecutionSessionSchema,
  type ExecutionSession,
} from "./execution-contracts.js";

export type SessionUpdate = Pick<ExecutionSession,
  "status" | "after" | "attempts" | "changes" | "scopeExpansions" | "verificationEvidence" | "acceptanceCoverage" | "decisions">;

export function createExecutionSessionSnapshot(previous: ExecutionSession, update: SessionUpdate): ExecutionSession {
  const parsed = ExecutionSessionSchema.parse(previous);
  if (["completed", "failed", "blocked"].includes(parsed.status)) {
    throw new Error(`Cannot append to terminal execution session ${parsed.id}.`);
  }
  const preservesPrefix = <T>(before: readonly T[], after: readonly T[]): boolean =>
    after.length >= before.length && JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before);
  if (
    !preservesPrefix(parsed.attempts, update.attempts) ||
    !preservesPrefix(parsed.changes, update.changes) ||
    !preservesPrefix(parsed.scopeExpansions, update.scopeExpansions) ||
    !preservesPrefix(parsed.verificationEvidence, update.verificationEvidence) ||
    !preservesPrefix(parsed.decisions, update.decisions)
  ) throw new Error("Session history is append-only.");
  const sequence = parsed.snapshotSequence + 1;
  const snapshotId = `execution-snapshot-${sequence}-${createHash("sha256")
    .update(JSON.stringify({ executionId: parsed.id, sequence, update })).digest("hex").slice(0, 10)}`;
  return ExecutionSessionSchema.parse({
    ...parsed,
    ...update,
    snapshotSequence: sequence,
    parentSnapshotId: parsed.snapshotId,
    snapshotId,
  });
}

export function renderExecutionSummary(session: ExecutionSession, context: ExecutionContext): string {
  const parsed = ExecutionSessionSchema.parse(session);
  if (parsed.contextId !== context.id) throw new Error("Execution summary context does not belong to the session.");
  const lines = (values: readonly string[]) => values.length > 0
    ? values.map((value) => `- ${value}`).join("\n") : "- none";
  const implemented = parsed.acceptanceCoverage
    .filter((item) => ["implemented", "verified", "implemented-but-unverified"].includes(item.state))
    .map((item) => `${item.criterionId}: ${item.state}`);
  const unverified = parsed.acceptanceCoverage
    .filter((item) => item.state !== "verified")
    .map((item) => `${item.criterionId}: ${item.state} — ${item.note}`);
  return [
    "# Execution Summary",
    `Status: ${parsed.status}`,
    "## Implemented", lines(implemented),
    "## Files changed", lines(parsed.changes.map((item) => `${item.kind}: ${item.path} (attempt ${item.attempt})`)),
    "## Acceptance criteria", lines(parsed.acceptanceCoverage.map((item) => `${item.criterionId}: ${item.state}`)),
    "## Verification", lines(parsed.verificationEvidence.map((item) => `${item.verifierId}::${item.scope}: ${item.status} — ${item.summary}`)),
    "## Remaining risks", lines(context.risks.findings.map((item) => `${item.signal}: ${item.reason}`)),
    "## Unverified", lines(unverified),
    "## Human review recommended", "- yes; v0.6 does not provide a full reviewer runtime",
  ].join("\n\n") + "\n";
}
