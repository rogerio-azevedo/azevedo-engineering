import { createHash } from "node:crypto";

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalDigest(value: unknown, length = 12): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, length);
}

export function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/** Canonical digest used by review identities. Key order does not affect the result. */
export function reviewDigest(value: unknown, length = 12): string {
  return canonicalDigest(value, length);
}
