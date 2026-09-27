import type { InitReport } from "../core/initialization/init-report.js";

function operationLine(operation: InitReport["projects"][number]["operations"][number], indent: string): string {
  const action = operation.action.toUpperCase().padEnd(10);
  const reason = operation.action === "conflict" ? ` — ${operation.reason}` : "";
  return `${indent}${action}${operation.path}${reason}`;
}

export function renderHumanInitialization(report: InitReport): string {
  const group = report.kind === "project-group";
  const dryRunSuffix = report.dryRun ? " Dry Run" : "";
  const lines = [
    `Azevedo Engineering — ${group ? "Group Init" : "Init"}${dryRunSuffix}`,
    "",
    group ? "Group" : "Project",
    `  Root: ${report.root}`,
  ];

  if (group) lines.push(`  Projects: ${report.projects.length}`);

  if (group) {
    lines.push("", "Projects");
    for (const project of report.projects) {
      lines.push(`  ${project.relativePath}`);
      for (const operation of project.operations) lines.push(operationLine(operation, "    "));
    }
  } else {
    lines.push("", "Operations");
    for (const operation of report.projects[0]?.operations ?? []) lines.push(operationLine(operation, "  "));
  }

  lines.push(
    "",
    report.dryRun || report.blocked ? "Summary" : "Result",
    `  ${report.dryRun || report.blocked ? "Create" : "Created"}: ${report.summary.create}`,
    `  Unchanged: ${report.summary.unchanged}`,
    `  Conflicts: ${report.summary.conflicts}`,
  );

  if (report.blocked) {
    lines.push("Status: BLOCKED", "No files were modified.");
  } else if (report.dryRun) {
    lines.push("No files were modified.");
  } else if (report.outcome === "already-initialized") {
    lines.push("Already initialized. No files were modified.");
  } else {
    if (group) lines.push(`Projects initialized: ${report.summary.projects}`);
    lines.push("Initialization completed.");
  }

  return `${lines.join("\n")}\n`;
}
