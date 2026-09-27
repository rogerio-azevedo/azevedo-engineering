import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCoordinatedEngineeringPlan,
  createFeatureSpecification,
  createInspectResult,
  prepareProjectGroupExecution,
} from "../../src/index.js";

function write(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function projectGroup(withWebEvidence = true): string {
  const root = mkdtempSync(join(tmpdir(), "azevedo-project-group-execution-"));
  write(root, "server/package.json", JSON.stringify({
    name: "server",
    scripts: { lint: "eslint .", test: "node --test", build: "tsc" },
    dependencies: { "@nestjs/common": "11.0.0", prisma: "6.0.0" },
  }));
  write(root, "server/src/application/entities/resident.ts", "export type Resident = { condominiumId: string; unitId: string };\n");
  write(root, "server/src/application/repositories/residents-repository.ts", "export interface ResidentsRepository { save(value: unknown): Promise<void>; }\n");
  write(root, "server/src/infra/database/repositories/prisma-residents-repository.ts", "export class PrismaResidentsRepository {}\n");
  write(root, "server/src/infra/http/resolvers/residents-resolver.ts", "export class ResidentsResolver {}\n");
  write(root, "server/src/infra/storage/image-storage.ts", "export interface ImageStorage { upload(value: unknown): Promise<string>; }\n");

  write(root, "web/package.json", JSON.stringify({
    name: "web",
    scripts: { lint: "eslint .", build: "next build" },
    dependencies: { next: "16.0.0", react: "19.0.0" },
  }));
  if (withWebEvidence) {
    write(root, "web/codegen.ts", `
export default { documents: ["src/graphql/**/*.graphql"], generates: { "src/graphql/generated.ts": {} } };
`);
    write(root, "web/src/graphql/generated.ts", "export type ExistingQuery = { id: string };\n");
    write(root, "web/src/graphql/queries/get-residents.graphql", "query GetResidents { residents { id } }\n");
    write(root, "web/src/utils/features-slugs.ts", "export type FeaturesSlugs = 'resident' | 'delivery';\n");
    write(root, "web/src/app/(app)/condominium/[id]/page.tsx", "export default function CondominiumPage() { return null; }\n");
    write(root, "web/src/components/forms/address-form.tsx", "export const AddressForm = () => null;\n");
    write(root, "web/src/components/upload/image-upload.tsx", "export const ImageUpload = () => null;\n");
  } else {
    write(root, "web/src/index.ts", "export const unrelated = true;\n");
  }
  return root;
}

function specification() {
  return createFeatureSpecification({
    title: "Cadastrar encomenda",
    objective: "Cadastrar encomenda",
    expectedBehaviors: ["Persistir no backend e permitir cadastro na interface web."],
    businessRules: ["A unidade deve pertencer ao condomínio atual."],
    acceptanceCriteria: [{
      id: "ac-register-delivery",
      source: { kind: "user", reference: null },
      statement: "Registrar a encomenda pelo backend e formulário web.",
      scenario: { given: "condomínio, bloco e unidade existentes", when: "o usuário autorizado envia dados válidos", then: "o registro fica persistido" },
      prohibitedEffects: ["Não criar endereço implicitamente."],
      verificationMethod: "Verificação de integração por projeto.",
      priority: "required",
    }, {
      id: "ac-attach-image",
      source: { kind: "user", reference: null },
      statement: "Vincular uma foto ao registro.",
      scenario: { given: "um browser", when: "o usuário seleciona uma imagem", then: "o upload fica persistido" },
      prohibitedEffects: ["Não exigir aplicativo nativo."],
      verificationMethod: "Verificação de upload por projeto.",
      priority: "required",
    }],
    provenance: { sources: [{ kind: "user", reference: null, revision: null }] },
  });
}

test("one human intent produces project-specific evidence, verification, and coordinated readiness", () => {
  const root = projectGroup();
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project-group");
  if (inspection.kind !== "project-group") return;
  const spec = specification();
  const plan = buildCoordinatedEngineeringPlan(inspection, spec, { requiredProjectPaths: ["server", "web"] });
  assert.deepEqual(plan.scopes.map((scope) => scope.projectPath), ["server", "web"]);
  assert.ok(plan.scopes.every((scope) => scope.plan.id === plan.planId));
  assert.ok(plan.scopes.every((scope) => scope.plan.task.description === spec.objective));

  const prepared = prepareProjectGroupExecution(root, inspection, spec, { requiredProjectPaths: ["server", "web"] });
  assert.equal(prepared.plan.planId, plan.planId);
  assert.equal(prepared.readiness.status, "ready");
  assert.equal(new Set(prepared.scopes.map((scope) => scope.exploration.id)).size, 2);
  assert.ok(prepared.scopes.every((scope) => scope.exploration.integrationSurfaces.length >= 2));
  const server = prepared.scopes.find((scope) => scope.projectPath === "server");
  const web = prepared.scopes.find((scope) => scope.projectPath === "web");
  assert.equal(server?.revision.planSnapshot.verification.find((item) => item.verifierId === "verify.test")?.available, true);
  assert.equal(web?.revision.planSnapshot.verification.find((item) => item.verifierId === "verify.test")?.available, false);
  assert.equal(web?.revision.planSnapshot.verification.find((item) => item.verifierId === "verify.test")?.required, false);
  assert.ok(web?.exploration.affectedPaths.some((item) => item.path === "src/graphql/generated.ts"));
  assert.ok(web?.exploration.affectedPaths.some((item) => item.path === "src/utils/features-slugs.ts"));
});

test("a required blocked project scope blocks coordinated execution without creating sessions", () => {
  const root = projectGroup(false);
  const inspection = createInspectResult(root);
  assert.equal(inspection.kind, "project-group");
  if (inspection.kind !== "project-group") return;
  const prepared = prepareProjectGroupExecution(root, inspection, specification(), {
    requiredProjectPaths: ["server", "web"],
  });
  assert.equal(prepared.readiness.status, "blocked");
  const web = prepared.scopes.find((scope) => scope.projectPath === "web");
  assert.equal(web?.exploration.status, "blocked");
  assert.equal(web?.readiness.status, "blocked");
  assert.ok(prepared.readiness.blockedScopeIds.includes(web!.scopeId));
  assert.ok(prepared.readiness.reasons.some((reason) => reason.scopeId === web?.scopeId));
});
