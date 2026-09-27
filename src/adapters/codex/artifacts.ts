import type { AgentRole } from "../../core/agents/roles.js";
import { AGENT_ROLES } from "../../core/agents/roles.js";
import type { ProjectInspection } from "../../core/schemas/discovery.js";

export type CodexArtifactSpec = {
  path: string;
  content: string;
  sourceIds: string[];
  order: number;
};

export const CODEX_AGENTS_CONTENT = `# Azevedo Engineering

This project uses Azevedo Engineering. Read \`azevedo.config.yaml\` before making changes.

- Respect the existing architecture and recorded decisions.
- Gather evidence before assuming project capabilities or behavior.
- Never overwrite existing decisions or user-owned content silently.
- Follow the delivery workflow: Understand → Research → Plan → Implement → Test → Review → Verify → Document → Learn → Done.
- Consider work complete only when applicable checks have verifiable evidence.

Additional task-specific guidance will be supplied by future harness capabilities. This file is a thin Codex bootstrap, not the canonical engineering methodology.
`;

function renderInspectedAgentsContent(inspection: ProjectInspection): string {
  const technologies = inspection.technologies.map((item) => item.id).join(", ") || "unknown";
  const commands = inspection.scripts
    .filter((script) => ["lint", "typecheck", "test", "build"].some((prefix) => script.name === prefix || script.name.startsWith(`${prefix}:`)))
    .map((script) => `- ${script.packagePath}: \`${script.name}\``)
    .join("\n");

  return `# Azevedo Engineering — Codex baseline

This project uses the Azevedo Engineering workflow: Understand → Research → Plan → Implement → Test → Review → Verify → Document → Learn → Done.

Detected context:
- topology: ${inspection.topology.value ?? inspection.topology.state}
- package manager: ${inspection.packageManager.value ?? inspection.packageManager.state}
- technologies: ${technologies}

Discovered verification scripts:
${commands || "- none; do not invent commands—report the capability as unknown"}

Keep changes scoped. Select stack guidance only from detected or explicitly configured capabilities. Record tests, skips, waivers, findings, and the verified revision. A task is done only after the applicable evidence gates pass.

Use read-only specialist agents only for bounded research, material architecture decisions, code review, or security review. The main agent owns implementation and the final result.
`;
}

export function renderCodexAgentToml(role: AgentRole): string {
  const instructions = `${role.instructions}\n\nExpected output: ${role.output}`;
  return `name = ${JSON.stringify(role.id)}
description = ${JSON.stringify(`${role.summary} Use when: ${role.delegatesWhen.join(" ")}`)}
sandbox_mode = "read-only"
developer_instructions = ${JSON.stringify(instructions)}
`;
}

export function createCodexArtifactSpecs(inspection?: ProjectInspection): CodexArtifactSpec[] {
  return [{
    path: "AGENTS.md",
    content: inspection ? renderInspectedAgentsContent(inspection) : CODEX_AGENTS_CONTENT,
    sourceIds: ["workflow.delivery"],
    order: 20,
  }, ...AGENT_ROLES.map((role, index) => ({
    path: `.codex/agents/${role.id}.toml`,
    content: renderCodexAgentToml(role),
    sourceIds: [`agent.${role.id}`],
    order: 21 + index,
  }))];
}
