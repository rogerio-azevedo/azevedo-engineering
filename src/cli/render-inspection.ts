import type { InspectResult } from "../core/inspection/inspect-result.js";

function formatEvidence(evidence: readonly string[]): string {
  return evidence.length > 0 ? evidence.join(", ") : "none";
}

function renderDetection(
  detection: InspectResult["packageManager"] | InspectResult["topology"],
): string {
  if (detection.state === "detected") return detection.value ?? "unknown";
  if (detection.state === "ambiguous" && "candidates" in detection) {
    return `ambiguous (${detection.candidates.join(", ")})`;
  }
  return detection.state;
}

function renderValues(values: readonly string[], indent = "  "): string[] {
  return values.length > 0 ? values.map((value) => `${indent}${value}`) : [`${indent}none`];
}

export function renderHumanInspection(result: InspectResult): string {
  const lines = [
    "Azevedo Engineering — Project Inspection",
    "",
    "Project",
    `  Root: ${result.root}`,
    `  Topology: ${renderDetection(result.topology)}`,
    `  Package manager: ${renderDetection(result.packageManager)}`,
    "",
    "Detected technologies",
    ...(
      result.technologies.length > 0
        ? result.technologies.map((technology) => `  [${technology.category}] ${technology.id}`)
        : ["  none"]
    ),
    "",
    "Capabilities",
    ...result.capabilities.map((capability) => `  [${capability.state}] ${capability.id}`),
    "",
    "Profiles",
    ...renderValues(result.matchedProfiles),
    "",
    "Packages",
  ];

  if (result.packages.length === 0) {
    lines.push("  none");
  } else {
    for (const packagePath of result.packages) {
      lines.push(`  ${packagePath}`);
      const scripts = result.scripts.filter((script) => script.packagePath === packagePath);
      if (scripts.length === 0) {
        lines.push("    scripts: none");
      } else {
        for (const script of scripts) lines.push(`    ${script.name}: ${script.command}`);
      }
    }
  }

  lines.push(
    "",
    "Unknown",
    ...renderValues(result.unknowns),
    "",
    "Ambiguous",
    ...renderValues(result.ambiguities),
    "",
    "Conflicts",
    ...renderValues(result.conflicts),
    "",
    "Evidence",
    `  package-manager: ${formatEvidence(result.packageManager.evidence)}`,
    `  topology: ${formatEvidence(result.topology.evidence)}`,
  );

  for (const technology of result.technologies) {
    lines.push(`  technology.${technology.id}: ${formatEvidence(technology.evidence)}`);
  }

  return `${lines.join("\n")}\n`;
}
