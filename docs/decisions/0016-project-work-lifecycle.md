# ADR-0016 — Project work lifecycle

- Status: aceito
- Data: 2026-10-01

## Contexto

A v0.8 conhece um projeto externo sem instalar o harness nele. O lifecycle de engenharia ainda exigia `init` e um `EngineeringPlan` no `target/.azevedo` antes da exploration. Num project group, esse plano nasce cedo demais, marca todo scope como obrigatório e usa `project.root: "."`.

A proposta em `docs/research/v0.9-external-control-plane.md` permanece como evidência do design e das alternativas rejeitadas. Este ADR registra só o contrato que a v0.9.0 implementou.

## Problema

Uma intenção de produto atravessa mais de um repository. O plano legado não é uma identidade portátil: o id não inclui `projectId` nem `repositoryId`, e a persistência mora dentro de cada checkout. Reutilizar esse schema no control plane colidiria artifacts e trataria ausência de evidência como "não obrigatório".

Exploration também não pode depender de um plano vazio só para satisfazer `exploreProject`. E o Project Context não pode decidir quais repositories importam.

## Decisão

O lifecycle v0.9.0 é:

Project → WorkItem → Specification → Exploration → Repository Relevance → Coordinated Engineering Plan → repository Engineering Plans → stop.

Execution, Verification e Review pelo control plane ficam fora desta versão.

WorkItem é uma intenção dentro de um Project. A identidade determinística usa `projectId` e o objective. O conjunto de repositories gravado na criação é imutável. Conjunto incompatível falha fechado. Repository acrescentado depois ao Project não entra no WorkItem existente.

Specification continua sendo a autoridade de intenção. A specification mínima preserva o objective e as open questions fornecidas. Não inventa acceptance criteria e não usa código como requirement.

Exploration não recebe um EngineeringPlan. Cada repository do WorkItem é considerado. A implementação v0.9.0 faz reconnaissance limitada e leitura profunda só dentro de budget determinístico. Relevance é `UNKNOWN`, `RELEVANT` ou `NOT_RELEVANT`. `UNKNOWN` preserva a causa: ainda não explorado, binding indisponível, ou um `ExplorationStopReason` da exploration.

`RELEVANT` pode ser provado por evidência positiva localizada. Evidência direta ou análoga basta, mesmo quando a reconnaissance foi parcial. `NOT_RELEVANT` exige cobertura suficiente do claim scope: a exploration precisa conseguir dizer quais regiões foram examinadas e que nenhuma região in-scope ficou por examinar. Ausência de match no subconjunto examinado não é `NOT_RELEVANT`. Diretório podado, listagem truncada, budget esgotado ou região in-scope não examinada mantêm `UNKNOWN`, com a causa explícita. Diretórios fora do claim — dependências, build, dot dirs e paths sensíveis — não contam como buraco de cobertura.

Evidência positiva não significa exploration completa. `coverage.complete` e `coverage.budgetLimited` permanecem no artifact. Um repository pode ser `RELEVANT` com `stopReason` `budget-exhausted`. Essa exploration parcial não sustenta `NOT_RELEVANT` nem uma afirmação de cobertura completa.

Fact ausente no ProjectContext não produz `NOT_RELEVANT`.

O plano novo não é `EngineeringPlanRevision`. Cada plano de repository registra a basis: `workItemId`, `projectId`, `repositoryId`, `specificationId` e os ids das explorations que o sustentam. Não há `previousPlanId`. Artifacts continuam create-only. O ponteiro atual pode avançar. Plano não é gravado se algum repository está `UNKNOWN`, se não há acceptance criteria, se a specification tem open question não resolvida, se a `sourceRevision` da exploration não corresponde ao checkout bound, ou se não há evidência direta ou análoga num repository `RELEVANT`. Open question não é respondida por código, por ProjectContext nem por padrão análogo. Checkout divergente não dispara reexplore automático: o resultado é `stale-exploration` e o operador pode rodar `explore` de novo.

Na carga, o conjunto de repositories do ponteiro tem de ser exatamente o conjunto do WorkItem. Repository faltando, extra, duplicado, desconhecido ou trocado falha fechado, antes de exploration, plano ou artifact novo. Artifacts content-addressed desta versão têm a identidade recalculada a partir do conteúdo. WorkItem, Specification, Exploration, plano coordenado e plano de repository que não reproduzem o id esperado falham fechado. Symlink no caminho do work item, no ponteiro ou no arquivo de exploration também falha fechado e não é reparado.

ProjectContext orienta a estratégia, reduz rediscovery e fornece facts classificados. Os boundaries da v0.8 permanecem literais. `contextSources: ["project-context"]` vale só neste lifecycle. O CLI por path não muda.

A persistência fica em `var/projects/<projectId>/work-items/`. Artifacts portáteis usam ids e paths relativos. Path absoluto continua apenas no binding local. O fluxo novo não exige `init` e não grava harness no target.

## Alternativas consideradas

- Reusar `exploreProject` com um plano fake: descartado. O plano deixaria de ser contrato e a exploration continuaria dependente de `init`.
- Tratar `required: false` do plano coordenado legado como `UNKNOWN`: descartado. São significados diferentes.
- Deixar o ProjectContext marcar `NOT_RELEVANT` quando não há sinal: descartado. Ausência de fact não é evidência negativa.
- Tratar "nenhum match no subconjunto lido" como `NOT_RELEVANT`: descartado. Ausência de evidência não é evidência de ausência.
- Esconder budget esgotado quando já há evidência positiva: descartado. Relevance e completude da cobertura são fatos diferentes.
- Fechar open question com código ou com ProjectContext para destravar o plano: descartado nesta versão. A autoridade continua humana.
- Reusar um plano quando a `sourceRevision` da exploration divergiu do checkout: descartado. Não há reexplore automático.
- Introduzir `EngineeringPlanRevision` no control plane: descartado nesta versão. A basis aponta para a specification e para as explorations exatas.
- Migrar ou rehashear artifacts de `target/.azevedo`: descartado. O CLI legado permanece compatível.

## Consequências

- `azevedo plan <path>` e `azevedo explore <path>` continuam como estavam, inclusive o hash `JSON.stringify` e a exigência de `init`.
- Misturar path e `--work-item` na mesma invocation falha.
- Uma specification sem acceptance criteria, ou com open question não resolvida, produz parada `needs-product-decision`. Isso é um resultado válido, não um plano vazio.
- Uma exploration cuja revisão não corresponde mais ao checkout produz parada `stale-exploration`. Nenhum plano novo é gravado.
- Candidato lexical e padrão análogo ficam registrados como evidência. Nenhum dos dois vira requirement nem autoriza mutation.
- ProjectKnowledge continua exigindo submission e accept explícitos.
- Snapshots da v0.8 não são reescritos.
