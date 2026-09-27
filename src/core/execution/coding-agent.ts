import { z } from "zod";
import { ExecutionContextSchema, ExecutionFailureCategorySchema, ProjectCheckpointSchema } from "./execution-contracts.js";

export const CodingAgentRequestSchema = z.object({
  executionId: z.string().regex(/^execution-[1-9][0-9]*-[a-f0-9]{10}$/),
  projectRoot: z.string().min(1),
  context: ExecutionContextSchema,
  before: ProjectCheckpointSchema,
}).strict();

export const CodingAgentResultSchema = z.object({
  outcome: z.enum(["implemented", "blocked", "failed"]),
  summary: z.string().min(1),
  changedPaths: z.array(z.string().min(1)),
  requestedScopeExpansions: z.array(z.string().min(1)),
  failureCategory: ExecutionFailureCategorySchema.nullable(),
}).strict();

export type CodingAgentRequest = z.infer<typeof CodingAgentRequestSchema>;
export type CodingAgentResult = z.infer<typeof CodingAgentResultSchema>;

/** Provider-neutral boundary. v0.6 intentionally ships no provider implementation. */
export interface CodingAgent {
  readonly id: string;
  execute(request: CodingAgentRequest): Promise<CodingAgentResult>;
}
