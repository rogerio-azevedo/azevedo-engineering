import type { ProjectInspection } from "../../schemas/discovery.js";
import type { ProjectFactDetector } from "./support.js";
import {
  addFact,
  addObservation,
  addUnknown,
  digestOf,
  emptyOutput,
  hasDependency,
  prismaDatasourceProvider,
  readJson,
} from "./support.js";
import type { RepositoryView } from "../repository-view.js";
import { presenceDigest, textDigest } from "../repository-view.js";

const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"] as const;
const SECRET_ASSIGNMENT = /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b\s*=\s*\S+/i;
const SECRET_TOKEN = /\bsk-[A-Za-z0-9_-]{8,}\b/;

const FRAMEWORKS = [
  { key: "framework.nestjs", name: "NestJS", dependencies: ["@nestjs/core"], files: ["nest-cli.json"], patterns: [{ path: "src/main.ts", text: "NestFactory" }] },
  { key: "framework.nextjs", name: "Next.js", dependencies: ["next"], files: ["next.config.js", "next.config.mjs", "next.config.ts"], patterns: [] },
  { key: "framework.react-native", name: "React Native", dependencies: ["react-native"], files: [], patterns: [] },
  { key: "framework.expo", name: "Expo", dependencies: ["expo"], files: ["app.json"], patterns: [] },
  { key: "framework.express", name: "Express", dependencies: ["express"], files: [], patterns: [] },
] as const;

const ORMS = [
  { key: "persistence.prisma", name: "Prisma", dependencies: ["prisma", "@prisma/client"], schema: "prisma/schema.prisma" },
  { key: "persistence.drizzle", name: "Drizzle", dependencies: ["drizzle-orm"], schema: "drizzle.config.ts" },
  { key: "persistence.typeorm", name: "TypeORM", dependencies: ["typeorm"], schema: null },
  { key: "persistence.mongoose", name: "Mongoose", dependencies: ["mongoose"], schema: null },
  { key: "persistence.sequelize", name: "Sequelize", dependencies: ["sequelize"], schema: null },
  { key: "persistence.knex", name: "Knex", dependencies: ["knex"], schema: null },
] as const;

const DRIVERS = [
  { key: "persistence.postgresql", name: "PostgreSQL", dependencies: ["pg", "postgres"] },
  { key: "persistence.mongodb", name: "MongoDB", dependencies: ["mongodb"] },
] as const;

const CONTRACTS = [
  { key: "api.graphql", name: "GraphQL", dependencies: ["graphql", "@nestjs/graphql", "@apollo/server"], files: ["schema.graphql", "src/schema.graphql"] },
  { key: "api.openapi", name: "OpenAPI", dependencies: ["@nestjs/swagger"], files: ["openapi.yaml", "openapi.json", "swagger.json"] },
  { key: "api.messaging", name: "messaging", dependencies: ["amqplib", "bullmq", "@nestjs/bull", "kafkajs"], files: [] },
] as const;

const INTEGRATIONS = [
  { key: "auth.signal", name: "authentication", dependencies: ["passport", "@nestjs/passport", "jsonwebtoken"], guard: true },
  { key: "external-effect.email", name: "email", dependencies: ["nodemailer", "@sendgrid/mail", "resend"], guard: false },
  { key: "external-effect.storage", name: "object-storage", dependencies: ["@aws-sdk/client-s3", "multer"], guard: false },
  { key: "external-effect.payments", name: "payments", dependencies: ["stripe"], guard: false },
] as const;

