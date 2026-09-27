import {
  applyImmutableArtifactOperation,
  buildImmutableArtifactOperation,
  type ImmutableArtifactOperation,
} from "../filesystem/immutable-artifact.js";
import {
  ExplorationArtifactSchema,
  serializeExplorationArtifact,
  type ExplorationArtifact,
} from "./exploration-artifact.js";

export function explorationArtifactPath(artifact: ExplorationArtifact): string {
  return `.azevedo/explorations/${artifact.id}.json`;
}

export function buildExplorationArtifactOperation(
  projectRoot: string,
  rawArtifact: ExplorationArtifact,
): ImmutableArtifactOperation {
  const artifact = ExplorationArtifactSchema.parse(rawArtifact);
  return buildImmutableArtifactOperation(
    projectRoot,
    explorationArtifactPath(artifact),
    serializeExplorationArtifact(artifact),
  );
}

export function applyExplorationArtifactOperation(
  projectRoot: string,
  operation: ImmutableArtifactOperation,
): void {
  applyImmutableArtifactOperation(projectRoot, operation);
}
