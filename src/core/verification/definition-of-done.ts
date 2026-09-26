import type { EvidenceRecord, Finding, SubjectRevision, TddDecision, Waiver } from "../schemas/evidence.js";

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

function waiverIsValid(waiver: Waiver, verifierId: string, now: Date): boolean {
  return waiver.targetId === verifierId && (!waiver.expiresAt || new Date(waiver.expiresAt) > now);
}

export function evaluateDefinitionOfDone(input: {
  requiredVerifierIds: readonly string[];
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
      } else if (!sameRevision(record.subjectRevision, input.subjectRevision)) {
        reasons.push(`Acceptance criterion ${criterion.id} references stale evidence ${evidenceId}.`);
      } else if (record.status === "fail" || record.status === "skipped") {
        reasons.push(`Acceptance criterion ${criterion.id} references ${record.status} evidence ${evidenceId}.`);
      }
    }
  }

  for (const verifierId of input.requiredVerifierIds) {
    const record = [...input.evidence].reverse().find((candidate) => candidate.verifierId === verifierId);
    if (!record) {
      reasons.push(`Required verifier ${verifierId} has no evidence.`);
      continue;
    }
    if (!sameRevision(record.subjectRevision, input.subjectRevision)) {
      reasons.push(`Evidence for ${verifierId} belongs to a different revision.`);
    }
    if (record.status === "fail" || record.status === "skipped") {
      reasons.push(`Required verifier ${verifierId} is ${record.status}.`);
    }
    if (record.status === "waived") {
      const waiver = input.waivers.find((candidate) => candidate.id === record.waiverId);
      if (!waiver || !waiverIsValid(waiver, verifierId, now)) {
        reasons.push(`Required verifier ${verifierId} has no valid waiver.`);
      }
    }
    if (record.status === "not_applicable" && !record.reason) {
      reasons.push(`Required verifier ${verifierId} is not applicable without a reason.`);
    }
  }

  for (const finding of input.findings) {
    if (finding.status === "open" && (finding.severity === "critical" || finding.severity === "high")) {
      reasons.push(`Blocking finding ${finding.id} remains open.`);
    }
  }

  if (input.tddDecision.status === "applied" && input.tddDecision.expectation === "required") {
    if (!input.tddDecision.redEvidenceId || !input.tddDecision.greenEvidenceId) {
      reasons.push("Required TDD was marked applied without RED and GREEN evidence.");
    }
  }
  if (input.tddDecision.status === "waived") {
    const waiver = input.waivers.find((candidate) => candidate.id === input.tddDecision.waiverId);
    if (!waiver || !waiverIsValid(waiver, "process.tdd", now)) {
      reasons.push("The TDD waiver is missing or invalid.");
    }
  }

  return { ready: reasons.length === 0, reasons };
}
