import {
  InitializationArtifactSchema,
  type InitializationArtifact,
} from "../../core/initialization/artifacts.js";

export const CODEX_AGENTS_CONTENT = `# Azevedo Engineering

This project uses Azevedo Engineering. Read \`azevedo.config.yaml\` before making changes.

- Respect the existing architecture and recorded decisions.
- Gather evidence before assuming project capabilities or behavior.
- Never overwrite existing decisions or user-owned content silently.
- Follow the delivery workflow: Understand → Research → Plan → Implement → Test → Review → Verify → Document → Learn → Done.
- Consider work complete only when applicable checks have verifiable evidence.

Additional task-specific guidance will be supplied by future harness capabilities. This file is a thin Codex bootstrap, not the canonical engineering methodology.
`;

export function createCodexInitializationArtifacts(): InitializationArtifact[] {
  return [InitializationArtifactSchema.parse({
    path: "AGENTS.md",
    content: CODEX_AGENTS_CONTENT,
    ownership: "adapter-managed",
    order: 20,
  })];
}
