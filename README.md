# Azevedo Engineering

Engineering harness reutilizável para coding agents. A v0.6.1 endurece a Guided Execution com exploração greenfield, relevância baseada em evidência, verification coerente com as capabilities reais, preparação read-only e representação coordenada de features cross-repo, sem acoplar o core a um provider.

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

O catálogo totaliza dezenove unidades. Além das oito unidades de Exploration, a v0.6 acrescenta sete unidades focadas em disciplina de implementação, scope, TDD contextual, verification, diagnóstico de falhas, recovery limitado e evidência de mudanças. O `ContextManifest` registra exatamente quais unidades foram selecionadas e por quê.

O Plan ID identifica a intenção inicial. Enrichment não sobrescreve o plano base: critérios de aceite e contexto descoberto são persistidos como `EngineeringPlanRevision` encadeada e create-only.

## Explore

```bash
azevedo explore . --plan plan-adicionar-comportamento-12345678 --dry-run
azevedo explore . --plan plan-adicionar-comportamento-12345678 --spec ./feature-spec.json --json
```

`explore` recebe um plano persistido e uma Specification JSON opcional. Sem `--spec`, cria uma Specification mínima exclusivamente a partir da task do plano; campos ausentes continuam ausentes. Com `--spec`, preserva objetivo, regras, cenários, decisões, restrições, critérios de aceite, fora de escopo, questões abertas e proveniência fornecidos. O `objective` precisa corresponder exatamente à task do plan, impedindo associação acidental entre features diferentes.

A Specification é autoridade de intenção. O código é evidência do comportamento atual e nunca vira silenciosamente regra de negócio. A exploração distingue `existing-feature`, `greenfield-feature` e `uncertain`. Features existentes seguem entry points, flows, dependencies, consumers e testes. Features greenfield derivam capabilities dos critérios de aceite, localizam `integrationSurfaces` existentes e propõem somente boundaries sustentadas por padrões arquiteturais citados. Correspondência lexical isolada permanece `candidate` e não autoriza mutation. O budget é consumido em passes de reconnaissance, targeted exploration e resolution, sempre com razão de parada.

Sem `--dry-run`, artifacts imutáveis são criados somente após preflight de conflitos:

```text
.azevedo/specifications/<specification-id>.json
.azevedo/explorations/<exploration-id>.json
.azevedo/plans/<plan-id>/revisions/<revision-id>.json
```

`explore` não executa scripts, testes, builds ou código do target; não implementa a feature; não usa LLM; e não depende do Codex. O adapter Codex é apenas a primeira superfície de consumo. `--dry-run` produz o mesmo contexto e revisão proposta sem gravar artifacts.

## Execute (Guided Execution)

```bash
azevedo execute . --revision plan-revision-1-12345678 --prepare --dry-run
azevedo execute . --revision plan-revision-1-12345678 --prepare --json
azevedo execute ./isolated-worktree --revision plan-revision-1-12345678 --prepare --authorize-isolated-write
```

`execute` aceita uma `EngineeringPlanRevision`, pois ela é o primeiro artifact que reúne intenção original, Specification, Exploration, acceptance criteria, scope enriquecido, risco e Verification Plan. O único modo público é `--prepare`: primeiro avalia `ready | blocked` sem confundir readiness com autorização. `ExecutionContext` e `ExecutionSession` só são liberados quando readiness está `ready`, a execução está numa linked worktree, o checkpoint foi capturado e `--authorize-isolated-write` foi fornecido. O comando nunca chama um modelo nem modifica source code.

Readiness exige source revision inalterada, ausência de trabalho humano fora dos arquivos do harness, critérios de aceite, scope com proveniência suficiente, verification obrigatória disponível e nenhuma decisão de produto aberta. Autorização de mutation é uma segunda decisão: sem linked worktree e `--authorize-isolated-write`, a preparation registra `authorizationReasons`, mas o readiness técnico pode continuar `ready` e nenhuma session é criada.

O contexto contém instruções estruturadas (`INTENT`, `EVIDENCE`, `ACCEPTANCE CRITERIA`, `SCOPE`, `KNOWN PATTERNS`, `RISKS`, `UNKNOWN TECHNICAL QUESTIONS`, `IMPLEMENTATION CONSTRAINTS`, `VERIFICATION`, `STOP CONDITIONS`). O default é 6.000 tokens estimados, mas o core obrigatório nunca é removido para caber: sem budget explícito, o limite efetivo pode crescer de forma registrada; com limite explícito insuficiente, a preparação falha. Conteúdo opcional é removido primeiro e permanece referenciado.

Sem `--dry-run`, apenas artifacts do harness são gravados de forma create-only:

```text
.azevedo/executions/preparations/<preparation-id>.json
.azevedo/executions/<execution-id>/context.json
.azevedo/executions/<execution-id>/sessions/<snapshot-id>.json
```

O core expõe uma interface provider-neutral `CodingAgent`, mas não inclui integração programática com Codex ou outro provider. Tentativas e snapshots são append-only, recovery é limitado a três attempts, scope adicional exige razão e evidence ids, e completion exige checkpoint final, attempt bem-sucedido, verification obrigatória aprovada e todos os critérios em estado `verified`.

O Verification Runtime executa somente scripts encontrados pela inspection, com argumentos fixos e `shell: false`. Capability disponível e requirement obrigatória são conceitos distintos: uma capability ausente é registrada, mas só bloqueia quando a Specification ou a política aplicável a torna obrigatória. Targets desconhecidos, requirements indisponíveis e comandos destrutivos são bloqueados. Values de secrets nunca pertencem aos artifacts; somente nomes de environment variables são permitidos.

Exit codes:

| Código | Significado |
| --- | --- |
| `0` | Operação concluída; em `execute`, readiness está `ready` |
| `1` | Erro operacional, conflito ou execution readiness `blocked` |
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
node dist/src/cli.js execute . --revision <revision-id> --prepare --dry-run
pnpm verify
```

O package expõe o bin `azevedo`, preparando uso futuro via `npx @azevedo/engineering inspect`, `init`, `plan`, `explore` e `execute`. A publicação no NPM ainda não faz parte desta versão.

Esta versão mantém os contratos da foundation, classification de risco, verification por scope e evidence/waivers. Ela prepara e registra Guided Execution, mas não implementa loop autônomo, provider API, commit/push, reviewer/security runtime, update, plugin, hooks, MCP, memory ou learning.

Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para os limites e decisões do projeto.
