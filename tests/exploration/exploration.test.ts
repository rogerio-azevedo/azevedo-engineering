import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ExplorationArtifactSchema,
  applyExplorationArtifactOperation,
  buildEngineeringPlan,
  buildExplorationArtifactOperation,
  createFeatureSpecification,
  createInspectResult,
  exploreProject,
  serializeExplorationArtifact,
} from "../../src/index.js";

function write(root: string, path: string, content: string): void {
  const directory = join(root, path, "..");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(root, path), content);
}

function project(withFeature = true): string {
  const root = mkdtempSync(join(tmpdir(), "azevedo-exploration-"));
  write(root, "package.json", `${JSON.stringify({
    name: "exploration-fixture",
    packageManager: "pnpm@11.24.0",
    scripts: { test: "node --test", typecheck: "tsc --noEmit", build: "tsc" },
    dependencies: { "@nestjs/common": "11.0.0", zod: "4.1.11", prisma: "6.0.0" },
    devDependencies: { typescript: "5.9.3" },
  }, null, 2)}\n`);
  write(root, "tsconfig.json", "{}\n");
  if (!withFeature) {
    write(root, "src/index.ts", "export const unrelated = true;\n");
    return root;
  }
  write(root, "src/realization/realizations.controller.ts", `
import { archiveRealization } from "../application/archive-realization.js";
export class RealizationsController { archive(id: string) { return archiveRealization(id); } }
`);
  write(root, "src/application/archive-realization.ts", `
import { realizationsRepository } from "../database/realizations-repository.js";
import type { ArchiveRealizationInput } from "../contracts/archive-realization-input.js";
export function archiveRealization(id: ArchiveRealizationInput["id"]) { return realizationsRepository.archive(id); }
`);
  write(root, "src/application/cancel-realization.ts", `
import { realizationsRepository } from "../database/realizations-repository.js";
export function cancelRealization(id: string) { return realizationsRepository.archive(id); }
`);
  write(root, "src/database/realizations-repository.ts", `
export const realizationsRepository = { archive: (id: string) => ({ id, status: "archived" }) };
`);
  write(root, "src/contracts/archive-realization-input.ts", `
export type ArchiveRealizationInput = { id: string };
`);
  write(root, "tests/archive-realization.spec.ts", `
import { archiveRealization } from "../src/application/archive-realization.js";
void archiveRealization("realization-id");
`);
  return root;
}

function budgetLimitedProject(): string {
  const root = project(false);
  write(root, "src/realization/archive-realization.controller.ts", `
export class ArchiveRealizationController { archive() { return "archived"; } }
`);
  for (let index = 0; index < 12; index += 1) write(
    root,
    `src/realization/archive-realization-${index}.ts`,
    `export const archiveRealization${index} = () => "archived";\n`,
  );
  return root;
}

function greenfieldProject(): string {
  const root = project(false);
  write(root, "src/application/entities/resident.ts", "export type Resident = { id: string; condominiumId: string };\n");
  write(root, "src/application/repositories/residents-repository.ts", "export interface ResidentsRepository { findByUnit(unitId: string): Promise<unknown>; }\n");
  write(root, "src/infra/database/repositories/prisma-residents-repository.ts", "export class PrismaResidentsRepository {}\n");
  write(root, "src/infra/http/resolvers/residents-resolver.ts", "export class ResidentsResolver {}\n");
  write(root, "src/infra/http/dtos/resident-input.ts", "export type ResidentInput = { blockId: string; unitId: string };\n");
  write(root, "src/infra/storage/image-storage.ts", "export interface ImageStorage { upload(file: unknown): Promise<string>; }\n");
  write(root, "src/infra/mail/email-provider.ts", "export interface EmailProvider { send(recipient: string): Promise<void>; }\n");
  write(root, "src/infra/database/database.module.ts", `
import { Module } from "@nestjs/common";
import { PrismaResidentsRepository } from "./repositories/prisma-residents-repository.js";
import { ResidentsRepository } from "../../application/repositories/residents-repository.js";
@Module({ providers: [{ provide: ResidentsRepository, useClass: PrismaResidentsRepository }] })
export class DatabaseModule {}
`);
  write(root, "src/infra/http/http.module.ts", `
import { Module } from "@nestjs/common";
import { ResidentsResolver } from "./resolvers/residents-resolver.js";
import { AddressForm } from "../../components/forms/address-form.js";
@Module({ providers: [ResidentsResolver, AddressForm] })
export class HttpModule {}
`);
  write(root, "src/components/forms/address-form.tsx", "export const AddressForm = () => null;\n");
  write(root, "src/app/(app)/condominium/[id]/create-address/page.tsx", "export default function CreateAddressPage() { return null; }\n");
  write(root, "tests/encomenda-ai.spec.ts", "const prompt = 'registrar encomenda por inteligencia artificial'; void prompt;\n");
  return root;
}

