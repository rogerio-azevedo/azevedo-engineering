import type { ProjectContext } from "../core/project/contracts.js";
import type { OnboardReport } from "../core/project/onboard-project.js";

export function renderHumanOnboard(report: OnboardReport): string {
  const lines = [
    `Outcome: ${report.outcome}`,
    `Project: ${report.projectId ?? "(none)"}`,
    `Snapshot: ${report.snapshotId ?? "(none)"}`,
    `Registry: ${report.registryRoot}`,
    `Repositories: ${report.summary.repositories}`,
    `Facts: ${report.summary.facts}`,
    `Unknowns: ${report.summary.unknowns}`,
    `Sensitive paths: ${report.summary.sensitivePaths}`,
  ];
  if (report.reason) lines.push(`Reason: ${report.reason}`);
  lines.push("Onboarding is read-only for the target. Project context does not authorize mutation.");
  return `${lines.join("\n")}\n`;
}

export function renderHumanProjectList(projects: readonly { projectId: string; name: string; snapshotId: string }[]): string {
  if (projects.length === 0) return "No known projects.\n";
  return `${projects.map((project) => `${project.projectId}  ${project.name}  ${project.snapshotId}`).join("\n")}\n`;
}

export function renderHumanProjectContext(context: ProjectContext): string {
  const lines = [
    `Project: ${context.projectId}`,
    `Name: ${context.name}`,
    `Layout: ${context.layout}`,
    `Snapshot: ${context.snapshotId}`,
    "",
    "Repositories:",
    ...context.repositories.map((repository) =>
      `  ${repository.repositoryId}  role=unknown  revision=${repository.snapshotRevision ?? "none"}  available=${repository.available}`),
    "",
    `Current facts: ${context.facts.current.length}`,
    `Weak signals: ${context.facts.weakSignals.length}`,
    `Needs revalidation: ${context.facts.needsRevalidation.length}`,
    `Stale facts: ${context.facts.stale.length}`,
    `Conflicted facts: ${context.facts.conflicted.length}`,
    `Accepted knowledge: ${context.knowledge.current.length}`,
    `Knowledge needing revalidation: ${context.knowledge.needsRevalidation.length}`,
    `Knowledge candidates: ${context.knowledge.candidateCount}`,
    `Unknowns: ${context.unknowns.length}`,
  ];
  if (context.notices.length > 0) {
    lines.push("", "Notices:");
    for (const notice of context.notices) lines.push(`  ${notice.code}: ${notice.message}`);
  }
  lines.push("", "Project context guides exploration. It does not authorize mutation or satisfy review.");
  return `${lines.join("\n")}\n`;
}
