# ADR-0011 — Greenfield Exploration and Coordinated Readiness

- Status: aceito
- Data: 2026-09-27

## Contexto

O primeiro dogfood de Guided Execution com a feature greenfield “Síndico Pro — Controle de Encomendas” terminou corretamente em `blocked`, mas revelou quatro limitações do harness: o Explorer procurava símbolos da própria feature mesmo quando ela ainda não existia; coincidências lexicais podiam contaminar scope e classificação de testes; capabilities de verification ausentes eram confundidas com requirements obrigatórias; e uma intenção distribuída entre backend e frontend não possuía readiness coordenado. Readiness também acumulava condições de conhecimento e autorização operacional, criando um impasse antes da criação de uma worktree isolada.

## Decisão

Exploration declara `existing-feature`, `greenfield-feature` ou `uncertain`. Existing-feature exige relação estrutural com símbolo/entry flow. Greenfield deriva capabilities dos acceptance criteria, identifica `IntegrationSurface` com evidence e propõe somente directory/module boundaries reconhecidas a partir de padrões reais do projeto. Correspondência lexical isolada é `candidate` e nunca autoriza mutation. Teste `direct` exige import para um path substantivo; padrões semelhantes são `analogous` ou `infrastructure`.

O budget continua limitado, mas é dividido em reconnaissance, exploração targeted por regiões evidenciadas e resolution de imports/high-value gaps. Suficiência é específica ao modo: greenfield não precisa inventar entry point, mas precisa de integration surfaces, scope proposto com provenance e coverage planejável dos critérios obrigatórios. Exploration parcial ou bloqueada ainda produz Plan Revision formal quando os contracts básicos existem.

Verification registra capabilities disponíveis e indisponíveis separadamente de requirements. Uma ausência só bloqueia quando a Specification ou a política aplicável torna aquela capability obrigatória.

Readiness passa a ser read-only. Worktree ligada, checkpoint e autorização explícita formam uma fase posterior de mutation authorization; sem ela não existe `ExecutionContext` executável nem `ExecutionSession`.

Para Project Groups, `CoordinatedEngineeringPlan` mantém uma Specification/intenção compartilhada e scopes project-relative. Cada scope possui Exploration, Revision, risks e Verification Plan próprios. `CoordinatedExecutionPreparation` fica `blocked` se qualquer scope obrigatório bloquear. Plan identity representa intenção; scope/artifact identity diferencia projetos e evidências.

## Alternativas consideradas

- Aumentar o budget e manter busca plana: descartado porque amplia custo sem corrigir a estratégia greenfield.
- Promover paths por score lexical: descartado porque palavras semelhantes não provam relação estrutural.
- Exigir scripts ideais em todo target: descartado porque ensina o projeto a satisfazer o harness e inventa requirements.
- Criar um orchestrator multi-agent cross-repo: descartado como prematuro; representação e gate coordenado são suficientes nesta versão.
- Liberar contexto de escrita no working tree principal: descartado; readiness de conhecimento não concede autoridade operacional.

## Consequências

- Scope greenfield pode conter boundaries de novos artifacts sem alegar que os arquivos já existem.
- Candidates e unavailable capabilities permanecem visíveis sem contaminar autorização.
- O mesmo pipeline representa formalmente `blocked` sem source mutation.
- Context budget preserva intent, acceptance e regras obrigatórias; conteúdo opcional é removido primeiro e referenciado.
- A v0.6.1 continua determinística, provider-neutral e sem LLM, semantic index, autonomous loop, commit ou push.