function greenfieldSpecification() {
  return createFeatureSpecification({
    title: "Cadastrar encomenda",
    objective: "Cadastrar encomenda",
    expectedBehaviors: ["Persistir o registro e expor o fluxo no backend e na interface web."],
    businessRules: ["Bloco e unidade devem pertencer ao condomínio corrente."],
    acceptanceCriteria: [{
      id: "ac-register-delivery",
      source: { kind: "user", reference: null },
      statement: "Registrar a encomenda para bloco e unidade existentes.",
      scenario: { given: "um condomínio com bloco e unidade", when: "o usuário autorizado envia dados válidos ao backend", then: "o registro fica persistido" },
      prohibitedEffects: ["Não criar endereço implicitamente."],
      verificationMethod: "Teste de comportamento.",
      priority: "required",
    }, {
      id: "ac-attach-photo",
      source: { kind: "user", reference: null },
      statement: "Adicionar foto pelo formulário web.",
      scenario: { given: "um browser", when: "o usuário seleciona uma imagem", then: "o upload fica vinculado ao registro" },
      prohibitedEffects: ["Não exigir aplicativo nativo."],
      verificationMethod: "Teste de integração.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
}

function specification() {
  return createFeatureSpecification({
    title: "Adicionar endpoint para arquivar uma realização",
    objective: "Adicionar endpoint para arquivar uma realização",
    expectedBehaviors: ["O status da realização passa a archived."],
    businessRules: ["A realização deve continuar persistida."],
    acceptanceCriteria: [{
      id: "ac-archive-realization",
      source: { kind: "user", reference: null },
      statement: "Uma realização ativa pode ser arquivada pelo endpoint.",
      scenario: { given: "uma realização ativa", when: "o endpoint é chamado", then: "o status fica archived" },
      prohibitedEffects: ["Não excluir a realização."],
      verificationMethod: "Teste do endpoint e do repositório.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
}

function explore(root: string) {
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project.");
  const plan = buildEngineeringPlan(inspection, specification().objective);
  return { plan, result: exploreProject(root, inspection, plan, specification()) };
}

test("exploration produces portable evidence, entry points, flows, contracts, tests, risks, and a plan revision", () => {
  const root = project();
  const { plan, result } = explore(root);
  const artifact = result.artifact;
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.stopReason, "sufficient-evidence");
  assert.ok(artifact.entryPoints.some((entry) => entry.path.endsWith("realizations.controller.ts")));
  assert.ok(artifact.flows.some((flow) => flow.relation === "imports"));
  assert.ok(artifact.contracts.some((contract) => contract.path.includes("archive-realization-input")));
  assert.ok(artifact.contracts.some((contract) => contract.consumerPaths.includes("src/application/archive-realization.ts")));
  assert.ok(artifact.tests.some((item) => item.state === "direct"));
  assert.ok(artifact.risk.findings.some((finding) => finding.signal === "public_contract"));
  assert.ok(artifact.risk.findings.some((finding) => finding.signal === "persistence"));
  assert.ok(artifact.terminology.some((mapping) => mapping.specificationTerm === "realizacao" && mapping.repositoryTerms.includes("realization")));
  assert.ok(artifact.affectedPaths.every((item) => item.evidenceIds.length > 0));
  assert.ok(artifact.evidence.every((item) => !item.path.startsWith("/")));
  assert.ok(artifact.contextManifest.selected.some((unit) => unit.id === "knowledge.exploration.entry-flow"));
  assert.equal(artifact.acceptanceCoverage[0]?.source, "specification");
  assert.ok(result.revision);
  assert.equal(result.revision?.planId, plan.id);
  assert.equal(result.revision?.planSnapshot.risk.class, "high-risk");
  assert.equal(plan.risk.class, "normal");
  assert.deepEqual(plan.scope.affectedPaths, []);
  assert.ok((result.revision?.planSnapshot.scope.affectedPaths.length ?? 0) > 0);
  assert.equal(result.revision?.acceptanceCriteria[0]?.id, "ac-archive-realization");
  assert.ok(artifact.unknowns.some((unknown) => unknown.status === "resolved" && unknown.evidenceIds.length > 0));
});

test("exploration is deterministic for an unchanged source revision", () => {
  const root = project();
  const first = explore(root).result;
  const second = explore(root).result;
  assert.deepEqual(first, second);
});

test("greenfield exploration derives integration surfaces and proposed boundaries without promoting lexical paths", () => {
  const root = greenfieldProject();
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project.");
  const spec = greenfieldSpecification();
  const plan = buildEngineeringPlan(inspection, spec.objective);
  const result = exploreProject(root, inspection, plan, spec);
  const artifact = result.artifact;

  assert.equal(artifact.featureMode, "greenfield-feature");
  assert.equal(artifact.status, "ready");
  assert.deepEqual(artifact.entryPoints, []);
  assert.ok(artifact.integrationSurfaces.some((surface) => surface.capability === "persistence"));
  assert.ok(artifact.integrationSurfaces.some((surface) => surface.capability === "web-ui"));
  assert.ok(artifact.integrationSurfaces.every((surface) => surface.evidenceIds.length > 0 && surface.acceptanceCriterionIds.length > 0));
  assert.ok(artifact.affectedPaths.some((item) => item.kind === "proposed" && item.basis === "architectural-pattern"));
  assert.ok(artifact.affectedPaths.some((item) => item.path === "src/application/repositories"));
  assert.ok(artifact.integrationSurfaces.some((surface) => surface.capability === "composition-root"));
  assert.ok(artifact.affectedPaths.some((item) => item.path === "src/infra/database/database.module.ts"));
  assert.ok(artifact.affectedPaths.some((item) => item.path === "src/infra/http/http.module.ts"));
  assert.ok(!artifact.affectedPaths.some((item) => item.path.includes("create-address/page.tsx")));
  assert.ok(artifact.candidates.some((item) => item.path.includes("create-address/page.tsx")));
  assert.ok(artifact.tests.some((item) => item.path === "tests/encomenda-ai.spec.ts" && item.state !== "direct"));
  assert.ok(result.revision);
});

test("notification UI and form errors do not masquerade as outbound email delivery", () => {
  const root = project(false);
  write(root, "src/app/(app)/notifications/notification-filters/filters-items.tsx", `
export function NotificationFilters() { return <div>Filtrar notificações</div>; }
`);
  write(root, "src/components/form/error-message.tsx", `
export function ErrorMessage() { return <p>Mensagem inválida</p>; }
`);
  write(root, "src/graphql/queries/list-notifications.graphql", "query ListNotifications { notifications { id } }\n");
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project.");
  const spec = createFeatureSpecification({
    title: "Cadastrar encomenda",
    objective: "Cadastrar encomenda",
    expectedBehaviors: ["Enviar e-mail ao destinatário e listar o registro na interface web."],
    acceptanceCriteria: [{
      id: "ac-email-delivery",
      source: { kind: "user", reference: null },
      statement: "Enviar e-mail ao destinatário.",
      scenario: { given: "um cadastro válido", when: "o envio ocorre", then: "o resultado fica registrado" },
      prohibitedEffects: ["Não alterar o estado físico quando o e-mail falhar."],
      verificationMethod: "Teste do provider.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
  const plan = buildEngineeringPlan(inspection, spec.objective);
  const artifact = exploreProject(root, inspection, plan, spec).artifact;
  assert.ok(!artifact.integrationSurfaces.some((surface) => surface.capability === "email-delivery"));
});

test("exploration rejects a specification associated with an unrelated plan", () => {
  const root = project();
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project.");
  const plan = buildEngineeringPlan(inspection, specification().objective);
  const unrelated = createFeatureSpecification({
    title: "Outra feature",
    objective: "Adicionar outra feature",
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
  assert.throws(() => exploreProject(root, inspection, plan, unrelated), /must match/);
});

test("exploration blocks instead of guessing when no repository evidence matches", () => {
  const root = project(false);
  const { result } = explore(root);
  assert.equal(result.artifact.status, "blocked");
  assert.equal(result.artifact.stopReason, "blocked-by-ambiguity");
  assert.deepEqual(result.artifact.affectedPaths, []);
  assert.ok(result.revision);
  assert.deepEqual(result.revision?.planSnapshot.scope.affectedPaths, []);
  assert.match(result.revision?.changeSummary.at(-1) ?? "", /blocked-by-ambiguity/);
});

test("exploration contract rejects dangling evidence and resolved unknowns without evidence", () => {
  const artifact = explore(project()).result.artifact;
  assert.throws(() => ExplorationArtifactSchema.parse({
    ...artifact,
    affectedPaths: [{ ...artifact.affectedPaths[0], evidenceIds: ["evidence-000000000000"] }],
  }), /Unknown evidence reference/);
  assert.throws(() => ExplorationArtifactSchema.parse({
    ...artifact,
    unknowns: [{ question: "Where?", status: "resolved", resolution: "Here.", evidenceIds: [] }],
  }), /Resolved unknowns require evidence/);
  assert.throws(() => ExplorationArtifactSchema.parse({
    ...artifact,
    status: "partial",
    stopReason: "sufficient-evidence",
  }), /boundary or budget/);
});

test("exploration records bounded exhaustion but may stop when evidence is already sufficient", () => {
  const root = budgetLimitedProject();
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project");
  if (inspection.kind !== "project") throw new Error("Expected project.");
  const plan = buildEngineeringPlan(inspection, specification().objective);
  const result = exploreProject(root, inspection, plan, specification(), { maxFilesInspected: 10 });
  assert.equal(result.artifact.status, "ready");
  assert.equal(result.artifact.stopReason, "sufficient-evidence");
  assert.equal(result.artifact.budget.exhausted, true);
  assert.equal(result.artifact.budget.filesInspected, 10);
  assert.deepEqual(result.artifact.budget.passes.map((pass) => pass.phase), ["reconnaissance", "targeted", "resolution"]);
  assert.equal(result.artifact.budget.passes.reduce((total, pass) => total + pass.consumed, 0), 10);
});

test("exploration artifacts persist create-only and distinguish unchanged from conflict", () => {
  const root = project();
  mkdirSync(join(root, ".azevedo"));
  const artifact = explore(root).result.artifact;
  const create = buildExplorationArtifactOperation(root, artifact);
  assert.equal(create.action, "create");
  applyExplorationArtifactOperation(root, create);
  assert.equal(readFileSync(join(root, create.artifact), "utf8"), serializeExplorationArtifact(artifact));
  assert.equal(buildExplorationArtifactOperation(root, artifact).action, "unchanged");
  writeFileSync(join(root, create.artifact), "different\n");
  assert.equal(buildExplorationArtifactOperation(root, artifact).action, "conflict");
});
