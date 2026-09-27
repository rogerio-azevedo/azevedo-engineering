import type { ExploreCommandReport } from "./command.js";

export function renderHumanExploration(report: ExploreCommandReport): string {
  const lines = [
    "Azevedo Engineering — Evidence-backed Exploration",
    "",
    `Outcome: ${report.outcome}`,
    `Status: ${report.exploration.status}`,
    `Stop reason: ${report.exploration.stopReason}`,
    `Plan: ${report.exploration.planId}`,
    `Specification: ${report.specification.id}`,
    `Exploration: ${report.exploration.id}`,
    `Inspected files: ${report.exploration.budget.filesInspected}/${report.exploration.budget.maxFilesInspected}`,
    `Evidence records: ${report.exploration.evidence.length}`,
    `Affected paths: ${report.exploration.affectedPaths.length}`,
    `Remaining unknowns: ${report.exploration.unknowns.filter((item) => item.status === "remaining").length}`,
    `Plan revision: ${report.revision?.id ?? "not produced"}`,
    "",
    "Artifacts",
    ...report.operations.map((operation) => `  ${operation.action}: ${operation.artifact}${operation.reason ? ` — ${operation.reason}` : ""}`),
    "",
    "Selected knowledge",
    ...report.exploration.contextManifest.selected.map((unit) => `  ${unit.id}@${unit.version} (${unit.reason.join(", ")})`),
    "",
    "Affected paths",
    ...(report.exploration.affectedPaths.length > 0
      ? report.exploration.affectedPaths.map((item) => `  [${item.confidence}] ${item.path}`)
      : ["  none"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
