import { z } from "zod";
import { ContextManifestSchema } from "../knowledge/knowledge-unit.js";
import { EngineeringPlanSchema } from "../planning/engineering-plan.js";
import { RiskClassSchema, RiskSignalSchema } from "../schemas/task.js";
import { SubjectRevisionSchema } from "../schemas/evidence.js";
import { FeatureSpecificationSchema } from "../specification/feature-specification.js";

export const ProjectRelativePathSchema = z.string().min(1).refine((value) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  return normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}, "Evidence paths must be project-relative and contained.");

export const ExplorationEvidenceSchema = z.object({
  id: z.string().regex(/^evidence-[a-f0-9]{12}$/),
  kind: z.enum([
    "manifest", "configuration", "source", "contract", "test", "documentation", "import", "structure",
  ]),
  path: ProjectRelativePathSchema,
  symbol: z.string().min(1).nullable(),
  location: z.object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }).strict().nullable(),
  reason: z.string().min(1),
  taskRelation: z.string().min(1),
  links: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)),
}).strict().superRefine((evidence, context) => {
  if (evidence.location && evidence.location.endLine < evidence.location.startLine) context.addIssue({
    code: "custom",
    path: ["location", "endLine"],
    message: "Evidence endLine must not precede startLine.",
  });
});

const EvidenceBackedSchema = z.object({
  evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)).min(1),
});

export const ExplorationStopReasonSchema = z.enum([
  "sufficient-evidence",
  "blocked-by-ambiguity",
  "blocked-by-missing-context",
  "scope-boundary",
  "budget-exhausted",
]);

