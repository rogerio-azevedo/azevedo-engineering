import type { ProjectFactDetector } from "./support.js";
import { addFact, addObservation, digestOf, emptyOutput } from "./support.js";

const DETECTOR = { id: "vcs.git", version: 1 };

export const vcsDetector: ProjectFactDetector = {
  id: DETECTOR.id,
  version: DETECTOR.version,
  claims: [
    { category: "vcs", key: "vcs.git", cardinality: "single", form: "existence" },
    { category: "vcs", key: "vcs.remote", cardinality: "single", form: "existence" },
  ],
  detect({ view, git }) {
    const output = emptyOutput();
    if (!git.isRepository) return output;
    const gitObservation = addObservation(output, view, {
      path: ".git",
      basis: "vcs-metadata",
      subject: "git",
      basisDigest: digestOf("git"),
      coverage: "complete",
    });
    addFact(output, view, DETECTOR, {
      category: "vcs",
      key: "vcs.git",
      value: { kind: "text", text: "git" },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["."],
      supports: [gitObservation.id],
      evidenceQuality: "direct",
      rule: "git-metadata",
    });
    if (git.remote) {
      const remoteObservation = addObservation(output, view, {
        path: ".git",
        basis: "vcs-metadata",
        subject: git.remote,
        basisDigest: digestOf({ remote: git.remote }),
        coverage: "complete",
      });
      addFact(output, view, DETECTOR, {
        category: "vcs",
        key: "vcs.remote",
        value: { kind: "text", text: git.remote },
        cardinality: "single",
        form: "existence",
        pathPrefixes: ["."],
        supports: [remoteObservation.id],
        evidenceQuality: "direct",
        rule: "git-remote",
      });
    }
    return output;
  },
};
