# ADR-0002 — Descoberta conservadora e precedência do projeto

- Status: aceito
- Data: 2026-09-26

## Contexto

O harness precisa funcionar em projetos novos e existentes. A stack Azevedo é uma referência útil, porém projetos reais podem usar outra topologia, package manager, ORM, framework ou conjunto de scripts.

## Problema

Aplicar defaults sem inspeção pode selecionar regras e comandos incorretos, reestruturar um projeto implicitamente ou criar uma falsa sensação de verificação.

## Decisão

Project inspection é uma capacidade read-only, determinística e anterior a `init`. Ela detecta topologia, package manager, linguagens, frameworks, persistência, validação, UI, testes, scripts e capabilities a partir de arquivos observáveis.

Sinais insuficientes produzem `unknown`; sinais conflitantes produzem `ambiguous`. Confirmações e overrides poderão resolver esses estados futuramente. A arquitetura existente prevalece sobre a referência Azevedo. Monorepo é uma arquitetura de referência e fixture, não requisito do core.

## Alternativas consideradas

- Perguntar toda a stack antes de inspecionar: explícito, mas trabalhoso e sujeito a respostas desatualizadas.
- Inferência agressiva por nomes de diretórios: conveniente, porém frágil.
- Assumir a stack Azevedo: simples em greenfield, inadequado para adoção em projetos existentes.

## Consequências

- Todo sinal detectado deve registrar evidência.
- Stack-specific rules só ativam por detecção ou configuração explícita.
- `inspect` pode existir sem `init` e sem mutar o projeto.
- Fixtures monorepo e single-repo são necessárias para provar ausência de pressupostos estruturais.
