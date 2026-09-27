import { relative, resolve, sep } from "node:path";
import { ScopeExpansionSchema, type ExecutionContext, type ScopeExpansion } from "./execution-contracts.js";

function within(root: string, path: string): boolean {
  const result = relative(root, path);
  return result !== ".." && !result.startsWith(`..${sep}`) && !result.startsWith(sep);
}

export function authorizeScopeExpansion(
  projectRoot: string,
  context: ExecutionContext,
  rawExpansion: ScopeExpansion,
): ScopeExpansion {
  const expansion = ScopeExpansionSchema.parse(rawExpansion);
  const destination = resolve(projectRoot, expansion.path);
  if (!within(resolve(projectRoot), destination)) throw new Error(`Scope expansion escapes the project root: ${expansion.path}`);
  const knownEvidence = new Set(context.evidence.map((item) => item.id));
  const unknownEvidence = expansion.evidenceIds.filter((id) => !knownEvidence.has(id));
  if (unknownEvidence.length > 0) throw new Error(`Scope expansion cites unknown evidence: ${unknownEvidence.join(", ")}`);
  if (context.permissions.sourceWrite === "denied") throw new Error("Scope cannot expand while source writing is denied.");
  return expansion;
}

export function isPathAuthorized(context: ExecutionContext, expansions: readonly ScopeExpansion[], path: string): boolean {
  if (expansions.some((item) => path === item.path || path.startsWith(`${item.path}/`))) return true;
  if (context.permissions.excludedCandidatePaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))) return false;
  return context.permissions.allowedPaths.some((allowed) =>
    path === allowed || path.startsWith(`${allowed}/`) || allowed.startsWith(`${path}/`),
  );
}
