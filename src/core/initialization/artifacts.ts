import { z } from "zod";

export const InitializationArtifactSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
  ownership: z.enum(["azevedo-managed", "adapter-managed"]),
  order: z.number().int().nonnegative(),
});

export type InitializationArtifact = z.infer<typeof InitializationArtifactSchema>;

export function renderAzevedoConfig(adapter: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(adapter)) throw new Error(`Invalid adapter id: ${adapter}`);
  return `schemaVersion: 1
project:
  root: .
engineering:
  adapter: ${adapter}
`;
}

export const AZEVEDO_LOCAL_README_CONTENT = `# Azevedo Engineering local state

This directory is reserved for local state and artifacts produced by Azevedo Engineering capabilities.

Only files introduced by an explicit Azevedo Engineering operation should be stored here. This bootstrap file is versionable; future evidence or cache policies will be defined by the capabilities that need them.
`;

export function createCoreInitializationArtifacts(adapter: string): InitializationArtifact[] {
  return [
    InitializationArtifactSchema.parse({
      path: "azevedo.config.yaml",
      content: renderAzevedoConfig(adapter),
      ownership: "azevedo-managed",
      order: 10,
    }),
    InitializationArtifactSchema.parse({
      path: ".azevedo/README.md",
      content: AZEVEDO_LOCAL_README_CONTENT,
      ownership: "azevedo-managed",
      order: 30,
    }),
  ];
}
