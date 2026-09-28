import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  applyImmutableArtifactOperation,
  buildImmutableArtifactOperation,
  type ImmutableArtifactOperation,
} from "../filesystem/immutable-artifact.js";
import { assertNoPersistedSecrets } from "../execution/execution-contracts.js";
import {
  ReviewPreparationSchema,
  ReviewReportSchema,
  type ReviewPreparation,
  type ReviewReport,
} from "./review-contracts.js";

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && resolve(root, path) === candidate;
}

function readSafeJson(root: string, path: string): unknown {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile() || !isWithin(root, realpathSync(path))) {
    throw new Error(`Review artifact is not a safe regular file: ${relative(root, path)}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function secureJson(value: unknown): string {
  assertNoPersistedSecrets(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildReviewArtifactOperations(
  projectRoot: string,
  preparation: ReviewPreparation,
  report: ReviewReport | null = null,
): ImmutableArtifactOperation[] {
  const parsed = ReviewPreparationSchema.parse(preparation);
  const root = `.azevedo/reviews/${parsed.context.id}`;
  const operations = [
    buildImmutableArtifactOperation(projectRoot, `${root}/context.json`, secureJson(parsed.context)),
    buildImmutableArtifactOperation(projectRoot, `${root}/preparations/${parsed.id}.json`, secureJson(parsed)),
  ];
  if (report) {
    const parsedReport = ReviewReportSchema.parse(report);
    if (parsedReport.contextId !== parsed.context.id) throw new Error("Review report belongs to a different context.");
    operations.push(buildImmutableArtifactOperation(
      projectRoot,
      `${root}/reports/${parsedReport.id}.json`,
      secureJson(parsedReport),
    ));
  }
  return operations;
}

export function applyReviewArtifactOperations(
  projectRoot: string,
  operations: readonly ImmutableArtifactOperation[],
): void {
  if (operations.some((operation) => operation.action === "conflict")) {
    throw new Error("Review artifacts contain a conflict; no artifact was written.");
  }
  for (const operation of operations) applyImmutableArtifactOperation(projectRoot, operation);
}

export function loadReviewPreparation(projectRoot: string, contextId: string): ReviewPreparation {
  if (!/^review-context-[a-f0-9]{12}$/.test(contextId)) throw new Error(`Invalid review context id: ${contextId}`);
  const root = realpathSync(projectRoot);
  const directory = join(root, ".azevedo", "reviews", contextId, "preparations");
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory() || !isWithin(root, realpathSync(directory))) {
    throw new Error(`Review preparation storage is not a safe directory: ${contextId}`);
  }
  const preparations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^review-preparation-[a-f0-9]{12}\.json$/.test(entry.name))
    .map((entry) => ReviewPreparationSchema.parse(readSafeJson(root, join(directory, entry.name))))
    .filter((preparation) => preparation.context.id === contextId);
  if (preparations.length !== 1) throw new Error(
    preparations.length === 0
      ? `Review preparation not found for ${contextId}.`
      : `Review preparation is ambiguous for ${contextId}.`,
  );
  return preparations[0]!;
}
