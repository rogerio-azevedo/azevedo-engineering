import {
  applyImmutableArtifactOperation,
  buildImmutableArtifactOperation,
  type ImmutableArtifactOperation,
} from "../filesystem/immutable-artifact.js";
import {
  FeatureSpecificationSchema,
  serializeFeatureSpecification,
  type FeatureSpecification,
} from "./feature-specification.js";

export function specificationArtifactPath(specification: FeatureSpecification): string {
  return `.azevedo/specifications/${specification.id}.json`;
}

export function buildSpecificationArtifactOperation(
  projectRoot: string,
  rawSpecification: FeatureSpecification,
): ImmutableArtifactOperation {
  const specification = FeatureSpecificationSchema.parse(rawSpecification);
  return buildImmutableArtifactOperation(
    projectRoot,
    specificationArtifactPath(specification),
    serializeFeatureSpecification(specification),
  );
}

export function applySpecificationArtifactOperation(
  projectRoot: string,
  operation: ImmutableArtifactOperation,
): void {
  applyImmutableArtifactOperation(projectRoot, operation);
}
