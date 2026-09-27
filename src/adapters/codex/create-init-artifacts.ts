import {
  InitializationArtifactSchema,
  type InitializationArtifact,
} from "../../core/initialization/artifacts.js";
import { createCodexArtifactSpecs } from "./artifacts.js";
export { CODEX_AGENTS_CONTENT } from "./artifacts.js";

export function createCodexInitializationArtifacts(): InitializationArtifact[] {
  return createCodexArtifactSpecs().map((artifact) => InitializationArtifactSchema.parse({
    path: artifact.path,
    content: artifact.content,
    ownership: "adapter-managed",
    order: artifact.order,
  }));
}
