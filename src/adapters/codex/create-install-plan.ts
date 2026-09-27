import type { GeneratedArtifact } from "../../core/schemas/component.js";
import { GeneratedArtifactSchema } from "../../core/schemas/component.js";
import type { ProjectInspection } from "../../core/schemas/discovery.js";
import { createCodexArtifactSpecs } from "./artifacts.js";

export type CodexInstallPlan = {
  target: "codex";
  scope: "project-local";
  artifacts: GeneratedArtifact[];
  unsupported: string[];
};

export function createCodexInstallPlan(inspection: ProjectInspection): CodexInstallPlan {
  const artifacts: GeneratedArtifact[] = createCodexArtifactSpecs(inspection).map((artifact) =>
    GeneratedArtifactSchema.parse({
      path: artifact.path,
      sourceIds: artifact.sourceIds,
      content: artifact.content,
      managed: true,
    }));

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
