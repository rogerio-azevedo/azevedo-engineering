import { z } from "zod";

export const DetectionStateSchema = z.enum([
  "detected",
  "configured",
  "unknown",
  "ambiguous",
  "unsupported",
]);

export const PackageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun"]);

export const ProjectTopologySchema = z.enum(["single-repo", "monorepo"]);

export const PackageManagerDetectionSchema = z.object({
  state: z.enum(["detected", "unknown", "ambiguous"]),
  value: PackageManagerSchema.nullable(),
  candidates: z.array(PackageManagerSchema),
  evidence: z.array(z.string()),
});

export const TopologyDetectionSchema = z.object({
  state: z.enum(["detected", "unknown", "ambiguous"]),
  value: ProjectTopologySchema.nullable(),
  evidence: z.array(z.string()),
});

export const TechnologySchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "language",
    "framework",
    "validation",
    "database",
    "orm",
    "state",
    "styling",
    "testing",
    "build",
    "tooling",
  ]),
  state: z.literal("detected"),
  evidence: z.array(z.string().min(1)).min(1),
});

export const DetectedScriptSchema = z.object({
  packagePath: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
});

export const CapabilitySchema = z.object({
  id: z.enum(["lint", "typecheck", "test", "build"]),
  state: DetectionStateSchema,
  evidence: z.array(z.string()),
});

export const ProjectInspectionSchema = z.object({
  schemaVersion: z.literal(1),
  root: z.string().min(1),
  inspectedAt: z.iso.datetime(),
  packageManager: PackageManagerDetectionSchema,
  topology: TopologyDetectionSchema,
  packages: z.array(z.string().min(1)),
  technologies: z.array(TechnologySchema),
  scripts: z.array(DetectedScriptSchema),
  capabilities: z.array(CapabilitySchema),
  matchedProfiles: z.array(z.string().min(1)),
  unknowns: z.array(z.string().min(1)),
  conflicts: z.array(z.string().min(1)),
  ambiguities: z.array(z.string().min(1)),
});

export type ProjectInspection = z.infer<typeof ProjectInspectionSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
