import { digestOf, prismaDatasourceProvider, readJson } from "./detectors/support.js";
import type { FactStatus, ProjectFact, ProjectObservation } from "./contracts.js";
import type { GitRead } from "./git-reader.js";
import { textDigest, type RepositoryView } from "./repository-view.js";

export type EvidenceRecheck = "intact" | "changed" | "removed" | "truncated";

const SECRET_ASSIGNMENT = /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b\s*=\s*\S+/i;
const SECRET_TOKEN = /\bsk-[A-Za-z0-9_-]{8,}\b/;

function redact(command: string): { command: string | null; redacted: string | null } {
  if (SECRET_ASSIGNMENT.test(command) || SECRET_TOKEN.test(command)) return { command: null, redacted: "secret-assignment" };
  return { command, redacted: null };
}

export function recheckObservation(view: RepositoryView, git: GitRead, observation: ProjectObservation): EvidenceRecheck {
  if (observation.basis === "vcs-metadata") {
    if (observation.subject === "git") return git.isRepository ? "intact" : "removed";
    if (!git.remote) return "removed";
    return git.remote === observation.subject ? "intact" : "changed";
  }
  if (observation.basis === "presence") return view.exists(observation.location.path) ? "intact" : "removed";
  if (observation.basis === "directory-listing") {
    const listing = view.list(observation.location.path);
    if (listing.coverage === "truncated") return "truncated";
    return digestOf(listing.entries) === observation.basisDigest ? "intact" : "changed";
  }
  if (observation.sensitive) return view.exists(observation.location.path) ? "intact" : "removed";
  const text = view.readText(observation.location.path);
  if (text === null) return view.exists(observation.location.path) ? "truncated" : "removed";
  if (observation.basis === "content-match") {
    if (text.includes(observation.subject) && textDigest(observation.subject) === observation.basisDigest) return "intact";
    const provider = prismaDatasourceProvider(text);
    if (provider && observation.subject === `datasource.provider=${provider}` && textDigest(observation.subject) === observation.basisDigest) {
      return "intact";
    }
    return "changed";
  }
  if (observation.subject.startsWith("dependency:")) {
    const dependency = observation.subject.slice("dependency:".length);
    const json = readJson(view, observation.location.path);
    if (!json) return "removed";
    const present = ["dependencies", "devDependencies", "peerDependencies"].some((section) => {
      const value = json[section];
      return value !== null && typeof value === "object" && !Array.isArray(value) && dependency in value;
    });
    return present && digestOf({ dependency }) === observation.basisDigest ? "intact" : "removed";
  }
  if (observation.subject === "packageManager") {
    const json = readJson(view, observation.location.path);
    const declared = typeof json?.packageManager === "string" ? json.packageManager.split("@")[0] : null;
    return declared && digestOf({ manager: declared }) === observation.basisDigest ? "intact" : "changed";
  }
  if (observation.subject === "engines.node") {
    const json = readJson(view, observation.location.path);
    const engines = json?.engines;
    const node = engines && typeof engines === "object" && !Array.isArray(engines) && typeof (engines as Record<string, unknown>).node === "string"
      ? (engines as Record<string, string>).node
      : null;
    return node && digestOf({ node }) === observation.basisDigest ? "intact" : "changed";
  }
  if (observation.subject.startsWith("scripts.")) {
    const name = observation.subject.slice("scripts.".length);
    const json = readJson(view, observation.location.path);
    const scripts = json?.scripts;
    const command = scripts && typeof scripts === "object" && !Array.isArray(scripts) ? (scripts as Record<string, unknown>)[name] : null;
    if (typeof command !== "string") return "removed";
    const redacted = redact(command);
    return digestOf({ script: name, command: redacted.command, redacted: redacted.redacted }) === observation.basisDigest ? "intact" : "changed";
  }
  if (observation.subject === "jest") {
    const json = readJson(view, observation.location.path);
    return json && "jest" in json && digestOf({ key: "jest" }) === observation.basisDigest ? "intact" : "removed";
  }
  return text.includes(observation.subject) ? "intact" : "changed";
}

export function statusFromRechecks(fact: ProjectFact, results: readonly EvidenceRecheck[], probeTripped: boolean): FactStatus {
  if (fact.claim.form === "behavior" || results.length === 0) return "needs-revalidation";
  if (probeTripped) return "conflicted";
  if (fact.claim.form === "enumeration") {
    if (results.some((result) => result === "truncated")) return "needs-revalidation";
    return results.every((result) => result === "intact") ? "validated" : "stale";
  }
  if (results.every((result) => result === "intact")) return "validated";
  if (results.some((result) => result === "changed" || result === "removed")) return "stale";
  return "needs-revalidation";
}
