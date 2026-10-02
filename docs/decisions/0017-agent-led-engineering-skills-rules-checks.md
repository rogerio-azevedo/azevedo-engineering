# ADR-0017 — Agent-led engineering: skills, rules, checks e review

- Status: aceito
- Data: 2026-10-01

## Contexto

O objetivo do Azevedo Engineering é melhorar a qualidade do trabalho feito por coding agents. Entre a v0.5 e a v0.9 ele virou um control plane determinístico: onboarding, WorkItem, specification, exploration, relevance, planning, execution preparation e review.

Os dogfoods separaram o que funcionou do que não funcionou.

Funcionou, e é verificável ou disciplina de review:

- v0.6.1: o DoD recusou "done" com lint global vermelho e acceptance criteria sem evidência.
- v0.6.1: um `lint --fix` alterou 86 arquivos. Isso originou a detecção de command effect (ADR-0012).
- v0.7: a review encontrou dois findings HIGH reais (guard cross-tenant e upload sem autenticação) e refutou candidates com contraevidência.

Não funcionou, e é raciocínio sobre código:

- v0.9: os planos de "Cadastro de moradores" saíram com `affectedPaths: []`. A evidência para "moradores" apontou para `assembly-representative`, `realization-comment` e `kanban-card-comments`. A exploration parou por budget.
- O coding agent, explorando livremente os mesmos repositories, achou as integration surfaces corretas e produziu um plano melhor.
- Para a exploration lexical funcionar, o engine recebeu vocabulário do Síndico Pro (`TERM_GROUPS`, capability `address-data`). Cada dogfood ensinava termos novos ao código genérico.

## Problema

O Azevedo reproduz deterministicamente uma capacidade em que o coding agent já é melhor. Ao mesmo tempo, não impõe as convenções objetivamente verificáveis que deveria garantir: nomes técnicos em inglês, endpoint sem autorização, migration perigosa, segredo no diff, mudança fora do scope, verificação ignorada. E não está presente no momento em que o agente trabalha.

## Decisão

### Responsabilidades

O coding agent é o desenvolvedor. Ele entende a task, pergunta, explora, pesquisa, raciocina sobre arquitetura, planeja e implementa.

O Azevedo fornece:

- **rules**: as convenções. Cada rule é a fonte única da sua convenção e declara como é imposta: `check`, `review` ou `guidance`;
- **skills**: os procedimentos que o agente carrega sob demanda;
- **checks**: código determinístico para o que é objetivamente verificável no change set;
- **review e security review**: procedimentos executados por subagentes read-only para o que exige raciocínio.

Se o agente faz algo melhor por raciocínio, o Azevedo não reimplementa isso em código. Código determinístico fica restrito a invariantes, segurança, verificação, evidência e enforcement: captura do change set, detecção do projeto, runner de comandos seguro, relatório e instalação/hooks por harness.

### Integração mínima no target

Skills, rules, checks e subagentes pertencem ao Azevedo Engineering e são instalados no nível do harness ou do usuário, não no target.

O target contém somente:

- a configuração do Azevedo para aquele projeto (exceções explícitas, glossário, comandos);
- o passo de CI que executa `azevedo check --ci`.

Não há `init` de harness, `AGENTS.md` gerado, papéis por harness nem `.azevedo/` versionado no target.

### Task file

O task file (acceptance criteria, scope, plano, waivers) é local e não versionado por padrão. Ele nunca aparece num PR. O mecanismo que o mantém fora do Git é decidido na implementação do check e não pode exigir outro arquivo versionado além da configuração. Versionar o task file só pode virar opt-in se houver valor comprovado.

### Naming

Identificadores técnicos são em inglês:

- arquivos e diretórios;
- identificadores de código;
- API routes;
- page routes do Next.js;
- identificadores de banco.

Conteúdo apresentado ao usuário pode continuar em português.

Exceções existem só por configuração explícita. O agente nunca infere uma exceção, nem por "termo de domínio". O check avalia nomes novos ou renomeados no change set; legado existente não é reprovado retroativamente. Uma alteração nas exceções dentro do próprio change set é reportada de forma explícita.

### Enforcement

1. Instrução: rule e skill mandam rodar `azevedo check` antes de declarar conclusão.
2. Hook do harness, onde existir: ao encerrar, os checks estáticos rodam e as falhas voltam ao agente. A falha deixa de ser silenciosa.
3. CI: `azevedo check --ci` roda nos targets, inclusive Síndico Pro. Violação objetiva sai com código não zero e bloqueia o merge como required check.

Em CI rodam os checks que não dependem do task file. Scope, acceptance criteria e review gate dependem do task file e da review local, por isso são impostos localmente.

### Control plane congelado

O control plane da v0.9.0 fica congelado a partir desta decisão: `project`, `work`, `explore`, `plan`, `execute` e `review` pelo CLI. Não recebe features nem hardening. Continua funcional até a remoção, que só acontece depois que a substituição passar em dogfood. A tag `v0.9.0-control-plane` marca o último commit dessa arquitetura.

### ADRs anteriores

Continuam válidos como princípio:

- 0001: core canônico e adapters finos;
- 0002: o projeto existente prevalece sobre a arquitetura de referência;
- 0003: entrega baseada em evidência;
- 0005: nunca sobrescrever conteúdo do usuário;
- 0012: command effect, sem a exigência de linked worktree e checkpoint autorizado.

Ficam superados como direção os ADRs 0004, 0006 a 0011 e 0013 a 0016. O status de cada um é atualizado quando o código que ele descreve for removido. Até lá, eles ainda descrevem comportamento em execução.

## Alternativas consideradas

- Melhorar a exploration determinística com mais heurística ou embeddings: descartado. O dogfood mostrou overfitting ao domínio, e o agente já faz essa leitura melhor.
- Chamar um LLM de dentro do Azevedo: descartado. Duplica o agente e acopla o engine a um provider.
- Instalar um harness em cada target, como o `init` atual: descartado. Viola a integração mínima.
- Versionar o task file por padrão: descartado. Artefatos operacionais do Azevedo não devem aparecer em todo PR.
- Enforcement só por instrução e hook local: descartado. Não bloqueia merge.
- Deixar o agente decidir exceções de naming: descartado. Exceção é decisão humana e explícita.

## Consequências

- A próxima fase é conteúdo: rules e skills reescritas a partir do catálogo de Knowledge Units e da pesquisa ECC, validadas em dogfood antes de qualquer check.
- O CI nos targets exige que o check seja distribuível fora deste checkout. Isso precisa ser resolvido antes de integrar o Síndico Pro.
- Checks avaliam o delta. Código legado em português nos targets não bloqueia, mas código novo sim.
- `docs/dogfood/` e `docs/research/` permanecem como a evidência desta decisão.
- O README e o `docs/ARCHITECTURE.md` continuam descrevendo o código atual até a remoção do control plane.
