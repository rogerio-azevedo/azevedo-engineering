# ADR-0005 — Initialization and File Ownership

- Status: aceito
- Data: 2026-09-26

## Contexto

Inspection é read-only. `init` é a primeira operação do Azevedo Engineering autorizada a modificar um projeto e precisa instalar uma fundação mínima sem tomar posse silenciosamente de conteúdo preexistente.

## Problema

Escrever diretamente durante discovery ou sobrescrever arquivos por convenção criaria risco de perda de instruções, configuração e decisões do usuário. Project groups ampliam o risco: um conflito tardio poderia deixar apenas parte dos projetos inicializada. Init também não deve assumir responsabilidades futuras de update ou migration.

## Decisão

Initialization sempre segue `inspect → plan → validate → apply`. O plano é construído de forma read-only para todos os projetos e classifica cada artefato como `create`, `unchanged` ou `conflict`. Dry-run executa todo o preflight e para antes da aplicação.

São Azevedo-managed `azevedo.config.yaml` e `.azevedo/README.md`. `AGENTS.md` é adapter-managed e recebe a mesma política conservadora: ausente é criado, byte-for-byte idêntico permanece unchanged e qualquer diferença bloqueia. Não existe overwrite, merge, backup automático ou `--force`.

Project groups são inicializados como projetos independentes, sem artefatos na raiz agregadora. Todos os planos são construídos e validados antes da primeira escrita; conflito em qualquer filho bloqueia o grupo inteiro. Essa é atomicidade lógica pré-write, não uma transação de filesystem.

Codex é o primeiro adapter e fornece um `AGENTS.md` curto. O core recebe artifacts tipados do adapter e permanece independente de harness. Configuração declara a intenção `adapter: codex`; discovery continua descrevendo a realidade do projeto.

Aplicação valida containment, bloqueia symlinks e tipos incompatíveis, cria diretórios controladamente e usa criação exclusiva de arquivos. Arquivos idênticos não são reescritos. Falhas de I/O ainda podem ocorrer depois do preflight; rollback completo não faz parte da v0.3.

## Alternativas consideradas

- Escrever enquanto descobre: descartado porque impede visão completa de conflitos e atomicidade lógica.
- Sobrescrever arquivos Azevedo-managed: descartado porque init não prova ownership histórico e não é update.
- Fazer merge automático de `AGENTS.md`: descartado por risco de alterar instruções do usuário.
- Oferecer `--force`: descartado nesta fase por criar bypass destrutivo.
- Implementar rollback transacional: adiado por complexidade desproporcional ao bootstrap de três arquivos.

## Consequências

- Init pode ser revisado e automatizado por `--dry-run --json`.
- Reexecução é idempotente e não altera timestamps de arquivos unchanged.
- Conflitos exigem decisão humana e retornam erro operacional.
- Project groups não ficam parcialmente inicializados por conflitos conhecidos.
- Uma operação futura de update/migration deverá definir ownership persistente, versionamento e política de evolução separadamente.
