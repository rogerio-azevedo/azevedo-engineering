# ADR-0003 — Entrega baseada em risco, evidência e governança

- Status: aceito
- Data: 2026-09-26

## Contexto

Uma mesma cerimônia não serve para documentação, UI, regra de negócio, autenticação e migration de produção. Ao mesmo tempo, permitir que o agente escolha arbitrariamente o rigor reduz a confiança no resultado.

## Problema

Perfis manuais de rigor criam escolhas desconectadas do impacto real. Threshold universal de coverage e TDD artificial geram atividade sem reduzir necessariamente o risco. Evidência sem vínculo com o diff pode ficar obsoleta.

## Decisão

O sistema classifica task e risco usando tipo da mudança, paths e sinais concretos. Gates são resolvidos dinamicamente; não existem profiles `light`, `standard` ou `strict`.

TDD é obrigatório para bugs reproduzíveis quando tecnicamente razoável e normalmente aplicado a novos comportamentos de negócio. Refactors, UI/CSS, infra/configuração e documentação usam provas adequadas ao domínio. Toda decisão registra aplicação, não aplicabilidade ou waiver justificado. Não há commits RED/GREEN obrigatórios nem coverage universal.

Evidence usa os estados `pass`, `fail`, `skipped`, `waived` e `not_applicable`, fica detalhada em storage local ignorado e é vinculada à revisão/diff verificado. `Done` exige evidence atual, ausência de findings bloqueantes e disposição explícita dos gates.

Aprendizado segue `observation → candidate → accepted/rejected → promoted artifact`; promoção sempre exige aprovação humana, inclusive para uso cross-project.

## Alternativas consideradas

- Perfis de rigor escolhidos pelo usuário: fáceis de explicar, mas não refletem o risco específico.
- TDD e coverage fixos para qualquer alteração: previsíveis, porém produzem verificações artificiais.
- Evidência commitada por padrão: auditável, mas polui o histórico e pode conter output sensível.
- Promoção automática de padrões recorrentes: rápida, mas propaga inferências incorretas.

## Consequências

- O classificador e o plano de verificação fazem parte do contrato público.
- `skipped` nunca satisfaz silenciosamente um gate obrigatório.
- Waivers precisam de motivo, responsável, escopo e validade.
- Todo passo obrigatório deve declarar qual risco reduz e qual evidência produz.
- O relatório final resume evidência local sem exigir seu commit.
