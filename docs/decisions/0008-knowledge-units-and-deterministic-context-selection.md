# ADR-0008 — Knowledge Units and Deterministic Context Selection

- Status: aceito
- Data: 2026-09-26

## Contexto

O harness precisa carregar somente o conhecimento útil para a fase e tarefa atuais. Catálogos grandes de Markdown e prompts inseridos no baseline aumentam custo, criam sobreposição entre agents, skills e rules e dificultam provar por que um contexto foi selecionado.

## Problema

Seletores em linguagem natural não são executáveis nem testáveis. Copiar conhecimento para cada adapter cria drift. Carregar tudo sempre contradiz progressive disclosure.

## Decisão

`KnowledgeUnit` é a unidade canônica, harness-agnostic e versionada de conhecimento. Cada unidade declara kind, resumo, seletores estruturados, exclusões, dependências, conflitos, guidance, outputs, stop conditions, proveniência, custo estimado, evals, estabilidade e owners.

`appliesWhen` usa somente dimensões determinísticas: fase, tipo de task, classe e sinais de risco, tecnologias, capabilities e prefixos de path. Dimensões presentes são combinadas por AND; valores dentro de cada dimensão, por OR. `doesNotApplyWhen` exclui uma unidade aplicável. Dependências são incluídas transitivamente; referências ausentes, ciclos e conflitos falham de forma explícita.

O resolver produz um `ContextManifest` ordenado, sem timestamp, com IDs, versões, motivos de seleção e orçamento estimado. O adapter materializa ou apresenta apenas o que o manifest selecionou; ele não mantém uma cópia autoral do conteúdo.

O catálogo v0.4.1 é propositalmente pequeno. As quatro unidades iniciais sintetizam ideias do ECC com revisão e proveniência fixas; o ECC não é dependência de runtime e seu conteúdo não é copiado integralmente.

## Alternativas consideradas

- Skills Markdown como única unidade: descartado porque mistura procedimento, política e integração.
- Seletores textuais interpretados por LLM: descartado no core porque não são determinísticos.
- Baseline com todo o catálogo: descartado por custo, ruído e risco de instruções irrelevantes.
- Catálogo completo do ECC: descartado por acoplamento, sobreposição e ausência de necessidade comprovada.

## Consequências

- Seleção de contexto é reproduzível e explicável.
- Agents, skills, rules e adapters podem referenciar os mesmos IDs sem duplicar conteúdo.
- Novas unidades exigem proveniência e contract tests; quantidade não é objetivo.
- Renderização específica do harness e evals probabilísticos continuam incrementos futuros.
