import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  applyImmutableArtifactOperation,
  buildImmutableArtifactOperation,
  type ImmutableArtifactOperation,
} from "../filesystem/immutable-artifact.js";
import {
  ExecutionContextSchema,
  ExecutionPreparationSchema,
  ExecutionSessionSchema,
  assertNoPersistedSecrets,
  type ExecutionContext,
  type ExecutionPreparation,
  type ExecutionSession,
} from "./execution-contracts.js";

function serializeSecure(value: unknown): string {
  assertNoPersistedSecrets(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function nextExecutionSequence(projectRoot: string): number {
  const directory = join(realpathSync(projectRoot), ".azevedo", "executions");
  try {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) {
      throw new Error("Execution storage is not a safe directory.");
    }
    const sequences = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const match = entry.isDirectory() ? /^execution-([1-9][0-9]*)-[a-f0-9]{10}$/.exec(entry.name) : null;
      return match?.[1] ? [Number(match[1])] : [];
    });
    return Math.max(0, ...sequences) + 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 1;
    throw error;
  }
}

export function buildExecutionArtifactOperations(
  projectRoot: string,
  preparation: ExecutionPreparation,
  context: ExecutionContext | null,
  session: ExecutionSession | null,
): ImmutableArtifactOperation[] {
  const parsedPreparation = ExecutionPreparationSchema.parse(preparation);
  const operations = [buildImmutableArtifactOperation(
    projectRoot,
    `.azevedo/executions/preparations/${parsedPreparation.id}.json`,
    serializeSecure(parsedPreparation),
  )];
  if (context) {
    const parsed = ExecutionContextSchema.parse(context);
    if (!session || parsed.id !== session.contextId) throw new Error("Execution context must be linked to its session.");
    operations.push(buildImmutableArtifactOperation(
      projectRoot,
      `.azevedo/executions/${session.id}/context.json`,
      serializeSecure(parsed),
    ));
  }
  if (session) {
    const parsed = ExecutionSessionSchema.parse(session);
    operations.push(buildImmutableArtifactOperation(
      projectRoot,
      `.azevedo/executions/${parsed.id}/sessions/${parsed.snapshotId}.json`,
      serializeSecure(parsed),
    ));
  }
  return operations;
}

export function applyExecutionArtifactOperations(projectRoot: string, operations: readonly ImmutableArtifactOperation[]): void {
  if (operations.some((operation) => operation.action === "conflict")) {
    throw new Error("Execution artifacts contain a conflict; no artifact was written.");
  }
  for (const operation of operations) applyImmutableArtifactOperation(projectRoot, operation);
}
