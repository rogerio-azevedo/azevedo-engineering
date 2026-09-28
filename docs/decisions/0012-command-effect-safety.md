# ADR-0012 — Command Effect Safety and Workspace Binding

- Status: aceito
- Data: 2026-09-28

## Contexto

No dogfood da v0.6.1, um script de lint descoberto pelo harness continha `--fix`. O Verification Runtime o executou como se fosse uma observação read-only, alterou 86 arquivos rastreados no checkout principal e ainda vinculou o resultado à revisão capturada antes do comando. A restauração posterior exigiu autorização humana e um checkpoint anterior confiável. O incidente demonstrou que bloquear apenas comandos destrutivos e usar `shell: false` não protege contra side effects legítimos de ferramentas de desenvolvimento.

## Decisão

Todo comando de verification recebe uma classificação estática `read-only | may-mutate | mutating | unknown`. A classificação orienta a decisão, mas não é autoridade: o runtime captura revisão e fingerprints de arquivos antes e depois de qualquer comando permitido. Um efeito observado sobre arquivos visíveis à revisão invalida a evidence, produz `command-side-effect`, lista os paths afetados e preserva as mudanças para inspeção; nunca restaura, limpa ou descarta automaticamente.

Comandos classificados como `mutating` não executam como verification. Scripts `may-mutate` e `unknown` somente podem executar sob observação. O runtime exige um `ProjectCheckpoint` explicitamente autorizado, confere uma identidade não reversível do project root, git directory e common directory e, por padrão, exige linked worktree. CWD arbitrário, checkout primário, checkpoint antigo ou workspace diferente produzem `workspace-mismatch` antes da execução.

`EvidenceRecord` passa a registrar o efeito declarado, basis, efeito observado, paths afetados e revisões anterior/posterior. Evidence aprovada pertence à revisão posterior real, nunca à revisão fornecida pelo caller antes do comando. Checkpoints antigos continuam legíveis, mas sem `workspaceIdentity` não autorizam novos comandos.

## Alternativas consideradas

- Manter uma blacklist maior de flags: descartado porque scripts compostos, plugins e mudanças futuras tornam a lista incompleta.
- Restaurar automaticamente arquivos alterados: descartado porque pode apagar trabalho humano e ocultar o incidente.
- Executar todo comando no checkout principal e comparar apenas `git status`: descartado porque um arquivo já dirty pode ser novamente modificado sem alterar a lista de paths.
- Proibir build e testes: descartado; são verificações válidas, mas precisam de observação runtime porque podem produzir artefatos ou atualizar arquivos.

## Consequências

- Verification não pode aprovar silenciosamente uma mutação de source.
- Classificação e efeito observado ficam separados e auditáveis.
- A infraestrutura precisa fornecer checkpoint e worktree autorizados; chamadas legadas sem esse vínculo falham fechadas.
- Build outputs ignorados não contaminam o change set, enquanto arquivos rastreados ou untracked visíveis são detectados por conteúdo.
- Recovery de uma mutação permanece uma decisão humana explícita apoiada em evidence.
