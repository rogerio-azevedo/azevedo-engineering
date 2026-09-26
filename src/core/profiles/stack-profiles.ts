import { z } from "zod";
import { ComponentIdSchema } from "../schemas/component.js";

export const StackProfileSchema = z.object({
  id: ComponentIdSchema,
  version: z.number().int().positive(),
  summary: z.string().min(1),
  requiredTechnologies: z.array(z.string().min(1)).min(1),
  recommendedCapabilities: z.array(z.enum(["lint", "typecheck", "test", "build"])),
  stability: z.enum(["experimental", "beta", "stable"]),
});

export type StackProfile = z.infer<typeof StackProfileSchema>;

export const STACK_PROFILES = [
  {
    id: "profile.typescript",
    version: 1,
    summary: "TypeScript projects with type-aware verification.",
    requiredTechnologies: ["typescript"],
    recommendedCapabilities: ["typecheck", "test", "build"],
    stability: "beta",
  },
  {
    id: "profile.nestjs",
    version: 1,
    summary: "NestJS backend projects.",
    requiredTechnologies: ["nestjs"],
    recommendedCapabilities: ["lint", "typecheck", "test", "build"],
    stability: "beta",
  },
  {
    id: "profile.nextjs",
    version: 1,
    summary: "Next.js frontend or full-stack projects.",
    requiredTechnologies: ["nextjs"],
    recommendedCapabilities: ["lint", "typecheck", "test", "build"],
    stability: "beta",
  },
  {
    id: "profile.postgres-drizzle",
    version: 1,
    summary: "PostgreSQL persistence using Drizzle ORM.",
    requiredTechnologies: ["postgresql", "drizzle"],
    recommendedCapabilities: ["typecheck", "test", "build"],
    stability: "beta",
  },
  {
    id: "profile.mongodb-mongoose",
    version: 1,
    summary: "MongoDB persistence using Mongoose.",
    requiredTechnologies: ["mongodb", "mongoose"],
    recommendedCapabilities: ["typecheck", "test", "build"],
    stability: "beta",
  },
  {
    id: "profile.react-native-expo",
    version: 1,
    summary: "Future React Native projects using Expo.",
    requiredTechnologies: ["react-native", "expo"],
    recommendedCapabilities: ["lint", "typecheck", "test", "build"],
    stability: "experimental",
  },
] as const satisfies readonly StackProfile[];

export const AZEVEDO_REFERENCE_MANIFEST = {
  id: "azevedo-reference",
  version: 1,
  description: "Reference composition for new Azevedo projects; never forced onto existing projects.",
  profiles: [
    "profile.typescript",
    "profile.nestjs",
    "profile.nextjs",
    "profile.postgres-drizzle",
    "profile.mongodb-mongoose",
  ],
  packageManager: "pnpm",
  monorepoTool: "turbo",
} as const;

export function matchStackProfiles(technologyIds: ReadonlySet<string>): string[] {
  return STACK_PROFILES.filter((profile) =>
    profile.requiredTechnologies.every((technology) => technologyIds.has(technology)),
  ).map((profile) => profile.id);
}

