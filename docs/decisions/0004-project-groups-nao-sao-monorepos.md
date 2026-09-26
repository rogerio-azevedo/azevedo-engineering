# ADR-0004 — Project groups não são monorepos

- Status: aceito
- Data: 2026-09-26

## Contexto

Um target de inspection pode ser um diretório agregador sem manifesto próprio, contendo projetos independentes. Esses projetos podem possuir package managers, stacks, capabilities e topologias diferentes.

## Problema

Classificar o container como monorepo destruiria a identidade dos projetos filhos e enfraqueceria a semântica determinística de monorepo, hoje baseada em workspaces e manifests observáveis. Ignorar os filhos, por outro lado, tornaria `inspect` pouco útil para esse layout real.

## Decisão

`ProjectTopology` continua limitado a `single-repo` e `monorepo`. A inspection do target passa a ser uma união entre projeto e project group. Um project group fica acima de `ProjectInspection` e contém uma inspection completa para cada projeto reconhecido.

A busca de filhos só ocorre quando a raiz tem topologia desconhecida, limita-se a diretórios filhos imediatos, ignora diretórios técnicos óbvios e reutiliza o discovery existente para reconhecer candidatos. Zero candidatos preserva o resultado unknown da raiz; um ou mais candidatos produzem project group. Um único filho continua sendo grupo porque o target solicitado foi o container.

## Alternativas consideradas

- Adicionar `project-group` a `ProjectTopology`: descartado porque organização externa não é topologia interna de projeto.
- Tratar o container como monorepo implícito: descartado por ausência de evidência de workspace e por misturar package managers independentes.
- Fazer crawling recursivo: descartado por ampliar custo, falsos positivos e complexidade antes de existir necessidade comprovada.
- Colapsar um grupo de um filho no projeto: descartado porque perderia a identidade do target solicitado.

## Consequências

- Consumidores distinguem explicitamente `kind: project` de `kind: project-group`.
- Package managers e ambiguidades permanecem locais a cada projeto filho.
- Monorepos reconhecidos nunca são reclassificados como grupos.
- Diretórios agregadores ganham utilidade sem heurísticas por nome ou crawling profundo.
- Layouts mais profundos exigirão decisão futura explícita; não são descobertos na v0.2.1.
