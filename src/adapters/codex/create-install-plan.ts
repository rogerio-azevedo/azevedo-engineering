import type { AgentRole } from "../../core/agents/roles.js";
import { AGENT_ROLES } from "../../core/agents/roles.js";
import type { GeneratedArtifact } from "../../core/schemas/component.js";
import { GeneratedArtifactSchema } from "../../core/schemas/component.js";
import type { ProjectInspection } from "../../core/schemas/discovery.js";

export type CodexInstallPlan = {
  target: "codex";
  scope: "project-local";
  artifacts: GeneratedArtifact[];
  unsupported: string[];
};

function renderAgentsFile(inspection: ProjectInspection): string {
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

function renderAgentToml(role: AgentRole): string {
  const instructions = `${role.instructions}\n\nExpected output: ${role.output}`;
  return `name = ${JSON.stringify(role.id)}
description = ${JSON.stringify(`${role.summary} Use when: ${role.delegatesWhen.join(" ")}`)}
sandbox_mode = "read-only"
developer_instructions = ${JSON.stringify(instructions)}
`;
}

export function createCodexInstallPlan(inspection: ProjectInspection): CodexInstallPlan {
  const artifacts: GeneratedArtifact[] = [
    GeneratedArtifactSchema.parse({
      path: "AGENTS.md",
      sourceIds: ["workflow.delivery"],
      content: renderAgentsFile(inspection),
      managed: true,
    }),
    ...AGENT_ROLES.map((role) =>
      GeneratedArtifactSchema.parse({
        path: `.codex/agents/${role.id}.toml`,
        sourceIds: [`agent.${role.id}`],
        content: renderAgentToml(role),
        managed: true,
      }),
    ),
  ];

  return {
    target: "codex",
    scope: "project-local",
    artifacts,
    unsupported: [
      "hooks",
      "MCP provisioning",
      "global configuration",
      "plugin packaging",
      "automatic skill materialization",
    ],
  };
}

