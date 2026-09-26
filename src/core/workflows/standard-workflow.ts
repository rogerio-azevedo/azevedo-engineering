import type { Workflow } from "../schemas/workflow.js";

export const STANDARD_WORKFLOW = {
  id: "workflow.delivery",
  version: 1,
  phases: [
    { id: "understand", summary: "Establish intent and constraints.", output: "Acceptance criteria and scope", gate: "Critical ambiguity is resolved or recorded." },
    { id: "research", summary: "Gather only relevant evidence.", output: "Repository and primary-source evidence", gate: "Relevant unknowns are explicit." },
    { id: "plan", summary: "Map the smallest verifiable change.", output: "Change, risk, test, and rollback plan", gate: "The plan is proportional and testable." },
    { id: "implement", summary: "Apply the bounded change.", output: "Traceable implementation", gate: "There is no silent scope expansion." },
    { id: "test", summary: "Prove changed behavior.", output: "Tests or domain-specific proof", gate: "Applicable tests pass and TDD disposition is recorded." },
    { id: "review", summary: "Inspect the resulting diff.", output: "Findings and dispositions", gate: "No blocking finding remains open." },
    { id: "verify", summary: "Execute the resolved gates.", output: "Revision-bound evidence", gate: "Required evidence passes or has a valid disposition." },
    { id: "document", summary: "Keep operational knowledge aligned.", output: "Necessary docs and ADRs", gate: "Documentation is not stale for the change." },
    { id: "learn", summary: "Capture, but do not promote, reusable observations.", output: "Zero or more governed candidates", gate: "No automatic promotion occurred." },
    { id: "done", summary: "Evaluate completion.", output: "Final report", gate: "Definition of Done is satisfied for the current revision." },
  ],
} as const satisfies Workflow;