const TEST_FRAMEWORKS = [
  { key: "testing.jest", name: "Jest", dependencies: ["jest"], files: ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"] },
  { key: "testing.vitest", name: "Vitest", dependencies: ["vitest"], files: ["vitest.config.ts", "vitest.config.js", "vitest.config.mjs"] },
  { key: "testing.playwright", name: "Playwright", dependencies: ["@playwright/test", "playwright"], files: ["playwright.config.ts", "playwright.config.js"] },
] as const;

function redactCommand(command: string): { command: string | null; redacted: string | null } {
  if (SECRET_ASSIGNMENT.test(command) || SECRET_TOKEN.test(command)) return { command: null, redacted: "secret-assignment" };
  return { command, redacted: null };
}

function ecosystemDetector(id: string, version: number, claims: ProjectFactDetector["claims"], detect: ProjectFactDetector["detect"]): ProjectFactDetector {
  return { id, version, claims, detect };
}

export const nodeEcosystemDetector = ecosystemDetector("node.ecosystem", 1, [
  { category: "package-ecosystem", key: "package-ecosystem.node", cardinality: "single", form: "existence" },
  { category: "package-ecosystem", key: "package-manager", cardinality: "single", form: "existence" },
  { category: "topology", key: "topology", cardinality: "single", form: "existence" },
  { category: "language", key: "language.typescript", cardinality: "single", form: "existence" },
  { category: "runtime", key: "runtime.node", cardinality: "single", form: "existence" },
  { category: "framework", key: "framework.nestjs", cardinality: "single", form: "existence" },
  { category: "framework", key: "framework.nextjs", cardinality: "single", form: "existence" },
  { category: "build", key: "capability.lint", cardinality: "multiple", form: "existence" },
  { category: "build", key: "capability.typecheck", cardinality: "multiple", form: "existence" },
  { category: "testing", key: "capability.test", cardinality: "multiple", form: "existence" },
  { category: "build", key: "capability.build", cardinality: "multiple", form: "existence" },
], ({ view, inspection }) => {
  const output = emptyOutput();
  if (!view.exists("package.json")) return output;
  const manifest = addObservation(output, view, { path: "package.json", basis: "presence", subject: "package.json", coverage: "complete" });
  addFact(output, view, { id: "node.ecosystem", version: 1 }, {
    category: "package-ecosystem",
    key: "package-ecosystem.node",
    value: { kind: "text", text: "node" },
    cardinality: "single",
    form: "existence",
    pathPrefixes: ["package.json"],
    supports: [manifest.id],
    evidenceQuality: "direct",
    rule: "package-manifest",
  });
  if (inspection?.packageManager.state === "detected" && inspection.packageManager.value) {
    const supports = inspection.packageManager.evidence.map((evidence) => addObservation(output, view, {
      path: evidence.startsWith("package.json") ? "package.json" : evidence,
      basis: evidence.startsWith("package.json") ? "manifest-entry" : "presence",
      subject: evidence.startsWith("package.json") ? "packageManager" : evidence,
      basisDigest: evidence.startsWith("package.json") ? digestOf({ manager: inspection.packageManager.value }) : presenceDigest(),
      coverage: "complete",
    }).id);
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: "package-ecosystem",
      key: "package-manager",
      value: { kind: "text", text: inspection.packageManager.value },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["."],
      supports,
      contradictionProbes: LOCKFILES.filter((file) => !inspection.packageManager.evidence.includes(file)),
      evidenceQuality: "direct",
      rule: "lockfile-or-package-manager",
    });
  } else if (inspection?.packageManager.state === "ambiguous") {
    addUnknown(output, view, "package-manager", "Conflicting package manager evidence.");
  } else {
    addUnknown(output, view, "package-manager", "No lockfile or packageManager field was observed.");
  }
  if (inspection?.topology.value) {
    const supports = (inspection.topology.evidence.length > 0 ? inspection.topology.evidence : ["package.json"]).map((evidence) => addObservation(output, view, {
      path: evidence.startsWith("package.json") ? "package.json" : evidence,
      basis: evidence === "package.json" || evidence.startsWith("package.json#") ? "manifest-entry" : "presence",
      subject: evidence,
      coverage: "complete",
    }).id);
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: "topology",
      key: "topology",
      value: { kind: "text", text: inspection.topology.value },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["."],
      supports,
      evidenceQuality: "direct",
      rule: "workspace-manifest",
    });
  }
  const typescriptEvidence = inspection?.technologies.find((technology) => technology.id === "typescript")?.evidence ?? [];
  if (typescriptEvidence.length > 0) {
    const supports = typescriptEvidence.map((evidence) => addObservation(output, view, {
      path: evidence.includes("#") ? evidence.slice(0, evidence.indexOf("#")) : evidence,
      basis: evidence.includes("#") ? "manifest-entry" : "presence",
      subject: evidence.includes("#") ? "dependency:typescript" : evidence,
      coverage: "complete",
    }).id);
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: "language",
      key: "language.typescript",
      value: { kind: "text", text: "TypeScript" },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["."],
      supports,
      evidenceQuality: supports.length > 1 ? "corroborated" : "direct",
      rule: "typescript-manifest",
    });
  }
  const packageJson = readJson(view, "package.json");
  const engines = packageJson?.engines;
  const nodeEngine = engines && typeof engines === "object" && !Array.isArray(engines) && typeof (engines as JsonRecord).node === "string"
    ? (engines as JsonRecord).node
    : null;
  if (nodeEngine) {
    const support = addObservation(output, view, {
      path: "package.json",
      basis: "manifest-entry",
      subject: "engines.node",
      basisDigest: digestOf({ node: nodeEngine }),
      coverage: "complete",
    });
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: "runtime",
      key: "runtime.node",
      value: { kind: "text", text: nodeEngine },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["package.json"],
      supports: [support.id],
      evidenceQuality: "direct",
      rule: "engines.node",
    });
  } else if (view.exists(".nvmrc")) {
    const support = addObservation(output, view, { path: ".nvmrc", basis: "presence", subject: ".nvmrc", coverage: "complete" });
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: "runtime",
      key: "runtime.node",
      value: { kind: "text", text: "node" },
      cardinality: "single",
      form: "existence",
      pathPrefixes: [".nvmrc"],
      supports: [support.id],
      evidenceQuality: "indirect",
      rule: "nvmrc-presence",
    });
  }
  for (const framework of FRAMEWORKS) {
    const declared = framework.dependencies.flatMap((dependency) => hasDependency(view, inspection, dependency).map((path) => ({ dependency, path })));
    if (declared.length === 0) continue;
    const supports = declared.map((entry) => addObservation(output, view, {
      path: entry.path,
      basis: "manifest-entry",
      subject: `dependency:${entry.dependency}`,
      basisDigest: digestOf({ dependency: entry.dependency }),
      coverage: "complete",
    }));
    const corroborating: typeof supports = [];
    for (const file of framework.files) {
      if (!view.exists(file)) continue;
      corroborating.push(addObservation(output, view, { path: file, basis: "presence", subject: file, coverage: "complete" }));
    }
    for (const pattern of framework.patterns) {
      const text = view.readText(pattern.path);
      if (!text?.includes(pattern.text)) continue;
      corroborating.push(addObservation(output, view, {
        path: pattern.path,
        basis: "content-match",
        subject: pattern.text,
        basisDigest: textDigest(pattern.text),
        coverage: "complete",
      }));
    }
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: "framework",
      key: framework.key,
      value: { kind: "text", text: framework.name },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["."],
      supports: [...supports, ...corroborating].map((item) => item.id),
      evidenceQuality: corroborating.length > 0 ? "corroborated" : "indirect",
      rule: corroborating.length > 0 ? "dependency-and-structure" : "dependency-only",
    });
  }
  for (const capability of inspection?.capabilities ?? []) {
    if (capability.state !== "detected") {
      addUnknown(output, view, `${capability.id}-command`, `No ${capability.id} script was observed.`);
      continue;
    }
    const script = inspection?.scripts.find((candidate) => capability.evidence.some((evidence) => evidence.endsWith(`scripts.${candidate.name}`)));
    if (!script) continue;
    const redacted = redactCommand(script.command);
    const support = addObservation(output, view, {
      path: script.packagePath === "." ? "package.json" : `${script.packagePath}/package.json`,
      basis: "manifest-entry",
      subject: `scripts.${script.name}`,
      basisDigest: digestOf({ script: script.name, command: redacted.command, redacted: redacted.redacted }),
      coverage: "complete",
    });
    addFact(output, view, { id: "node.ecosystem", version: 1 }, {
      category: capability.id === "test" ? "testing" : "build",
      key: `capability.${capability.id}`,
      value: { kind: "command", script: script.name, command: redacted.command, redacted: redacted.redacted },
      cardinality: "multiple",
      form: "existence",
      pathPrefixes: [support.location.path],
      supports: [support.id],
      evidenceQuality: "direct",
      rule: "package-script",
    });
  }
  return output;
});

