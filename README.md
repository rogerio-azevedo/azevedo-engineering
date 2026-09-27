# Azevedo Engineering

Engineering harness reutilizável para coding agents. A v0.5 preserva inspection, initialization e Engineering Plans determinísticos e adiciona Specification Intake e exploração read-only baseada em evidência.

## Inspect

```bash
azevedo inspect
azevedo inspect --json
azevedo inspect ./project
azevedo inspect ./project --json
```

`inspect` é 100% read-only no projeto analisado. Ele não instala configuração do Azevedo Engineering, não cria arquivos e não executa scripts, testes, builds, linters ou migrations do target.

O resultado possui `kind: "project"` para um projeto normal ou monorepo. Quando a raiz não é um projeto reconhecível, o CLI examina somente seus filhos diretos e pode retornar `kind: "project-group"`, preservando uma inspection completa para cada projeto encontrado. Project group descreve organização externa e não é uma nova topologia nem um monorepo implícito.

A busca de grupos não é recursiva, ignora diretórios técnicos comuns e não usa nomes como `api`, `server` ou `web` como evidência. Uma raiz com projeto ou monorepo reconhecido nunca dispara essa busca. Um container com exatamente um projeto filho ainda é representado como project group.

A saída humana apresenta o resultado para leitura no terminal. `--json` escreve somente o contrato canônico, determinístico e parseável no `stdout`; erros são enviados ao `stderr`.

## Init

```bash
azevedo inspect .
azevedo init . --dry-run
azevedo init .
azevedo init . --json
```

`init` pode escrever no projeto. Use `--dry-run` antes da primeira inicialização para revisar o plano completo. Conflitos bloqueiam toda a operação, não existe `--force` e nenhum arquivo existente com conteúdo diferente é sobrescrito.

A instalação mínima e versionável contém:

```text
azevedo.config.yaml
AGENTS.md
.codex/agents/explorer.toml
.codex/agents/architect.toml
.codex/agents/reviewer.toml
.codex/agents/security-reviewer.toml
.azevedo/README.md
```

O comando é idempotente: conteúdo já idêntico é `UNCHANGED` e não é reescrito. Codex é o adapter inicial; `AGENTS.md` é um bootstrap fino e os quatro papéis são read-only, enquanto os contratos canônicos permanecem no core. Init e install plan derivam esses artifacts de uma única fonte autoral.

Em project groups, todos os projetos filhos são planejados e validados antes da primeira escrita. Cada filho recebe sua própria instalação e nada é criado na raiz agregadora. Um conflito em qualquer filho bloqueia o grupo inteiro.

Quando uma segunda execução não precisa criar nada, o human output informa `Already initialized` e o JSON retorna `outcome: "already-initialized"` sem reescrever arquivos.

## Plan

```bash
azevedo plan . --task "Adicionar endpoint para arquivar uma realização"
azevedo plan . --task "Adicionar endpoint para arquivar uma realização" --json
```

`plan` exige um projeto já inicializado, não altera código e não executa comandos do projeto. O planner é determinístico e não usa LLM. Ele combina a task com inspection, risk classification, TDD contextual e capabilities reais, preservando unknowns em vez de inventar arquivos ou comandos.

O contrato canônico é JSON e fica em `.azevedo/plans/<plan-id>.json`. A mesma task e scope produzem o mesmo ID e conteúdo: a segunda execução é `UNCHANGED`; conteúdo diferente sob o mesmo ID é `CONFLICT` e nunca é sobrescrito.

Project groups não são planejados automaticamente. O usuário precisa selecionar explicitamente um projeto filho para evitar que o Azevedo adivinhe se a tarefa pertence ao backend, frontend ou ambos.

## Knowledge/Context foundation

O core expõe `KnowledgeUnit` e `ContextManifest` para selecionar somente conhecimento aplicável por fase, task, risco, sinais, tecnologia, capability e prefixo de path. A resolução é determinística, explica cada seleção, inclui dependências e falha em conflitos. A foundation começou com quatro sínteses de uso geral com proveniência fixa do ECC.

Na v0.5, o catálogo totaliza doze unidades: oito unidades específicas cobrem reconnaissance, terminologia, entry points/flows, padrões similares, contratos/consumidores, testes, disciplina de evidência e stop/defer. O `ContextManifest` do artefato registra exatamente quais unidades foram selecionadas e por quê.

O Plan ID identifica a intenção inicial. Enrichment não sobrescreve o plano base: critérios de aceite e contexto descoberto são persistidos como `EngineeringPlanRevision` encadeada e create-only.

## Explore

```bash
azevedo explore . --plan plan-adicionar-comportamento-12345678 --dry-run
azevedo explore . --plan plan-adicionar-comportamento-12345678 --spec ./feature-spec.json --json
```

`explore` recebe um plano persistido e uma Specification JSON opcional. Sem `--spec`, cria uma Specification mínima exclusivamente a partir da task do plano; campos ausentes continuam ausentes. Com `--spec`, preserva objetivo, regras, cenários, decisões, restrições, critérios de aceite, fora de escopo, questões abertas e proveniência fornecidos. O `objective` precisa corresponder exatamente à task do plan, impedindo associação acidental entre features diferentes.

A Specification é autoridade de intenção. O código é evidência do comportamento atual e nunca vira silenciosamente regra de negócio. A exploração faz inventário estrutural, expansão terminológica determinística, busca de entry points, flows, implementações similares, contratos/consumidores, testes, dependências, riscos e unknowns. O resultado informa `ready`, `partial` ou `blocked` e sempre registra uma razão de parada.

Sem `--dry-run`, artifacts imutáveis são criados somente após preflight de conflitos:

```text
.azevedo/specifications/<specification-id>.json
.azevedo/explorations/<exploration-id>.json
.azevedo/plans/<plan-id>/revisions/<revision-id>.json
```

`explore` não executa scripts, testes, builds ou código do target; não implementa a feature; não usa LLM; e não depende do Codex. O adapter Codex é apenas a primeira superfície de consumo. `--dry-run` produz o mesmo contexto e revisão proposta sem gravar artifacts.

Exit codes:

| Código | Significado |
| --- | --- |
| `0` | Inspection, initialization, planning ou exploration concluído; também dry-run válido |
| `1` | Erro operacional ou conflito que bloqueia init/plan/explore |
| `2` | Comando, opção ou argumento inválido |

## Desenvolvimento local

```bash
pnpm install
pnpm build
node dist/src/cli.js inspect
node dist/src/cli.js inspect --json
node dist/src/cli.js init . --dry-run
node dist/src/cli.js plan . --task "Atualizar documentação"
node dist/src/cli.js explore . --plan <plan-id> --dry-run
pnpm verify
```

O package expõe o bin `azevedo`, preparando execução futura via `npx @azevedo/engineering inspect`, `init`, `plan` e `explore`. A publicação no NPM ainda não faz parte desta versão.

Esta versão também mantém os contratos da foundation, classification de risco, verification por scope e evidence/waivers. Implementação, execution/verification runtime, update, plugin, hooks, MCP e LLM ainda não foram implementados.

Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para os limites e decisões do projeto.
