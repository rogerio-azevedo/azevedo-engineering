# ADR-0007 — Engineering Plan Identity and Immutable Revisions

- Status: aceito
- Data: 2026-09-26

## Contexto

O Engineering Plan v1 recebe um ID determinístico antes de existir repository exploration. Pesquisa posterior pode resolver paths, evidências, unknowns e critérios de aceite sem alterar a intenção original. Ao mesmo tempo, a persistência create-only trata conteúdo diferente sob o mesmo ID como conflito.

## Problema

Incluir todo o estado de inspection ou enrichment no hash faria a identidade oscilar por mudanças de contexto que não alteram a solicitação. Sobrescrever o plano original esconderia a história e romperia auditabilidade. Tratar toda evolução como conflito impediria enriquecimento legítimo.

## Decisão

O Plan ID representa a **identidade da intenção inicial**: descrição normalizada, topologia e target scopes iniciais. Inspection detalhada, affected paths descobertos, critérios de aceite e outras evidências não entram retroativamente nesse ID.

O plano base em `.azevedo/plans/<plan-id>.json` permanece imutável e create-only. Conteúdo diferente sob o mesmo ID continua sendo conflito, pois indica drift na produção do mesmo contrato base.

Enrichment ocorre em `EngineeringPlanRevision`, um artefato filho imutável que:

- retém `planId` e um snapshot completo cujo `id` é o original;
- possui `sequence`, `parentRevisionId` e ID derivado deterministicamente de seu conteúdo;
- vincula a revisão do projeto, artefatos de origem e Knowledge Units usados;
- persiste critérios de aceite observáveis e o resumo das mudanças;
- é armazenado em `.azevedo/plans/<plan-id>/revisions/<revision-id>.json` sem sobrescrita.

Revisão de plano não significa execução ou aprovação automática. Nesta versão, ela é um contrato de foundation disponível pela API, sem novo comando CLI.

## Alternativas consideradas

- Recalcular o Plan ID com toda inspection: descartado porque mistura intenção e estado transitório do projeto.
- Mutar o JSON base in-place: descartado porque perde proveniência e cria disputa de ownership.
- Guardar apenas um patch: adiado porque um snapshot integral é mais simples de validar e consumir de forma independente.
- Resolver conflitos escolhendo a versão mais recente: descartado porque esconde divergência sem decisão explícita.

## Consequências

- A identidade permanece estável enquanto o contexto é enriquecido.
- O plano base continua compatível com v0.4.
- Cada revisão é autocontida, encadeada e auditável.
- Garbage collection, merge de branches de revisão e aprovação de revisions são problemas futuros explícitos.