type JsonRecord = Record<string, string>;

export const nodePersistenceDetector: ProjectFactDetector = {
  id: "node.persistence",
  version: 1,
  claims: [
    { category: "persistence", key: "persistence.prisma", cardinality: "single", form: "existence" },
    { category: "persistence", key: "persistence.provider", cardinality: "single", form: "existence" },
    { category: "persistence", key: "persistence.postgresql", cardinality: "single", form: "existence" },
  ],
  detect({ view, inspection }) {
    const output = emptyOutput();
    if (!view.exists("package.json")) return output;
    for (const orm of ORMS) {
      const declared = orm.dependencies.flatMap((dependency) => hasDependency(view, inspection, dependency).map((path) => ({ dependency, path })));
      const schema = orm.schema && view.exists(orm.schema) ? orm.schema : null;
      if (declared.length === 0 && !schema) continue;
      const supports = declared.map((entry) => addObservation(output, view, {
        path: entry.path,
        basis: "manifest-entry",
        subject: `dependency:${entry.dependency}`,
        basisDigest: digestOf({ dependency: entry.dependency }),
        coverage: "complete",
      }));
      if (schema) supports.push(addObservation(output, view, { path: schema, basis: "presence", subject: schema, coverage: "complete" }));
      addFact(output, view, nodePersistenceDetector, {
        category: "persistence",
        key: orm.key,
        value: { kind: "text", text: orm.name },
        cardinality: "single",
        form: "existence",
        pathPrefixes: schema ? [schema] : ["package.json"],
        supports: supports.map((item) => item.id),
        evidenceQuality: declared.length > 0 && schema ? "corroborated" : declared.length > 0 ? "indirect" : "direct",
        rule: declared.length > 0 && schema ? "dependency-and-schema" : "single-signal",
      });
      if (schema === "prisma/schema.prisma") {
        const text = view.readText(schema);
        const provider = text ? prismaDatasourceProvider(text) : undefined;
        if (provider) {
          const support = addObservation(output, view, {
            path: schema,
            basis: "content-match",
            subject: `datasource.provider=${provider}`,
            basisDigest: textDigest(`datasource.provider=${provider}`),
            coverage: "complete",
          });
          addFact(output, view, nodePersistenceDetector, {
            category: "persistence",
            key: "persistence.provider",
            value: { kind: "text", text: provider },
            cardinality: "single",
            form: "existence",
            pathPrefixes: [schema],
            supports: [support.id],
            evidenceQuality: "direct",
            rule: "datasource-provider",
          });
        }
        if (view.exists("prisma/migrations")) {
          const support = addObservation(output, view, { path: "prisma/migrations", basis: "presence", subject: "prisma/migrations", coverage: "complete" });
          addFact(output, view, nodePersistenceDetector, {
            category: "persistence",
            key: "persistence.migrations",
            value: { kind: "text", text: "prisma/migrations" },
            cardinality: "single",
            form: "existence",
            pathPrefixes: ["prisma/migrations"],
            supports: [support.id],
            evidenceQuality: "direct",
            rule: "migration-directory",
          });
        }
      }
    }
    for (const driver of DRIVERS) {
      if (output.facts.some((fact) => fact.key === "persistence.provider")) continue;
      const declared = driver.dependencies.flatMap((dependency) => hasDependency(view, inspection, dependency).map((path) => ({ dependency, path })));
      if (declared.length === 0) continue;
      const supports = declared.map((entry) => addObservation(output, view, {
        path: entry.path,
        basis: "manifest-entry",
        subject: `dependency:${entry.dependency}`,
        basisDigest: digestOf({ dependency: entry.dependency }),
        coverage: "complete",
      }));
      addFact(output, view, nodePersistenceDetector, {
        category: "persistence",
        key: driver.key,
        value: { kind: "text", text: driver.name },
        cardinality: "single",
        form: "existence",
        pathPrefixes: ["package.json"],
        supports: supports.map((item) => item.id),
        evidenceQuality: "indirect",
        rule: "driver-dependency",
      });
    }
    return output;
  },
};

