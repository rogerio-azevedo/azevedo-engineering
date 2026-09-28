import type { ExplorationArtifact } from "../exploration/exploration-artifact.js";
import {
  SecurityRiskDomainSchema,
  TrustBoundarySchema,
  reviewDigest,
  type ReviewEvidence,
} from "./review-contracts.js";

type DomainRule = {
  id: string;
  title: string;
  signals: readonly string[];
  capabilities: readonly string[];
  requireAllCapabilities?: boolean;
};

export const DEFAULT_SECURITY_DOMAIN_RULES: readonly DomainRule[] = [
  {
    id: "authorization",
    title: "Authorization and protected actions",
    signals: ["auth", "authorization", "dependency_permissions"],
    capabilities: ["identity-authorization"],
  },
  {
    id: "tenant-isolation",
    title: "Tenant and resource isolation",
    signals: ["authorization", "data_exposure"],
    capabilities: ["identity-authorization", "address-data"],
    requireAllCapabilities: true,
  },
  {
    id: "pii-data-exposure",
    title: "Personal data minimization and exposure",
    signals: ["pii", "data_exposure", "sensitive_logging"],
    capabilities: ["address-data"],
  },
  {
    id: "file-upload-storage",
    title: "File upload and durable storage",
    signals: ["file_upload", "filesystem", "external_url"],
    capabilities: ["file-storage"],
  },
  {
    id: "external-communication",
    title: "External communication and provider failure",
    signals: ["integration", "webhook", "external_url"],
    capabilities: ["email-delivery"],
  },
  {
    id: "input-contracts",
    title: "Untrusted input and public contracts",
    signals: ["external_input", "public_contract", "serialization"],
    capabilities: ["api-boundary"],
  },
  {
    id: "persistence-integrity",
    title: "Persistence integrity and state transitions",
    signals: ["persistence", "migration", "destructive_migration"],
    capabilities: ["persistence"],
  },
  {
    id: "secrets-and-provider-permissions",
    title: "Secrets and provider permission scope",
    signals: ["credentials", "sensitive_logging", "dependency_permissions"],
    capabilities: [],
  },
];

function evidenceForSurface(
  exploration: ExplorationArtifact,
  capability: string,
  evidenceBySourceId: ReadonlyMap<string, ReviewEvidence>,
): ReviewEvidence[] {
  const ids = exploration.integrationSurfaces
    .filter((surface) => surface.capability === capability)
    .flatMap((surface) => surface.evidenceIds);
  return [...new Set(ids)].flatMap((id) => {
    const evidence = evidenceBySourceId.get(id);
    return evidence ? [evidence] : [];
  });
}

function signalEvidence(
  exploration: ExplorationArtifact,
  signals: readonly string[],
  evidenceBySourceId: ReadonlyMap<string, ReviewEvidence>,
): ReviewEvidence[] {
  const ids = exploration.risk.findings
    .filter((finding) => signals.includes(finding.signal))
    .flatMap((finding) => finding.evidenceIds);
  return [...new Set(ids)].flatMap((id) => {
    const evidence = evidenceBySourceId.get(id);
    return evidence ? [evidence] : [];
  });
}

const BOUNDARY_BY_CAPABILITY: Readonly<Record<string, {
  kind: string;
  from: string;
  to: string;
  description: string;
}>> = {
  "identity-authorization": {
    kind: "identity-to-protected-action",
    from: "authenticated identity and tenant context",
    to: "protected application action",
    description: "The implementation must authorize the concrete resource and action, not authentication alone.",
  },
  "api-boundary": {
    kind: "untrusted-input-to-application",
    from: "external caller input",
    to: "application and domain logic",
    description: "Transport input crosses into trusted application behavior and requires validation and bounded errors.",
  },
  "address-data": {
    kind: "tenant-context-to-record",
    from: "current tenant or condominium context",
    to: "tenant-owned records",
    description: "Record access must remain scoped to the active tenant boundary.",
  },
  "file-storage": {
    kind: "application-to-file-storage",
    from: "user-controlled file metadata and content",
    to: "durable file storage",
    description: "File content, names, URLs, sizes, and ownership cross a durable storage boundary.",
  },
  "email-delivery": {
    kind: "application-to-delivery-provider",
    from: "application notification request",
    to: "external delivery provider",
    description: "Recipient data and delivery results cross an external provider boundary with partial-failure risk.",
  },
  persistence: {
    kind: "application-to-durable-store",
    from: "application state transition",
    to: "durable transactional state",
    description: "State transitions must preserve invariants under retries, concurrency, and failure.",
  },
};

