import { z } from "zod";
import { ReviewEvidenceQualitySchema } from "../review/review-contracts.js";

export const ProjectIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const RepositoryIdSchema = ProjectIdSchema;
export const PortablePathSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  return !value.replaceAll("\\", "/").split("/").includes("..");
}, "Paths must be relative and contained.");
export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const ClaimFormSchema = z.enum(["existence", "enumeration", "behavior"]);
export const ClaimLevelSchema = z.enum(["path", "repository", "project"]);

export const ClaimScopeSchema = z.object({
  level: ClaimLevelSchema,
  repositoryIds: z.array(RepositoryIdSchema),
  pathPrefixes: z.array(PortablePathSchema),
}).strict();

export const ClaimSchema = z.object({
  form: ClaimFormSchema,
  scope: ClaimScopeSchema,
}).strict();

export const ProjectRepositoryIdentitySchema = z.object({
  repositoryId: RepositoryIdSchema,
  name: z.string().min(1),
}).strict();

export const ProjectDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  name: z.string().min(1),
  repositories: z.array(ProjectRepositoryIdentitySchema),
}).strict();

export const ProjectBindingRepositorySchema = z.object({
  repositoryId: RepositoryIdSchema,
  path: PortablePathSchema,
}).strict();

export const ProjectBindingSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  root: z.string().min(1),
  repositories: z.array(ProjectBindingRepositorySchema),
}).strict();

export const ObservationBasisSchema = z.enum([
  "presence",
  "manifest-entry",
  "content-match",
  "directory-listing",
  "vcs-metadata",
]);

export const ObservationCoverageSchema = z.enum(["complete", "truncated", "not-applicable"]);

export const ProjectObservationSchema = z.object({
  id: z.string().regex(/^observation-[a-f0-9]{12}$/),
  location: z.object({
    repositoryId: RepositoryIdSchema.nullable(),
    path: PortablePathSchema,
  }).strict(),
  basis: ObservationBasisSchema,
  subject: z.string().min(1),
  basisDigest: Sha256Schema,
  sensitive: z.boolean(),
  coverage: ObservationCoverageSchema,
  revision: GitRevisionSchema.nullable(),
}).strict();

export const FactCategorySchema = z.enum([
  "topology",
  "language",
  "framework",
  "package-ecosystem",
  "runtime",
  "persistence",
  "api",
  "auth",
  "external-effect",
  "testing",
  "build",
  "architecture",
  "safety",
  "vcs",
]);

export const FactCardinalitySchema = z.enum(["single", "multiple"]);
export const FactStatusSchema = z.enum(["validated", "needs-revalidation", "stale", "conflicted"]);
export const ProjectEvidenceQualitySchema = ReviewEvidenceQualitySchema.exclude(["insufficient"]);

export const FactValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("list"), items: z.array(z.string().min(1)) }).strict(),
  z.object({
    kind: z.literal("command"),
    script: z.string().min(1),
    command: z.string().min(1).nullable(),
    redacted: z.string().min(1).nullable(),
  }).strict(),
]);

export const FactDerivationSchema = z.object({
  detectorId: z.string().min(1),
  detectorVersion: z.number().int().positive(),
  rule: z.string().min(1),
}).strict();

export const ObservedRevisionSchema = z.object({
  repositoryId: RepositoryIdSchema,
  revision: GitRevisionSchema.nullable(),
}).strict();

export const ProjectFactSchema = z.object({
  id: z.string().regex(/^fact-[a-f0-9]{12}$/),
  repositoryId: RepositoryIdSchema.nullable(),
  category: FactCategorySchema,
  key: z.string().min(1),
  value: FactValueSchema,
  cardinality: FactCardinalitySchema,
  claim: ClaimSchema,
  supports: z.array(z.string().regex(/^observation-[a-f0-9]{12}$/)).min(1),
  contradictionProbes: z.array(PortablePathSchema),
  evidenceQuality: ProjectEvidenceQualitySchema,
  derivation: FactDerivationSchema,
  status: FactStatusSchema,
  observedRevisions: z.array(ObservedRevisionSchema),
}).strict();

export const ProjectUnknownSchema = z.object({
  id: z.string().regex(/^unknown-[a-f0-9]{12}$/),
  repositoryId: RepositoryIdSchema.nullable(),
  topic: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export const ProjectKnowledgeSchema = z.object({
  id: z.string().regex(/^project-knowledge-[a-f0-9]{12}$/),
  kind: z.enum(["convention", "architecture", "constraint"]),
  statement: z.string().min(1),
  claim: ClaimSchema,
  supports: z.array(z.string().regex(/^observation-[a-f0-9]{12}$/)),
  factRefs: z.array(z.string().regex(/^fact-[a-f0-9]{12}$/)),
  state: z.enum(["candidate", "accepted"]),
  status: FactStatusSchema,
  submittedBy: z.string().min(1),
  acceptedBy: z.string().min(1).nullable(),
  validatedRevisions: z.array(ObservedRevisionSchema),
}).strict();

export const SnapshotRepositorySchema = z.object({
  repositoryId: RepositoryIdSchema,
  vcs: z.enum(["git", "none"]),
  commit: GitRevisionSchema.nullable(),
  dirty: z.boolean(),
  remote: z.string().min(1).nullable(),
}).strict();

export const SnapshotBudgetSchema = z.object({
  repositoryId: RepositoryIdSchema,
  filesRead: z.number().int().nonnegative(),
  listings: z.number().int().nonnegative(),
  stopReason: z.enum(["sufficient", "budget-exhausted"]),
}).strict();

export const SnapshotChangesSchema = z.object({
  superseded: z.array(z.string().min(1)),
}).strict();

export const DetectorRefSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
}).strict();