export const nodeContractsDetector: ProjectFactDetector = {
  id: "node.contracts",
  version: 1,
  claims: CONTRACTS.map((contract) => ({ category: "api" as const, key: contract.key, cardinality: "single" as const, form: "existence" as const })),
  detect({ view, inspection }) {
    return signalDetector(nodeContractsDetector, "api", view, inspection, CONTRACTS.map((contract) => ({ ...contract, guard: false })));
  },
};

export const nodeIntegrationsDetector: ProjectFactDetector = {
  id: "node.integrations",
  version: 1,
  claims: INTEGRATIONS.map((integration) => ({
    category: integration.key.startsWith("auth") ? "auth" as const : "external-effect" as const,
    key: integration.key,
    cardinality: "single" as const,
    form: "existence" as const,
  })),
  detect({ view, inspection }) {
    return signalDetector(nodeIntegrationsDetector, "external-effect", view, inspection, INTEGRATIONS);
  },
};

function signalDetector(
  detector: { id: string; version: number },
  fallbackCategory: "api" | "external-effect",
  view: RepositoryView,
  inspection: ProjectInspection | null,
  signals: readonly { key: string; name: string; dependencies: readonly string[]; files?: readonly string[]; guard: boolean }[],
): ReturnType<ProjectFactDetector["detect"]> {
  const output = emptyOutput();
  if (!view.exists("package.json") && !signals.some((signal) => signal.files?.some((file) => view.exists(file)))) return output;
  for (const signal of signals) {
    const declared = signal.dependencies.flatMap((dependency) => hasDependency(view, inspection, dependency).map((path) => ({ dependency, path })));
    const files = (signal.files ?? []).filter((file) => view.exists(file));
    const guards = signal.guard ? findGuards(view) : [];
    if (declared.length === 0 && files.length === 0 && guards.length === 0) continue;
    const supports = [
      ...declared.map((entry) => addObservation(output, view, {
        path: entry.path,
        basis: "manifest-entry" as const,
        subject: `dependency:${entry.dependency}`,
        basisDigest: digestOf({ dependency: entry.dependency }),
        coverage: "complete" as const,
      })),
      ...files.map((file) => addObservation(output, view, { path: file, basis: "presence" as const, subject: file, coverage: "complete" as const })),
      ...guards.map((file) => addObservation(output, view, { path: file, basis: "presence" as const, subject: file, coverage: "complete" as const })),
    ];
    const corroborated = (declared.length > 0 && (files.length > 0 || guards.length > 0)) || files.length > 1;
    addFact(output, view, detector, {
      category: signal.key.startsWith("auth") ? "auth" : signal.key.startsWith("api.") ? "api" : fallbackCategory,
      key: signal.key,
      value: { kind: "text", text: signal.name },
      cardinality: "single",
      form: "existence",
      pathPrefixes: ["."],
      supports: supports.map((item) => item.id),
      evidenceQuality: corroborated ? "corroborated" : files.length > 0 && declared.length === 0 ? "direct" : "indirect",
      rule: corroborated ? "dependency-and-structure" : "single-signal",
    });
  }
  return output;
}

