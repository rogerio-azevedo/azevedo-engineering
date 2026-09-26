# Azevedo Engineering

Engineering harness reutilizável para coding agents. A v0.2 adiciona o primeiro comando público: uma inspection conservadora de projetos existentes.

## Inspect

```bash
azevedo inspect
azevedo inspect --json
azevedo inspect ./project
azevedo inspect ./project --json
```

`inspect` é 100% read-only no projeto analisado. Ele não instala configuração do Azevedo Engineering, não cria arquivos e não executa scripts, testes, builds, linters ou migrations do target.

A saída humana apresenta o resultado para leitura no terminal. `--json` escreve somente o contrato canônico, determinístico e parseável no `stdout`; erros são enviados ao `stderr`.

Exit codes:

| Código | Significado |
| --- | --- |
| `0` | Inspection concluída, inclusive com estados `unknown` ou `ambiguous` |
| `1` | Erro operacional, como path inexistente ou ilegível |
| `2` | Comando, opção ou argumento inválido |

## Desenvolvimento local

```bash
pnpm install
pnpm build
node dist/src/cli.js inspect
node dist/src/cli.js inspect --json
pnpm verify
```

O package expõe o bin `azevedo`, preparando a execução futura via `npx @azevedo/engineering inspect`. A publicação no NPM ainda não faz parte desta versão.

Esta versão também mantém os contratos da foundation v0.1.1, classification de risco, verification por scope, evidence/waivers e o adapter Codex mínimo. `init`, outros comandos mutáveis, plugin, hooks e MCP ainda não foram implementados.

Consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para os limites e decisões do projeto.