export function identifyTrustBoundaries(
  exploration: ExplorationArtifact,
  evidenceBySourceId: ReadonlyMap<string, ReviewEvidence>,
) {
  const boundaries = exploration.integrationSurfaces.flatMap((surface) => {
    const descriptor = BOUNDARY_BY_CAPABILITY[surface.capability];
    if (!descriptor) return [];
    const evidenceIds = surface.evidenceIds.flatMap((id) => {
      const evidence = evidenceBySourceId.get(id);
      return evidence ? [evidence.id] : [];
    });
    if (evidenceIds.length === 0) return [];
    return [TrustBoundarySchema.parse({
      id: `trust-boundary-${descriptor.kind}-${reviewDigest({ capability: surface.capability, surfaceId: surface.id }, 8)}`,
      ...descriptor,
      evidenceIds: [...new Set(evidenceIds)].sort(),
    })];
  });
  const byKind = new Map<string, (typeof boundaries)[number]>();
  for (const boundary of boundaries) if (!byKind.has(boundary.kind)) byKind.set(boundary.kind, boundary);
  return [...byKind.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function selectSecurityDomains(
  exploration: ExplorationArtifact,
  evidenceBySourceId: ReadonlyMap<string, ReviewEvidence>,
  trustBoundaries: ReturnType<typeof identifyTrustBoundaries>,
  rules: readonly DomainRule[] = DEFAULT_SECURITY_DOMAIN_RULES,
) {
  const capabilities = new Set(exploration.integrationSurfaces.map((surface) => surface.capability));
  const signals = new Set(exploration.risk.findings.map((finding) => finding.signal));
  return rules.flatMap((rule) => {
    const matchedSignals = rule.signals.filter((signal) => signals.has(signal as never));
    const matchedCapabilities = rule.capabilities.filter((capability) => capabilities.has(capability));
    const capabilityMatch = rule.capabilities.length > 0 && (rule.requireAllCapabilities
      ? matchedCapabilities.length === rule.capabilities.length
      : matchedCapabilities.length > 0);
    if (matchedSignals.length === 0 && !capabilityMatch) return [];
    const evidence = [
      ...signalEvidence(exploration, matchedSignals, evidenceBySourceId),
      ...matchedCapabilities.flatMap((capability) => evidenceForSurface(exploration, capability, evidenceBySourceId)),
    ];
    const evidenceIds = [...new Set(evidence.map((item) => item.id))].sort();
    if (evidenceIds.length === 0) return [];
    const boundaryIds = trustBoundaries
      .filter((boundary) => boundary.evidenceIds.some((id) => evidenceIds.includes(id)))
      .map((boundary) => boundary.id)
      .sort();
    const reasons = [
      ...(matchedSignals.length > 0 ? [`Risk signals: ${matchedSignals.sort().join(", ")}.`] : []),
      ...(matchedCapabilities.length > 0 ? [`Changed integration capabilities: ${matchedCapabilities.sort().join(", ")}.`] : []),
    ];
    return [SecurityRiskDomainSchema.parse({
      id: rule.id,
      title: rule.title,
      selected: true,
      reasons,
      evidenceIds,
      trustBoundaryIds: boundaryIds,
    })];
  }).sort((left, right) => left.id.localeCompare(right.id));
}