export const ExplorationArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("exploration-artifact"),
  id: z.string().regex(/^exploration-[a-f0-9]{12}$/),
  planId: EngineeringPlanSchema.shape.id,
  specificationId: FeatureSpecificationSchema.shape.id,
  project: z.object({
    root: z.literal("."),
    topology: EngineeringPlanSchema.shape.project.shape.topology,
    technologies: z.array(z.string().min(1)),
    packages: z.array(z.union([z.literal("."), ProjectRelativePathSchema])),
  }).strict(),
  contextManifest: ContextManifestSchema,
  budget: z.object({
    maxFilesInspected: z.number().int().positive(),
    filesInventoried: z.number().int().nonnegative(),
    filesInspected: z.number().int().nonnegative(),
    exhausted: z.boolean(),
  }).strict(),
  terminology: z.array(z.object({
    specificationTerm: z.string().min(1),
    repositoryTerms: z.array(z.string().min(1)).min(1),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  evidence: z.array(ExplorationEvidenceSchema),
  entryPoints: z.array(z.object({
    path: ProjectRelativePathSchema,
    kind: z.enum(["controller", "resolver", "route", "page", "component", "handler", "consumer", "job", "module"]),
    symbol: z.string().min(1).nullable(),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  flows: z.array(z.object({
    from: ProjectRelativePathSchema,
    to: ProjectRelativePathSchema,
    relation: z.enum(["imports", "calls", "reads", "writes", "renders", "consumes"]),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  similarImplementations: z.array(z.object({
    path: ProjectRelativePathSchema,
    similarity: z.string().min(1),
    reusablePattern: z.string().min(1),
    differences: z.array(z.string().min(1)).min(1),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  affectedPaths: z.array(z.object({
    path: ProjectRelativePathSchema,
    confidence: z.enum(["confirmed", "likely", "supporting"]),
    reason: z.string().min(1),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  contracts: z.array(z.object({
    path: ProjectRelativePathSchema,
    symbol: z.string().min(1).nullable(),
    consumerPaths: z.array(ProjectRelativePathSchema),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  tests: z.array(z.object({
    path: ProjectRelativePathSchema.nullable(),
    state: z.enum(["direct", "similar", "capability-without-coverage", "capability-unavailable"]),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)),
  }).strict()),
  dependencies: z.array(z.object({
    name: z.string().min(1),
    kind: z.enum(["internal", "external"]),
    usedBy: z.array(ProjectRelativePathSchema).min(1),
    evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
  }).strict()),
  risk: z.object({
    class: RiskClassSchema,
    findings: z.array(z.object({
      signal: RiskSignalSchema,
      reason: z.string().min(1),
      evidenceIds: EvidenceBackedSchema.shape.evidenceIds,
    }).strict()),
  }).strict(),
  unknowns: z.array(z.object({
    question: z.string().min(1),
    status: z.enum(["resolved", "remaining"]),
    resolution: z.string().min(1),
    evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)),
  }).strict()),
  assumptions: z.array(z.object({
    statement: z.string().min(1),
    basis: z.enum(["plan", "specification", "exploration"]),
  }).strict()),
  hypotheses: z.array(z.object({
    statement: z.string().min(1),
    evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)),
  }).strict()),
  acceptanceCoverage: z.array(z.object({
    criterionId: z.string().regex(/^ac-[a-z0-9]+(?:-[a-z0-9]+)*$/),
    source: z.literal("specification"),
    status: z.enum(["evidence-found", "partial", "not-found"]),
    evidenceIds: z.array(z.string().regex(/^evidence-[a-f0-9]{12}$/)),
    note: z.string().min(1),
  }).strict()),
  stopReason: ExplorationStopReasonSchema,
  status: z.enum(["ready", "partial", "blocked"]),
  sourceRevision: SubjectRevisionSchema,
}).strict().superRefine((artifact, context) => {
  const evidenceIds = new Set<string>();
  for (const [index, evidence] of artifact.evidence.entries()) {
    if (evidenceIds.has(evidence.id)) context.addIssue({
      code: "custom", path: ["evidence", index, "id"], message: "Evidence ids must be unique.",
    });
    evidenceIds.add(evidence.id);
  }
  const references: Array<{ path: (string | number)[]; ids: string[] }> = [];
  const collect = (values: readonly { evidenceIds: string[] }[], path: string): void => {
    values.forEach((value, index) => references.push({ path: [path, index, "evidenceIds"], ids: value.evidenceIds }));
  };
  collect(artifact.terminology, "terminology");
  collect(artifact.entryPoints, "entryPoints");
  collect(artifact.flows, "flows");
  collect(artifact.similarImplementations, "similarImplementations");
  collect(artifact.affectedPaths, "affectedPaths");
  collect(artifact.contracts, "contracts");
  collect(artifact.tests, "tests");
  collect(artifact.dependencies, "dependencies");
  collect(artifact.risk.findings, "risk.findings");
  collect(artifact.unknowns, "unknowns");
  collect(artifact.hypotheses, "hypotheses");
  collect(artifact.acceptanceCoverage, "acceptanceCoverage");
  for (const reference of references) for (const id of reference.ids) {
    if (!evidenceIds.has(id)) context.addIssue({
      code: "custom", path: reference.path, message: `Unknown evidence reference: ${id}`,
    });
  }
  for (const [index, evidence] of artifact.evidence.entries()) for (const id of evidence.links) {
    if (!evidenceIds.has(id)) context.addIssue({
      code: "custom", path: ["evidence", index, "links"], message: `Unknown evidence link: ${id}`,
    });
  }
  for (const [index, unknown] of artifact.unknowns.entries()) {
    if (unknown.status === "resolved" && unknown.evidenceIds.length === 0) context.addIssue({
      code: "custom", path: ["unknowns", index, "evidenceIds"], message: "Resolved unknowns require evidence.",
    });
  }
  if (artifact.status === "ready" && artifact.stopReason !== "sufficient-evidence") context.addIssue({
    code: "custom", path: ["stopReason"], message: "Ready exploration must stop because evidence is sufficient.",
  });
  if (artifact.status === "blocked" && !artifact.stopReason.startsWith("blocked-by-")) context.addIssue({
    code: "custom", path: ["stopReason"], message: "Blocked exploration requires an explicit blocking stop reason.",
  });
  if (artifact.status === "partial" && !["scope-boundary", "budget-exhausted"].includes(artifact.stopReason)) context.addIssue({
    code: "custom", path: ["stopReason"], message: "Partial exploration requires a boundary or budget stop reason.",
  });
  if (artifact.budget.filesInspected > artifact.budget.maxFilesInspected) context.addIssue({
    code: "custom", path: ["budget", "filesInspected"], message: "Inspected file count exceeds the declared budget.",
  });
  if (artifact.budget.exhausted && artifact.budget.filesInspected !== artifact.budget.maxFilesInspected) context.addIssue({
    code: "custom", path: ["budget", "exhausted"], message: "An exhausted budget must have consumed the declared file limit.",
  });
});

export type ExplorationEvidence = z.infer<typeof ExplorationEvidenceSchema>;
export type ExplorationArtifact = z.infer<typeof ExplorationArtifactSchema>;

export function serializeExplorationArtifact(artifact: ExplorationArtifact): string {
  return `${JSON.stringify(ExplorationArtifactSchema.parse(artifact), null, 2)}\n`;
}
