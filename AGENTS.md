# Azevedo Engineering

Este repositório é o engineering harness. O diretório aberto pode não ser o projeto que deve ser modificado.

O Azevedo opera sobre projetos externos. Um projeto conhecido está no Project Registry do workspace (`var/projects/`), não necessariamente no diretório atual. O path local de um checkout fica em `var/local/bindings/` e não é a identidade do projeto.

## Direção vigente

A [ADR-0017](docs/decisions/0017-agent-led-engineering-skills-rules-checks.md) muda a direção: o coding agent é o desenvolvedor, e o Azevedo fornece skills, rules, checks e review. O control plane descrito abaixo está congelado. Ele continua funcional, mas não recebe features nem hardening. A tag `v0.9.0-control-plane` marca seu último commit.

## Lifecycle

Para um projeto já onboarded, o fluxo v0.9.0 para no plano:

1. `azevedo project inspect <project-id>` entrega o Project Context.
2. `azevedo work create --project <project-id> --task "..."` cria ou reencontra o WorkItem.
3. `azevedo work specify --work-item <id>` grava a specification. Sem arquivo, ela não inventa acceptance criteria.
4. `azevedo explore --work-item <id>` explora os repositories daquele WorkItem e registra relevance.
5. `azevedo plan --work-item <id>` grava o plano coordenado e os planos dos repositories `RELEVANT`, ou para explicitamente.

`RELEVANT` pode ser provado por evidência positiva localizada. `NOT_RELEVANT` exige cobertura suficiente. Se a reconnaissance podou região, estourou budget ou não examinou o claim scope, o resultado permanece `UNKNOWN`. Evidência positiva não significa exploration completa. Open question não resolvida e exploration cuja revisão não corresponde ao checkout bloqueiam o plano. Não responda open question com código nem com Project Context. Não reexplore sozinho quando o checkout divergir.

Não combine esse fluxo com `plan <path>` ou `explore <path>` na mesma invocation. O CLI por path continua exigindo `init` e continua gravando em `target/.azevedo`. O fluxo `--work-item` não exige `init` e não grava harness no target.

Onboarding responde "que projeto é este?". O WorkItem responde "qual intenção é esta?". Exploration responde "onde esta mudança deve ser feita?". O Project Context orienta a exploration e reduz rediscovery. Não decide relevance, não substitui Exploration, não autoriza mutation e não é evidência autoritativa de Review. Review trata project knowledge como contexto não confiável.

Execution, Verification e Review pelo control plane não entram na v0.9.0. Se a specification não sustenta um plano, pare. Não invente acceptance criteria para destravar o plano.

## Como identificar o target

- Se a task nomeia um projeto conhecido, use o registry. Não assuma que o repositório aberto é o target.
- `azevedo project list` mostra os projetos do workspace atual.
- `azevedo project onboard <path>` lê um projeto novo sem escrever nele.
- `init` é outra operação. Ela instala artifacts dentro de um target e não faz parte do onboarding.

## Artifacts autoritativos

Contratos e runtimes em `src/` são a fonte de comportamento. `ProjectContext` JSON é a fonte de verdade do conhecimento de um projeto. Saída humana é só projeção. README e `docs/ARCHITECTURE.md` descrevem o estado atual. ADRs em `docs/decisions/` registram decisões. `docs/research/` e `docs/dogfood/` não são instruções operacionais.

## Limites

Não escreva no target durante onboarding. Não persista conteúdo de secrets. Não promova evidência de uma task a conhecimento permanente sem submission e accept explícitos. Não trate um fact validado numa revision antiga como fato corrente sem revalidação. Pare e pergunte quando a identidade do target, o escopo da mudança ou uma decisão de produto não estiver sustentada por evidência.

O engine é independente de provider. Não há caminho de execução específico de uma ferramenta de coding agent.