export const ProjectSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^snapshot-[a-f0-9]{16}$/),
  projectId: ProjectIdSchema,
  definitionDigest: Sha256Schema,
  previousSnapshotId: z.string().regex(/^snapshot-[a-f0-9]{16}$/).nullable(),
  layout: z.enum(["single-repository", "project-group"]),
  detectorSet: z.array(DetectorRefSchema),
  repositories: z.array(SnapshotRepositorySchema),
  observations: z.array(ProjectObservationSchema),
  facts: z.array(ProjectFactSchema),
  unknowns: z.array(ProjectUnknownSchema),
  knowledge: z.array(ProjectKnowledgeSchema),
  budget: z.array(SnapshotBudgetSchema),
  changes: SnapshotChangesSchema,
}).strict();

export const ProjectRegistryPointerSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  snapshotId: z.string().regex(/^snapshot-[a-f0-9]{16}$/),
  snapshotDigest: Sha256Schema,
}).strict();

export const ProjectContextRepositorySchema = z.object({
  repositoryId: RepositoryIdSchema,
  name: z.string().min(1),
  role: z.null(),
  roleBasis: z.literal("no-evidence"),
  snapshotRevision: GitRevisionSchema.nullable(),
  available: z.boolean(),
}).strict();

export const ProjectContextNoticeSchema = z.object({
  code: z.enum([
    "binding-unavailable",
    "repository-unavailable",
    "revision-changed",
    "remote-changed",
    "needs-revalidation",
    "sensitive-material",
  ]),
  repositoryId: RepositoryIdSchema.nullable(),
  message: z.string().min(1),
}).strict();

export const ProjectContextSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  name: z.string().min(1),
  snapshotId: z.string().regex(/^snapshot-[a-f0-9]{16}$/),
  definitionDigest: Sha256Schema,
  layout: z.enum(["single-repository", "project-group"]),
  repositories: z.array(ProjectContextRepositorySchema),
  facts: z.object({
    current: z.array(ProjectFactSchema),
    weakSignals: z.array(ProjectFactSchema),
    needsRevalidation: z.array(ProjectFactSchema),
    stale: z.array(ProjectFactSchema),
    conflicted: z.array(ProjectFactSchema),
  }).strict(),
  knowledge: z.object({
    current: z.array(ProjectKnowledgeSchema),
    needsRevalidation: z.array(ProjectKnowledgeSchema),
    stale: z.array(ProjectKnowledgeSchema),
    candidateCount: z.number().int().nonnegative(),
  }).strict(),
  unknowns: z.array(ProjectUnknownSchema),
  sensitiveMaterial: z.array(z.object({
    repositoryId: RepositoryIdSchema.nullable(),
    path: PortablePathSchema,
  }).strict()),
  notices: z.array(ProjectContextNoticeSchema),
  boundaries: z.object({
    authorizesMutation: z.literal(false),
    replacesExploration: z.literal(false),
    reviewTrust: z.literal("untrusted-context"),
  }).strict(),
  digest: Sha256Schema,
  live: z.object({
    bindingRoot: z.string().min(1).nullable(),
    repositories: z.array(z.object({
      repositoryId: RepositoryIdSchema,
      path: z.string().min(1),
      branch: z.string().min(1).nullable(),
      revision: GitRevisionSchema.nullable(),
      dirty: z.boolean(),
    }).strict()),
  }).strict(),
}).strict();

export const OnboardOutcomeSchema = z.enum(["created", "updated", "unchanged", "blocked"]);

export type ProjectDefinition = z.infer<typeof ProjectDefinitionSchema>;
export type ProjectBinding = z.infer<typeof ProjectBindingSchema>;
export type ObservationCoverage = z.infer<typeof ObservationCoverageSchema>;
export type ProjectObservation = z.infer<typeof ProjectObservationSchema>;
export type ProjectFact = z.infer<typeof ProjectFactSchema>;
export type ProjectUnknown = z.infer<typeof ProjectUnknownSchema>;
export type ProjectKnowledge = z.infer<typeof ProjectKnowledgeSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export type ProjectRegistryPointer = z.infer<typeof ProjectRegistryPointerSchema>;
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type FactStatus = z.infer<typeof FactStatusSchema>;
export type FactValue = z.infer<typeof FactValueSchema>;
