import type { Claim, ProjectObservation } from "./contracts.js";

export type Coverage = {
  form: Claim["form"];
  level: Claim["scope"]["level"];
  complete: boolean;
};

function inScope(claim: Claim, observation: ProjectObservation): boolean {
  if (claim.scope.repositoryIds.length > 0 && observation.location.repositoryId &&
    !claim.scope.repositoryIds.includes(observation.location.repositoryId)) return false;
  if (claim.scope.pathPrefixes.length === 0) return claim.scope.level === "project";
  return claim.scope.pathPrefixes.some((prefix) => {
    const path = observation.location.path;
    return path === prefix || path.startsWith(`${prefix}/`) || prefix === ".";
  });
}

export function requiredCoverage(claim: Claim): Coverage {
  return { form: claim.form, level: claim.scope.level, complete: claim.form !== "behavior" };
}

export function providedCoverage(claim: Claim, observations: readonly ProjectObservation[]): Coverage {
  const scoped = observations.filter((observation) => inScope(claim, observation));
  if (claim.form === "behavior") return { form: "behavior", level: claim.scope.level, complete: false };
  if (claim.form === "enumeration") {
    const listing = scoped.find((observation) => observation.basis === "directory-listing");
    return { form: "enumeration", level: claim.scope.level, complete: listing?.coverage === "complete" };
  }
  return {
    form: "existence",
    level: claim.scope.level,
    complete: scoped.some((observation) => observation.coverage !== "truncated"),
  };
}

export function coverageSatisfies(required: Coverage, provided: Coverage): boolean {
  return required.form === provided.form && required.level === provided.level && required.complete && provided.complete;
}
