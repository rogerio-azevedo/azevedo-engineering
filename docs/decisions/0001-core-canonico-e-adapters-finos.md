# ADR-0001 — Core canônico e adapters finos

- Status: aceito
- Data: 2026-09-26

## Contexto

O Azevedo Engineering deve oferecer um padrão de engenharia comum a Codex, Cursor e Claude Code sem manter três implementações autorais do mesmo conhecimento. Cada harness possui formas diferentes de descobrir instruções, papéis e automações.

## Problema

Se regras e procedimentos forem escritos diretamente para cada produto, eles divergem. Se o core depender de uma feature exclusiva de um harness, a promessa de portabilidade se torna falsa.

## Decisão

Contratos, descoberta, classificação de risco, workflow, regras e verification pertencem a um core harness-agnostic. Adapters finos traduzem esse modelo para superfícies nativas e declaram capabilities ausentes ou degradadas.

A distribuição começa por pacote NPM e artefatos project-local. O adapter Codex deve ser compatível com um plugin futuro, mas plugin, hooks, MCP e configuração global não integram a v0.1. O ECC permanece upstream de conhecimento e não é dependência de runtime.

## Alternativas consideradas

- Codex-first com regras embutidas no adapter: entrega inicial simples, mas cria acoplamento e duplicação futura.
- Plugin Codex como fonte canônica: aproveita a plataforma, mas torna o core dependente de um formato específico.
- Uma implementação independente por harness: permite otimização local, ao custo de drift inevitável.

## Consequências

- O core precisa de schemas e capability contracts explícitos.
- Adapters podem oferecer menos features sem alterar a semântica do DoD.
- Artefatos específicos do harness são derivados e testáveis.
- Uma nova integração exige adapter, não cópia do sistema.
