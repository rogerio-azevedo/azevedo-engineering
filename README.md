# Azevedo Engineering

Engineering harness reutilizável para coding agents. A v0.3 oferece inspection conservadora e inicialização project-local segura.

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
.azevedo/README.md
```

O comando é idempotente: conteúdo já idêntico é `UNCHANGED` e não é reescrito. Codex é o adapter inicial; `AGENTS.md` é apenas um bootstrap fino, enquanto os contratos canônicos permanecem no core.

Em project groups, todos os projetos filhos são planejados e validados antes da primeira escrita. Cada filho recebe sua própria instalação e nada é criado na raiz agregadora. Um conflito em qualquer filho bloqueia o grupo inteiro.

Exit codes:

| Código | Significado |
| --- | --- |
| `0` | Inspection ou initialization concluída; também dry-run válido |
| `1` | Erro operacional ou plano de init bloqueado por conflito |
| `2` | Comando, opção ou argumento inválido |

## Desenvolvimento local

```bash
pnpm install
pnpm build
node dist/src/cli.js inspect
node dist/src/cli.js inspect --json
node dist/src/cli.js init . --dry-run
pnpm verify
```

O package expõe o bin `azevedo`, preparando execução futura via `npx @azevedo/engineering inspect` e `npx @azevedo/engineering init`. A publicação no NPM ainda não faz parte desta versão.

Esta versão também mantém os contratos da foundation, classification de risco, verification por scope e evidence/waivers. Update, outros comandos mutáveis, plugin, hooks e MCP ainda não foram implementados.

Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para os limites e decisões do projeto.