function findGuards(view: RepositoryView): string[] {
  const found: string[] = [];
  const root = view.list("src");
  if (root.coverage === "truncated") return found;
  for (const entry of root.entries) {
    if (!entry.endsWith(".guard.ts") && !entry.endsWith(".guard.js")) continue;
    found.push(`src/${entry}`);
  }
  for (const entry of root.entries) {
    if (found.length >= 10) break;
    const nested = view.list(`src/${entry}`);
    if (nested.coverage === "truncated") break;
    for (const child of nested.entries) {
      if (child.endsWith(".guard.ts") || child.endsWith(".guard.js")) found.push(`src/${entry}/${child}`);
    }
  }
  return found.slice(0, 10);
}

export const nodeTestingDetector: ProjectFactDetector = {
  id: "node.testing",
  version: 1,
  claims: TEST_FRAMEWORKS.map((framework) => ({ category: "testing" as const, key: framework.key, cardinality: "single" as const, form: "existence" as const })),
  detect({ view, inspection }) {
    const output = emptyOutput();
    for (const framework of TEST_FRAMEWORKS) {
      const declared = framework.dependencies.flatMap((dependency) => hasDependency(view, inspection, dependency).map((path) => ({ dependency, path })));
      const files = framework.files.filter((file) => view.exists(file));
      const packageJson = readJson(view, "package.json");
      const inlineConfig = framework.name === "Jest" && packageJson && "jest" in packageJson;
      if (declared.length === 0 && files.length === 0 && !inlineConfig) continue;
      const supports = declared.map((entry) => addObservation(output, view, {
        path: entry.path,
        basis: "manifest-entry",
        subject: `dependency:${entry.dependency}`,
        basisDigest: digestOf({ dependency: entry.dependency }),
        coverage: "complete",
      }));
      for (const file of files) supports.push(addObservation(output, view, { path: file, basis: "presence", subject: file, coverage: "complete" }));
      if (inlineConfig) supports.push(addObservation(output, view, {
        path: "package.json",
        basis: "manifest-entry",
        subject: "jest",
        basisDigest: digestOf({ key: "jest" }),
        coverage: "complete",
      }));
      addFact(output, view, nodeTestingDetector, {
        category: "testing",
        key: framework.key,
        value: { kind: "text", text: framework.name },
        cardinality: "single",
        form: "existence",
        pathPrefixes: ["."],
        supports: supports.map((item) => item.id),
        evidenceQuality: declared.length > 0 && (files.length > 0 || inlineConfig) ? "corroborated" : declared.length > 0 ? "indirect" : "direct",
        rule: "test-framework",
      });
    }
    for (const root of ["test", "tests", "__tests__", "src"]) {
      if (root === "src" || !view.exists(root)) continue;
      const support = addObservation(output, view, { path: root, basis: "presence", subject: root, coverage: "complete" });
      addFact(output, view, nodeTestingDetector, {
        category: "testing",
        key: "testing.root",
        value: { kind: "text", text: root },
        cardinality: "multiple",
        form: "existence",
        pathPrefixes: [root],
        supports: [support.id],
        evidenceQuality: "direct",
        rule: "test-root",
      });
    }
    return output;
  },
};

