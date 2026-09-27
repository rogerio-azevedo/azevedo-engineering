# ADR-0010 — Guided Execution, Isolation and Session Evidence

- Status: aceito
- Data: 2026-09-26

## Contexto

A v0.5 termina com uma Specification, Exploration e Plan Revision baseadas em evidência, mas esses artifacts não concedem autoridade para escrever source nem demonstram o que ocorreu durante implementação. A primeira execução precisa continuar provider-neutral, proteger trabalho humano e diferenciar código escrito de comportamento verificado.

## Decisão

`EngineeringPlanRevision` é o ponto de entrada de Guided Execution. Antes de mutação, `ExecutionReadiness` valida artifacts, acceptance, scope, verification, source revision, product decisions e dirty state. Product decisions abertas bloqueiam; technical unknowns pesquisáveis são levadas ao contexto. A v0.6.1 esclarece em [ADR-0011](0011-greenfield-exploration-and-coordinated-readiness.md) que isolamento e autorização pertencem à fase posterior de mutation authorization, não ao readiness read-only.

Preparation e mutation são boundaries distintas. `azevedo execute --revision ... --prepare` pode produzir artifacts do harness, mas nunca altera source. Permissão de escrita é explícita, limitada a linked worktree, paths autorizados e expansões com evidence. Commit e push são proibidos.

`ExecutionContext` tem budget e instruções estruturadas. `CodingAgent` é uma interface do core sem implementação de provider. `ExecutionSession` usa sequence mais digest de revision/context/checkpoint, possui snapshots append-only e limita recovery a três attempts. Completion exige checkpoint final, attempt bem-sucedido, verification obrigatória `pass` e coverage `verified` de todos os critérios.

O Verification Runtime executa somente package scripts presentes na inspection, com `shell: false`, e bloqueia comandos desconhecidos ou destrutivos. Artifacts não persistem values de secrets.

## Alternativas consideradas

- Autorizar escrita assim que Exploration fica `ready`: descartado porque readiness de conhecimento não equivale a autoridade operacional.
- Usar o Plan inicial como entrada: descartado porque não contém necessariamente Specification, scope e verification enriquecidos.
- Integrar uma API Codex na v0.6: descartado; o artifact provider-neutral já pode orientar o Codex presente no terminal.
- Retry até checks passarem: descartado por esconder falhas e incentivar mudanças sem diagnóstico.
- Exigir working tree principal limpo e escrever nele: descartado; dogfood mutável exige isolamento.

## Consequências

- Preparação read-only pode terminar corretamente em `blocked` e ainda entregar diagnóstico/contexto útil.
- Execuções repetidas da mesma revision são distinguíveis sem timestamps como identidade.
- O harness não executa uma feature sozinho; ele governa handoff, permissions, evidence e verification.
- A v0.7 poderá consumir snapshots e coverage para review sem redefinir a execução.
