import type { PlanCommandReport } from "../core/planning/plan-persistence.js";

export function renderHumanPlan(report: PlanCommandReport): string {
  const { plan } = report;
  const lines = [
    "Azevedo Engineering — Engineering Plan",
    "",
    "Plan",
    `  ID: ${plan.id}`,
    `  Task: ${plan.task.description}`,
    `  Risk: ${plan.risk.class}`,
    "",
    "Project",
    `  Topology: ${plan.project.topology}`,
    `  Technologies: ${plan.project.technologies.join(", ") || "none detected"}`,
    "",
    "Understanding",
    `  ${plan.understanding.summary}`,
  ];

  for (const unknown of plan.understanding.unknowns) lines.push(`  Unknown: ${unknown}`);
  lines.push("", "Steps");
  for (const [index, step] of plan.steps.entries()) {
    lines.push(`  ${index + 1}. [${step.kind}] ${step.description}`);
  }

  lines.push("", "Verification");
  for (const requirement of plan.verification) {
    const availability = requirement.available ? "available" : "unknown";
    const obligation = requirement.required ? "required" : "optional";
    lines.push(`  ${requirement.verifierId} (${requirement.scope}): ${availability}, ${obligation}`);
  }

  if (plan.decisions.items.length > 0) {
    lines.push("", "Decisions");
    for (const decision of plan.decisions.items) lines.push(`  - ${decision}`);
  }

  lines.push("", report.outcome === "conflict" ? "Conflict" : "Saved");
  lines.push(`  ${report.artifact}`);
  if (report.outcome === "created") lines.push("Plan created.");
  else if (report.outcome === "unchanged") lines.push("Plan already exists unchanged. No files were modified.");
  else lines.push(`Plan was not written: ${report.reason ?? "conflict"}`);
  return `${lines.join("\n")}\n`;
}
