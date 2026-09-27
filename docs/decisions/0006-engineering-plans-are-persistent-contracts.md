# ADR-0006 — Engineering Plans Are Persistent Contracts

- Status: aceito
- Data: 2026-09-26

## Contexto

Inspection descreve o projeto e initialization instala a fundação local, mas ainda não existe um contrato persistente entre entendimento da tarefa e futura execução. Texto livre não fornece identidade, invariantes, idempotência ou uma superfície confiável para verification.

## Decisão

Engineering Plans são artefatos canônicos JSON criados antes da implementação. Cada plano possui identidade determinística vinculada à descrição normalizada da tarefa, topologia e scope inicial; o path absoluto da máquina não participa da identidade nem do conteúdo persistido. Como cada plano vive dentro do projeto, não é necessária uma identidade global entre repositórios.

O plano registra task, projeto relativo, scope, classificação de risco, understanding, evidence, assumptions, unknowns, steps, verification requirements, decisões de governança e status. Ele reutiliza o risk classifier, a política contextual de TDD e o resolver de verification existentes. Planning nunca reduz o risco classificado.

Discovery é evidence. O planner não inventa affected paths, packages, camadas, comandos ou arquivos de implementação. Quando a inspection não sustenta uma afirmação, o plano mantém o campo vazio e registra o unknown. Unknowns exigem um passo de research anterior à implementação.

O formato canônico é machine-readable, sem timestamp e sem path absoluto gerado. Human output é uma projeção do mesmo contrato. Planos são persistidos em `.azevedo/plans/<plan-id>.json` usando criação exclusiva: conteúdo idêntico é unchanged e conteúdo diferente sob o mesmo ID é conflict. `plan` não atualiza config, bootstrap, código-fonte ou documentação Azevedo já instalada.

Project groups exigem seleção explícita de um projeto. Targets unknown ou não inicializados são bloqueados. Um projeto inicializado pela v0.3 permanece compatível sem migration.

Plan é o contrato entre understanding e execution. A identidade e o enrichment posterior foram formalizados no [ADR-0007](0007-engineering-plan-identity-and-immutable-revisions.md): o plano base permanece imutável e contexto descoberto vive em revisions encadeadas. Executores, agentes exploradores e verification runtime futuros poderão consumir esses contratos, mas não fazem parte da v0.4.1. O planner é determinístico e não usa LLM.

## Alternativas consideradas

- Persistir Markdown como fonte de verdade: descartado porque dificulta validação e consumo determinístico.
- Inferir arquivos prováveis pelo framework: descartado por produzir falsa precisão sem repository exploration.
- Usar timestamp ou randomness no ID: descartado porque quebra idempotência e testes byte-for-byte.
- Planejar automaticamente todos os filhos de um group: descartado porque o target correto não pode ser inferido da descrição.
- Executar o plano imediatamente: descartado porque mistura planning, mutation e verification antes de seus contratos existirem.

## Consequências

- A mesma task e scope geram o mesmo ID e conteúdo canônico enquanto discovery e políticas relevantes permanecerem iguais.
- Mudança real no plano sob o mesmo ID exige decisão humana; não existe overwrite.
- Planos conservadores podem conter muitos unknowns. Isso é preferível a paths e comandos inventados.
- A pasta `plans/` é a primeira capability materializada sob `.azevedo/`; update, migration, execução e timestamps continuam fora do escopo.
