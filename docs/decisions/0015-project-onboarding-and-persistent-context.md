# ADR-0015 — Project onboarding and persistent context

- Status: aceito
- Data: 2026-09-29

## Contexto

Até a v0.7.1 o Azevedo só conhece um target enquanto o inspeciona, ou depois que `init` instala artifacts dentro dele. Projetos reais, inclusive grupos como o Síndico Pro, não devem precisar receber `AGENTS.md`, `azevedo.config.yaml` ou `.azevedo/` para serem reconhecidos.

## Problema

Sem um registry no workspace do engine, cada task redescobre topologia, stack e commands. Persistir esse conhecimento no target repetiria o `init`. Persistir path absoluto, branch ou revision dentro da identidade tornaria o projeto dependente do checkout. Tratar todo arquivo intacto como revalidação de uma convenção ampla produziria falsa confiança.

## Decisão

Onboarding é read-only no target. O perfil vive em `<workspace>/var/projects/<projectId>/`:

- `project.json` é a `ProjectDefinition`, create-only na v0.8;
- `snapshots/<snapshotId>.json` é histórico imutável;
- `current.json` aponta para o snapshot atual do registry e não se chama HEAD.

O binding local fica em `<workspace>/var/local/bindings/<projectId>.json`. `projectId` é sugerido uma vez e depois não é recalculado. O digest de identidade inclui schema, id, nome e repositories. Não inclui path absoluto, branch, revision, remote nem timestamp. Remote é evidence. `var/` é armazenamento local desta versão, não o formato final de distribuição.

O modelo separa observation, project fact e project knowledge. Knowledge não é criada pelo onboarding. Entra como candidate por submission e só passa a accepted por ação explícita. Cada claim declara `form` (`existence`, `enumeration`, `behavior`) e `scope`. Revalidação exige cobertura de evidence pelo menos tão ampla quanto o claim. `behavior` não fica `validated` só porque um arquivo histórico permaneceu igual.

`ProjectContext` é o artifact estruturado consumível por fases futuras. Renderização humana é projeção. O contexto não autoriza mutation, não substitui Exploration e é input não confiável para Review. Paths secret-like geram apenas fato de presença. O conteúdo não é lido nem persistido.

## Alternativas consideradas

- Reusar `init` como onboarding: descartado porque escreve no target.
- Guardar o perfil em `.azevedo/` do target: descartado pelo mesmo motivo.
- Derivar `projectId` do path ou do remote a cada execução: descartado porque o checkout e o remote podem mudar sem mudar o projeto.
- Chamar o ponteiro de HEAD: descartado porque HEAD já é a revisão Git.
- Revalidar qualquer claim quando seus paths de evidence não mudam: descartado para claims de comportamento.
- Diretório home, database ou sync: adiado. A v0.8 só separa engine de dado local.

## Consequências

- `azevedo inspect` e `init` não mudam de semântica.
- Um checkout cujo binding ainda aponta para o path antigo preserva o `projectId` e marca o binding como indisponível. Renomear a pasta e onboardar o path novo, sem informar o id existente, cria outro projeto. Remote e commit não são usados para adivinhar a identidade. `project bind` continua fora desta versão.
- Um binding ilegível ou incompatível bloqueia o onboard. O arquivo não é apagado nem reescrito.
- A cadeia `previousSnapshotId` é validada na carga, até null. Elo ausente, projectId ou definitionDigest divergente, ciclo ou id incoerente com o conteúdo falham fechado.
- Leitura de onboarding não segue symlink para fora do repository resolvido.
- Snapshots novos só nascem quando o estado semântico muda.
- Detectors de outros ecossistemas podem ser adicionados sem reescrever o runtime.
