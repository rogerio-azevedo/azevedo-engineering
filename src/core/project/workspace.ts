import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ProjectOnboardingError } from "./identity.js";

function isInside(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

export function resolveWorkspace(cwd: string, explicit: string | undefined, envValue: string | undefined): string {
  const selected = explicit ?? envValue ?? cwd;
  const resolved = resolve(cwd, selected);
  if (!existsSync(resolved)) throw new ProjectOnboardingError(`Workspace does not exist: ${resolved}`);
  return realpathSync(resolved);
}

export function registryRoot(workspace: string): string {
  return join(workspace, "var");
}

export function assertRegistryDisjoint(workspace: string, target: string): void {
  const targetReal = realpathSync(target);
  const registry = registryRoot(workspace);
  if (isInside(targetReal, registry) || isInside(registry, targetReal)) {
    throw new ProjectOnboardingError(
      "Project registry must not overlap the onboarding target. Pass --workspace pointing outside the target.",
    );
  }
}
