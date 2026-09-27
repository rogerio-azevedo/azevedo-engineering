# ADR-0009 — Specification Authority and Evidence-backed Exploration

- Status: aceito
- Data: 2026-09-26

## Contexto

Um Engineering Plan inicial contém intenção curta, inspection e unknowns, mas não pode inventar scope de implementação. A v0.5 precisa combinar uma especificação humana, o código real e Knowledge Units selecionadas sem confundir comportamento atual com requisito de produto nem sobrescrever o plano imutável.

## Problema

Se exploração, intenção e recomendação ocuparem o mesmo documento, o runtime não consegue distinguir critérios fornecidos de inferências. Se um agent decidir livremente quando pesquisou o suficiente, não há boundedness auditável. Se o resultado existir apenas no contexto do Codex, outros harnesses não poderão consumi-lo e a continuidade dependerá da sessão.

## Decisão

`FeatureSpecification` é o contrato persistente e versionado de intenção. Preserva apenas conteúdo fornecido: objetivo, contexto, comportamentos, regras, cenários, edge cases, decisões, restrições, critérios de aceite, fora de escopo, questões abertas e proveniência. Campos ausentes não são completados pelo código.

O repositório é fonte de evidência sobre o estado atual. Termos, entry points, flows, padrões similares, contratos, consumidores, testes, dependências e riscos descobertos não alteram a Specification. Critérios de aceite mantêm sua origem `user` ou `product-artifact`; coverage de exploração é um vínculo separado.

`ExplorationArtifact` é harness-neutral, determinístico e vinculado a Plan, Specification, `ContextManifest` e `SubjectRevision`. Para impedir associação acidental entre features, o objetivo da Specification precisa corresponder exatamente à task do Plan; uma intenção diferente requer seu próprio plan. Toda conclusão operacional referencia evidência com path relativo, kind, símbolo/localização, razão e relação com a task. Paths absolutos são inválidos. Unknown resolvido exige evidência; resultado bloqueado é válido.

Exploração começa por reconnaissance estrutural e usa orçamento explícito. A parada é uma destas: `sufficient-evidence`, `blocked-by-ambiguity`, `blocked-by-missing-context`, `scope-boundary` ou `budget-exhausted`. `ready` exige evidência suficiente; `partial` preserva lacunas; `blocked` não produz scope inventado.

Persistência é create-only:

- `.azevedo/specifications/<spec-id>.json`;
- `.azevedo/explorations/<exploration-id>.json`;
- `.azevedo/plans/<plan-id>/revisions/<revision-id>.json`.

Uma exploração não bloqueada pode propor `EngineeringPlanRevision`. O plano original e sua identidade permanecem intactos. A revisão referencia Specification, ExplorationArtifact, Knowledge Units e subject revision e nunca autoriza implementação.

O core não integra LLM nem executa scripts do target. O comando `explore` é a primeira superfície e `--dry-run` é o modo usado para dogfood read-only. Codex, Cursor e Claude Code devem consumir o mesmo contrato.

## Alternativas consideradas

- Enriquecer o plano original: descartado porque viola identidade e persistência create-only.
- Usar somente Markdown ou relatório de agent: descartado por falta de validação, portabilidade e links de evidência.
- Inferir Specification do código: descartado porque comportamento atual não é autoridade de intenção.
- Fazer integração LLM obrigatória: descartado porque reconnaissance, imports, paths, manifests e testes já oferecem uma base determinística e provider-agnostic.
- Considerar toda correspondência lexical como affected path: descartado; correspondências amplas são evidência ou suporte, enquanto scope confirmado/provável exige entry/behavior grounding.

## Consequências

- Antes da implementação, o sistema possui um handoff persistente e auditável.
- Explorações incompletas ficam visíveis e não são promovidas artificialmente a `ready`.
- A mesma Specification e revisão de código produzem artifacts determinísticos.
- Seleção lexical ainda é conservadora e não substitui entendimento semântico; `partial` e budgets tornam essa limitação explícita.
- Execution, verification runtime, review runtime, recovery e multi-agent permanecem fora da v0.5.