export const nodeArchitectureDetector: ProjectFactDetector = {
  id: "node.architecture",
  version: 1,
  claims: [
    { category: "architecture", key: "architecture.source-root", cardinality: "multiple", form: "existence" },
    { category: "architecture", key: "architecture.composition-root", cardinality: "single", form: "existence" },
    { category: "architecture", key: "architecture.modules", cardinality: "single", form: "enumeration" },
  ],
  detect({ view }) {
    const output = emptyOutput();
    if (view.exists("src")) {
      const support = addObservation(output, view, { path: "src", basis: "presence", subject: "src", coverage: "complete" });
      addFact(output, view, nodeArchitectureDetector, {
        category: "architecture",
        key: "architecture.source-root",
        value: { kind: "text", text: "src" },
        cardinality: "multiple",
        form: "existence",
        level: "path",
        pathPrefixes: ["src"],
        supports: [support.id],
        evidenceQuality: "direct",
        rule: "source-directory",
      });
    }
    const main = view.readText("src/main.ts");
    if (main?.includes("NestFactory")) {
      const support = addObservation(output, view, {
        path: "src/main.ts",
        basis: "content-match",
        subject: "NestFactory",
        basisDigest: textDigest("NestFactory"),
        coverage: "complete",
      });
      addFact(output, view, nodeArchitectureDetector, {
        category: "architecture",
        key: "architecture.composition-root",
        value: { kind: "text", text: "src/main.ts" },
        cardinality: "single",
        form: "existence",
        level: "path",
        pathPrefixes: ["src/main.ts"],
        supports: [support.id],
        evidenceQuality: "direct",
        rule: "nest-factory",
      });
    }
    if (view.exists("src/modules")) {
      const listing = view.list("src/modules");
      if (listing.entries.length === 0 && listing.coverage === "complete") return output;
      const support = addObservation(output, view, {
        path: "src/modules",
        basis: "directory-listing",
        subject: "src/modules",
        basisDigest: digestOf(listing.entries),
        coverage: listing.coverage,
      });
      addFact(output, view, nodeArchitectureDetector, {
        category: "architecture",
        key: "architecture.modules",
        value: { kind: "list", items: listing.entries },
        cardinality: "single",
        form: "enumeration",
        level: "path",
        pathPrefixes: ["src/modules"],
        supports: [support.id],
        evidenceQuality: "direct",
        rule: "module-directory",
        status: listing.coverage === "complete" ? "validated" : "needs-revalidation",
      });
    }
    return output;
  },
};
