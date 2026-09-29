import { isSensitivePath } from "../sensitive-paths.js";
import type { ProjectFactDetector } from "./support.js";
import { addFact, addObservation, emptyOutput } from "./support.js";

export const sensitiveMaterialDetector: ProjectFactDetector = {
  id: "safety.sensitive-material",
  version: 1,
  claims: [
    { category: "safety", key: "safety.sensitive-material", cardinality: "multiple", form: "existence" },
  ],
  detect({ view }) {
    const output = emptyOutput();
    const listing = view.list(".");
    const paths = listing.entries.filter((entry) => isSensitivePath(entry) && view.exists(entry)).sort();
    if (paths.length === 0) return output;
    const supports = paths.map((path) => addObservation(output, view, {
      path,
      basis: "presence",
      subject: "sensitive-file",
      sensitive: true,
      coverage: "complete",
    }).id);
    addFact(output, view, sensitiveMaterialDetector, {
      category: "safety",
      key: "safety.sensitive-material",
      value: { kind: "list", items: paths },
      cardinality: "multiple",
      form: "existence",
      pathPrefixes: paths,
      supports,
      evidenceQuality: "direct",
      rule: "sensitive-path-presence",
    });
    return output;
  },
};
