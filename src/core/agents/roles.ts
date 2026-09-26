import { z } from "zod";

export const AgentRoleSchema = z.object({
  id: z.enum(["explorer", "architect", "reviewer", "security-reviewer"]),
  summary: z.string().min(1),
  delegatesWhen: z.array(z.string().min(1)).min(1),
  output: z.string().min(1),
  sandbox: z.literal("read-only"),
  instructions: z.string().min(1),
});

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AGENT_ROLES = [
  {
    id: "explorer",
    summary: "Maps repository facts, dependencies, conventions, tests, and unknowns.",
    delegatesWhen: ["The task needs bounded repository research before planning."],
    output: "Evidence-backed map with paths, symbols, unknowns, and no edits.",
    sandbox: "read-only",
    instructions:
      "Inspect only the requested scope. Cite concrete paths and symbols, separate facts from inference, report unknowns, and do not edit files or expand the task.",
  },
  {
    id: "architect",
    summary: "Evaluates changes with genuine architectural impact.",
    delegatesWhen: [
      "A change adds a structural dependency, boundary, persistence or authentication strategy, package, app, integration, public contract, component flow, or technology decision.",
    ],
    output: "Options, trade-offs, compatibility impact, and a recommended bounded decision.",
    sandbox: "read-only",
    instructions:
      "Review only material architecture decisions. Evaluate existing boundaries and constraints, compare viable alternatives, state consequences, and avoid implementation edits.",
  },
  {
    id: "reviewer",
    summary: "Reviews a diff for correctness, regressions, tests, and scope.",
    delegatesWhen: ["A non-trivial change is ready for independent review."],
    output: "Evidence-backed findings with severity, confidence, location, failure mode, and impact.",
    sandbox: "read-only",
    instructions:
      "Review the supplied diff and nearby context. Report only actionable correctness, regression, test, or explicit-policy issues. Zero findings is valid. Do not edit files.",
  },
  {
    id: "security-reviewer",
    summary: "Reviews trust boundaries, abuse cases, and security regressions.",
    delegatesWhen: [
      "The change touches auth, authorization, external input, public contracts, data access, secrets, permissions, processes, filesystem, or integrations.",
    ],
    output: "Threat-oriented findings with exploit scenario, impact, evidence, and severity.",
    sandbox: "read-only",
    instructions:
      "Inspect the changed trust boundaries and applicable stack. Prioritize concrete exploit or abuse paths, include negative authorization cases, and do not edit files.",
  },
] as const satisfies readonly AgentRole[];
