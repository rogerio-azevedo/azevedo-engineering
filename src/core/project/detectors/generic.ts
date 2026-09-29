import type { ProjectFactDetector } from "./support.js";
import { addFact, addObservation, addUnknown, emptyOutput } from "./support.js";

const MANIFESTS = [
  { file: "go.mod", ecosystem: "Go" },
  { file: "pyproject.toml", ecosystem: "Python" },
  { file: "Cargo.toml", ecosystem: "Rust" },
  { file: "pom.xml", ecosystem: "Java" },
  { file: "Dockerfile", ecosystem: "container" },
  { file: "docker-compose.yml", ecosystem: "compose" },
  { file: "compose.yaml", ecosystem: "compose" },
] as const;

export const genericManifestDetector: ProjectFactDetector = {
  id: "generic.manifests",
  version: 1,
  claims: MANIFESTS.map((manifest) => ({
    category: "package-ecosystem" as const,
    key: `package-ecosystem.${manifest.file}`,
    cardinality: "single" as const,
    form: "existence" as const,
  })),
  detect({ view }) {
    const output = emptyOutput();
    for (const manifest of MANIFESTS) {
      if (!view.exists(manifest.file)) continue;
      const support = addObservation(output, view, {
        path: manifest.file,
        basis: "presence",
        subject: manifest.file,
        coverage: "complete",
      });
      addFact(output, view, genericManifestDetector, {
        category: "package-ecosystem",
        key: `package-ecosystem.${manifest.file}`,
        value: { kind: "text", text: manifest.ecosystem },
        cardinality: "single",
        form: "existence",
        level: "path",
        pathPrefixes: [manifest.file],
        supports: [support.id],
        evidenceQuality: "indirect",
        rule: "manifest-presence",
      });
      if (manifest.ecosystem !== "container" && manifest.ecosystem !== "compose") {
        addUnknown(output, view, `ecosystem.${manifest.ecosystem.toLowerCase()}`, `No ${manifest.ecosystem} detector is available; only manifest presence was observed.`);
      }
    }
    const listing = view.list(".");
    const csproj = listing.entries.find((entry) => entry.endsWith(".csproj"));
    if (csproj) {
      const support = addObservation(output, view, { path: csproj, basis: "presence", subject: csproj, coverage: "complete" });
      addFact(output, view, genericManifestDetector, {
        category: "package-ecosystem",
        key: "package-ecosystem.dotnet",
        value: { kind: "text", text: ".NET" },
        cardinality: "single",
        form: "existence",
        level: "path",
        pathPrefixes: [csproj],
        supports: [support.id],
        evidenceQuality: "indirect",
        rule: "manifest-presence",
      });
      addUnknown(output, view, "ecosystem.dotnet", "No .NET detector is available; only manifest presence was observed.");
    }
    return output;
  },
};
