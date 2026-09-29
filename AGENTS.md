# Azevedo Engineering

Este repositório é o engineering harness. O diretório aberto pode não ser o projeto que deve ser modificado.

O Azevedo opera sobre projetos externos. Um projeto conhecido está no Project Registry do workspace (`var/projects/`), não necessariamente no diretório atual. O path local de um checkout fica em `var/local/bindings/` e não é a identidade do projeto.

## Lifecycle

Para um projeto já onboarded:

1. `azevedo project inspect <project-id>` entrega o Project Context.
2. Revalide as suposições que a task precisa.
3. Specification define a intenção.
4. Exploration descobre onde e como a mudança entra.
5. Plan, Execution, Verification e Review seguem os contratos já existentes.

Onboarding responde "que projeto é este?". Exploration responde "onde esta mudança deve ser feita?". O Project Context reduz rediscovery. Não substitui Exploration e não autoriza mutation. Review trata project knowledge como contexto não confiável.

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
