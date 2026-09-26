import type { EvidenceRecord, Finding, SubjectRevision, TddDecision, Waiver } from "../schemas/evidence.js";
import { verificationTargetId, type VerificationTarget } from "./verification-plan.js";

export type AcceptanceCriterion = {
  id: string;
  satisfied: boolean;
  evidenceIds: string[];
};

export type DefinitionOfDoneResult = {
  ready: boolean;
  reasons: string[];
};

function sameRevision(left: SubjectRevision, right: SubjectRevision): boolean {
  return left.head === right.head && left.worktreeDigest === right.worktreeDigest && left.dirty === right.dirty;
}

function waiverIsValid(
  waiver: Waiver,
  target: { taskId: string; targetId: string; scope: string },
  now: Date,
): boolean {
  return waiver.taskId === target.taskId &&
    waiver.targetId === target.targetId &&
    waiver.scope === target.scope &&
    (!waiver.expiresAt || new Date(waiver.expiresAt) > now);
}

function validateEvidenceDisposition(
  record: EvidenceRecord,
  waivers: readonly Waiver[],
  now: Date,
): string | null {
  if (record.status === "fail" || record.status === "skipped") return `is ${record.status}`;
  if (record.status === "waived") {
    const waiver = waivers.find((candidate) => candidate.id === record.waiverId);
    if (!waiver || !waiverIsValid(waiver, {
      taskId: record.taskId,
      targetId: verificationTargetId({ verifierId: record.verifierId, scope: record.scope }),
      scope: record.scope,
    }, now)) return "has no valid task/target/scope waiver";
  }
  return null;
}

function validateTddEvidence(input: {
  taskId: string;
  decision: TddDecision;
  evidence: readonly EvidenceRecord[];
  subjectRevision: SubjectRevision;
}): string[] {
  const reasons: string[] = [];
  const { decision } = input;
  if (decision.taskId !== input.taskId) return ["The TDD decision belongs to a different task."];
  if (decision.status !== "applied") return reasons;

  const red = input.evidence.find((record) => record.id === decision.redEvidenceId);
  const green = input.evidence.find((record) => record.id === decision.greenEvidenceId);
  if (!red) reasons.push(`TDD RED evidence ${String(decision.redEvidenceId)} does not exist.`);
  if (!green) reasons.push(`TDD GREEN evidence ${String(decision.greenEvidenceId)} does not exist.`);
  if (!red || !green) return reasons;

  if (red.taskId !== input.taskId || green.taskId !== input.taskId) {
    reasons.push("TDD evidence belongs to a different task.");
  }
  if (red.phase !== "tdd-red" || red.status !== "fail") {
    reasons.push("TDD RED evidence must be a failed tdd-red execution.");
  }
  if (!red.command || red.exitCode === null || red.exitCode === 0) {
    reasons.push("TDD RED evidence must record a real command with a non-zero exit code.");
  }
  if (green.phase !== "tdd-green" || green.status !== "pass") {
    reasons.push("TDD GREEN evidence must be a passing tdd-green execution.");
  }
  if (!green.command || green.exitCode !== 0) {
    reasons.push("TDD GREEN evidence must record a real command with exit code zero.");
  }
  if (red.verifierId !== green.verifierId || red.scope !== green.scope || red.scope !== decision.scope) {
    reasons.push("TDD RED and GREEN must execute the same verifier and scope declared by the decision.");
  }
  if (!sameRevision(green.subjectRevision, input.subjectRevision)) {
    reasons.push("TDD GREEN evidence belongs to a different final revision.");
  }
  if (sameRevision(red.subjectRevision, input.subjectRevision)) {
    reasons.push("TDD RED evidence must describe the pre-fix revision, not the final revision.");
  }
  if (new Date(red.startedAt) >= new Date(green.startedAt)) {
    reasons.push("TDD RED evidence must precede GREEN evidence.");
  }
  return reasons;
}

export function evaluateDefinitionOfDone(input: {
  taskId: string;
  requiredTargets: readonly VerificationTarget[];
  evidence: readonly EvidenceRecord[];
  findings: readonly Finding[];
  waivers: readonly Waiver[];
  acceptanceCriteria: readonly AcceptanceCriterion[];
  tddDecision: TddDecision;
  subjectRevision: SubjectRevision;
  now?: Date;
}): DefinitionOfDoneResult {
  const reasons: string[] = [];
  const now = input.now ?? new Date();

  for (const criterion of input.acceptanceCriteria) {
    if (!criterion.satisfied || criterion.evidenceIds.length === 0) {
      reasons.push(`Acceptance criterion ${criterion.id} lacks satisfied evidence.`);
      continue;
    }
    for (const evidenceId of criterion.evidenceIds) {
      const record = input.evidence.find((candidate) => candidate.id === evidenceId);
      if (!record) {
        reasons.push(`Acceptance criterion ${criterion.id} references missing evidence ${evidenceId}.`);
      } else if (record.taskId !== input.taskId) {
        reasons.push(`Acceptance criterion ${criterion.id} references evidence from a different task.`);
      } else if (!sameRevision(record.subjectRevision, input.subjectRevision)) {
        reasons.push(`Acceptance criterion ${criterion.id} references stale evidence ${evidenceId}.`);
      } else {
        const invalid = validateEvidenceDisposition(record, input.waivers, now);
        if (invalid) reasons.push(`Acceptance criterion ${criterion.id} references evidence ${evidenceId} that ${invalid}.`);
      }
    }
  }

  for (const target of input.requiredTargets) {
    const record = [...input.evidence].reverse().find((candidate) =>
      candidate.taskId === input.taskId &&
      candidate.verifierId === target.verifierId &&
      candidate.scope === target.scope &&
      candidate.phase === "verification",
    );
    const targetLabel = verificationTargetId(target);
    if (!record) {
      reasons.push(`Required target ${targetLabel} has no evidence.`);
      continue;
    }
    if (!sameRevision(record.subjectRevision, input.subjectRevision)) {
      reasons.push(`Evidence for ${targetLabel} belongs to a different revision.`);
    }
    const invalid = validateEvidenceDisposition(record, input.waivers, now);
    if (invalid) reasons.push(`Required target ${targetLabel} ${invalid}.`);
  }

  for (const finding of input.findings) {
    if (
      finding.taskId === input.taskId &&
      finding.status === "open" &&
      (finding.severity === "critical" || finding.severity === "high")
    ) {
      reasons.push(`Blocking finding ${finding.id} remains open.`);
    }
  }

  reasons.push(...validateTddEvidence({
    taskId: input.taskId,
    decision: input.tddDecision,
    evidence: input.evidence,
    subjectRevision: input.subjectRevision,
  }));

  if (input.tddDecision.status === "waived") {
    const waiver = input.waivers.find((candidate) => candidate.id === input.tddDecision.waiverId);
    if (!waiver || !waiverIsValid(waiver, {
      taskId: input.taskId,
      targetId: verificationTargetId({ verifierId: "process.tdd", scope: input.tddDecision.scope }),
      scope: input.tddDecision.scope,
    }, now)) {
      reasons.push("The TDD waiver is missing or invalid for this task and scope.");
    }
  }

  return { ready: reasons.length === 0, reasons };
}
