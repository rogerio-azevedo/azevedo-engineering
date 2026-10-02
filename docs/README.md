# Documentação

Leia nesta ordem se estiver operando o Azevedo. O restante é histórico.

## Operacional

- [AGENTS.md](../AGENTS.md) — entrada curta para um coding agent
- [README.md](../README.md) — comandos e limites atuais
- [ARCHITECTURE.md](ARCHITECTURE.md) — contratos e fluxo vigentes, incluindo a seção 19 da v0.9.0

## Decisões

`docs/decisions/` guarda ADRs aceitos. Eles explicam por que o contrato é assim. Não são um tutorial. O ADR da v0.8 é o [0015](decisions/0015-project-onboarding-and-persistent-context.md). O ADR da v0.9.0 é o [0016](decisions/0016-project-work-lifecycle.md).

## Pesquisa

`docs/research/` compara o Azevedo com material upstream. Não é instrução operacional e não deve ser executado como procedimento.

## Dogfood

`docs/dogfood/` registra provas em projetos reais, com falhas preservadas. Um relatório antigo não autoriza mudança nem descreve o comportamento atual só porque está no repositório.

## O que não é documentação operacional

Histórico de dogfood, notas de pesquisa e ADRs superados por decisões posteriores não substituem o README, o `AGENTS.md` nem os contratos em `src/`.
