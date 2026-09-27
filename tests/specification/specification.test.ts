import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FeatureSpecificationSchema,
  applySpecificationArtifactOperation,
  buildImmutableArtifactOperation,
  buildSpecificationArtifactOperation,
  createFeatureSpecification,
  parseFeatureSpecification,
  serializeFeatureSpecification,
} from "../../src/index.js";

function specification() {
  return createFeatureSpecification({
    title: "Arquivar realização",
    objective: "Permitir que uma realização ativa seja arquivada.",
    description: "O usuário arquiva uma realização pela API.",
    context: "A realização continua disponível para auditoria.",
    expectedBehaviors: ["A realização passa ao estado arquivado."],
    businessRules: ["Somente realizações ativas podem ser arquivadas."],
    scenarios: [{
      id: "scenario-active-realization",
      given: "uma realização ativa",
      when: "o usuário solicita o arquivamento",
      then: "a realização fica arquivada",
    }],
    edgeCases: ["Uma realização já arquivada não muda novamente."],
    decisions: ["Preservar o registro para auditoria."],
    constraints: ["Não excluir fisicamente o registro."],
    acceptanceCriteria: [{
      id: "ac-archive-active-realization",
      source: { kind: "user", reference: null },
      statement: "Uma realização ativa pode ser arquivada.",
      scenario: {
        given: "uma realização ativa",
        when: "o endpoint de arquivamento é chamado",
        then: "o estado persistido passa a arquivado",
      },
      prohibitedEffects: ["O registro não pode ser excluído."],
      verificationMethod: "Teste de integração do endpoint e leitura do estado persistido.",
      priority: "required",
    }],
    outOfScope: ["Restaurar realizações arquivadas."],
    openQuestions: ["Qual permissão específica autoriza o arquivamento?"],
    provenance: {
      sources: [{ kind: "product-document", reference: "docs/archive-realization.md", revision: "v1" }],
    },
  });
}

test("feature specifications preserve supplied intent without inferred fields", () => {
  const first = specification();
  const second = specification();
  assert.deepEqual(first, second);
  assert.match(first.id, /^spec-arquivar-realizacao-[a-f0-9]{8}$/);
  assert.deepEqual(first.openQuestions, ["Qual permissão específica autoriza o arquivamento?"]);
  assert.equal(first.acceptanceCriteria[0]?.source.kind, "user");
  assert.equal("evidence" in first, false);
  assert.deepEqual(parseFeatureSpecification(first), first);
  const tamperedId = `${first.id.slice(0, -1)}${first.id.endsWith("0") ? "1" : "0"}`;
  assert.throws(() => parseFeatureSpecification({ ...first, id: tamperedId }),
    /canonical content/);
  assert.throws(() => FeatureSpecificationSchema.parse({
    ...first,
    provenance: { sources: [{ kind: "product-document", reference: "/Users/name/spec.md", revision: null }] },
  }), /project-relative/);
  assert.throws(() => FeatureSpecificationSchema.parse({
    ...first,
    scenarios: [first.scenarios[0], first.scenarios[0]],
  }), /unique/);
});

test("specification persistence is create-only, idempotent, and conflict-safe", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-specification-"));
  mkdirSync(join(root, ".azevedo"));
  const spec = specification();
  const create = buildSpecificationArtifactOperation(root, spec);
  assert.equal(create.action, "create");
  applySpecificationArtifactOperation(root, create);
  assert.equal(readFileSync(join(root, create.artifact), "utf8"), serializeFeatureSpecification(spec));
  assert.equal(buildSpecificationArtifactOperation(root, spec).action, "unchanged");
  writeFileSync(join(root, create.artifact), "user content\n");
  assert.equal(buildSpecificationArtifactOperation(root, spec).action, "conflict");
});

test("specification persistence rejects a symlinked artifact directory", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-specification-symlink-"));
  const external = mkdtempSync(join(tmpdir(), "azevedo-specification-external-"));
  mkdirSync(join(root, ".azevedo"));
  symlinkSync(external, join(root, ".azevedo", "specifications"));
  assert.equal(buildSpecificationArtifactOperation(root, specification()).action, "conflict");
});

test("immutable artifact persistence rejects paths outside the project root", () => {
  const root = mkdtempSync(join(tmpdir(), "azevedo-specification-containment-"));
  assert.throws(() => buildImmutableArtifactOperation(root, "../outside.json", "{}\n"), /contained/);
});
