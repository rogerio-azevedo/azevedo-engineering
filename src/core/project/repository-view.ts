import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { sha256Digest } from "../filesystem/canonical-digest.js";
import type { ObservationCoverage } from "./contracts.js";
import { ProjectOnboardingError } from "./identity.js";
import { isSensitivePath } from "./sensitive-paths.js";

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_READS = 80;
export const MAX_LISTINGS = 40;
export const MAX_LISTING_ENTRIES = 50;

export type DirectoryListing = {
  entries: string[];
  coverage: Extract<ObservationCoverage, "complete" | "truncated">;
};

export type RepositoryView = {
  root: string;
  repositoryId: string;
  revision: string | null;
  filesRead: number;
  listings: number;
  stopReason: "sufficient" | "budget-exhausted";
  exists(relativePath: string): boolean;
  readText(relativePath: string): string | null;
  list(relativePath: string): DirectoryListing;
};

function portable(path: string): string {
  return path.split(sep).join("/");
}

function lexical(root: string, relativePath: string): string | null {
  const normalized = portable(relativePath);
  if (!normalized || normalized === ".") return root;
  if (normalized.split("/").includes("..") || normalized.startsWith("/")) return null;
  const absolute = resolve(root, normalized);
  const value = relative(root, absolute);
  if (value.startsWith("..") || value === "..") return null;
  return absolute;
}

function realInside(root: string, absolute: string): string | null {
  try {
    const real = realpathSync(absolute);
    if (real === root || real.startsWith(`${root}${sep}`)) return real;
    return null;
  } catch {
    return null;
  }
}

export function createRepositoryView(
  root: string,
  repositoryId: string,
  revision: string | null,
  limits?: { maxReads?: number; maxListings?: number; maxListingEntries?: number },
): RepositoryView {
  const maxReads = limits?.maxReads ?? MAX_READS;
  const maxListings = limits?.maxListings ?? MAX_LISTINGS;
  const maxListingEntries = limits?.maxListingEntries ?? MAX_LISTING_ENTRIES;
  const realRoot = realpathSync(root);
  let filesRead = 0;
  let listings = 0;
  let exhausted = false;

  const markRead = (): boolean => {
    if (filesRead >= maxReads) {
      exhausted = true;
      return false;
    }
    filesRead += 1;
    return true;
  };

  return {
    root: realRoot,
    repositoryId,
    revision,
    get filesRead() { return filesRead; },
    get listings() { return listings; },
    get stopReason() { return exhausted ? "budget-exhausted" as const : "sufficient" as const; },
    exists(relativePath: string): boolean {
      const absolute = lexical(realRoot, relativePath);
      if (!absolute) return false;
      return realInside(realRoot, absolute) !== null;
    },
    readText(relativePath: string): string | null {
      if (isSensitivePath(relativePath)) {
        throw new ProjectOnboardingError(`Refusing to read sensitive path: ${relativePath}`);
      }
      const absolute = lexical(realRoot, relativePath);
      const real = absolute ? realInside(realRoot, absolute) : null;
      if (!real) return null;
      const realRelative = portable(relative(realRoot, real));
      if (realRelative && isSensitivePath(realRelative)) {
        throw new ProjectOnboardingError(`Refusing to read sensitive path: ${relativePath}`);
      }
      let stats;
      try {
        stats = lstatSync(real);
      } catch {
        return null;
      }
      if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
      if (!markRead()) return null;
      return readFileSync(real, "utf8");
    },
    list(relativePath: string): DirectoryListing {
      const absolute = lexical(realRoot, relativePath);
      const real = absolute ? realInside(realRoot, absolute) : null;
      if (!real) return { entries: [], coverage: "truncated" };
      if (listings >= maxListings) {
        exhausted = true;
        return { entries: [], coverage: "truncated" };
      }
      listings += 1;
      let names: string[];
      try {
        names = readdirSync(real).sort();
      } catch {
        return { entries: [], coverage: "complete" };
      }
      if (names.length > maxListingEntries) {
        exhausted = true;
        return { entries: names.slice(0, maxListingEntries), coverage: "truncated" };
      }
      return { entries: names, coverage: "complete" };
    },
  };
}

export function presenceDigest(): string {
  return sha256Digest("present");
}

export function textDigest(value: string): string {
  return sha256Digest(value);
}
