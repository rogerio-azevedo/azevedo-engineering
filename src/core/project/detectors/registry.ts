import { genericManifestDetector } from "./generic.js";
import { nodeArchitectureDetector, nodeContractsDetector, nodeEcosystemDetector, nodeIntegrationsDetector, nodePersistenceDetector, nodeTestingDetector } from "./node.js";
import { sensitiveMaterialDetector } from "./safety.js";
import type { ProjectFactDetector } from "./support.js";
import { vcsDetector } from "./vcs.js";

export const PROJECT_FACT_DETECTORS: readonly ProjectFactDetector[] = [
  vcsDetector,
  nodeEcosystemDetector,
  nodePersistenceDetector,
  nodeContractsDetector,
  nodeIntegrationsDetector,
  nodeTestingDetector,
  nodeArchitectureDetector,
  genericManifestDetector,
  sensitiveMaterialDetector,
];

export function detectorSet(): Array<{ id: string; version: number }> {
  return PROJECT_FACT_DETECTORS.map((detector) => ({ id: detector.id, version: detector.version }));
}
