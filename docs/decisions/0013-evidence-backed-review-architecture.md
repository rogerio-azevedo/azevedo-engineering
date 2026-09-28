# ADR-0013 — Evidence-backed Review Architecture

- Status: aceito
- Data: 2026-09-28

## Contexto

Até a v0.6.1, o Azevedo Engineering possuía papéis read-only de reviewer/security-reviewer e um `Finding` genérico, mas não um runtime capaz de provar qual Specification, Plan Revision, Exploration, Execution e diff foram revisados. Também não havia revisão explícita de cada acceptance criterion, seleção justificável de domínios de segurança, challenge adversarial de findings nem consolidação por causa-raiz.

## Decisão

Review consome a cadeia estruturada `Specification × Plan Revision × Exploration × Execution Session × ChangeSet`. `ReviewContext` registra evidence portátil, trust boundaries, domínios de segurança selecionados e lenses obrigatórias. O diff é representado por digests e changed paths; conteúdo bruto não precisa ser persistido no harness.

Change Review examina correctness, regressões, scope e integração. Acceptance Review classifica cada critério como `satisfied`, `partially-satisfied`, `contradicted` ou `not-verifiable`, sempre contra a Specification autoritativa. Security Review só é obrigatório quando sinais e integration surfaces selecionam domínios concretos; visuais sem boundary de risco não recebem checklist universal.

Reviewers produzem `ReviewFindingCandidate`. Um papel provider-neutral separado executa adversarial verification e decide `confirmed | rejected | insufficient-evidence`. Rejeição exige counterevidence; confirmação exige cenário de falha alcançável e evidence suficiente. O core não usa confidence numérica. Findings confirmados só são consolidados quando compartilham a mesma identidade estruturada de causa-raiz; provenance de todos os reviewers, evidence e cenários é preservada.

`ReviewReadiness` usa `PASS | PASS_WITH_FINDINGS | BLOCKED`, sem score. Source drift, lens obrigatória ausente, critério obrigatório não satisfeito, finding sem challenge, evidence insuficiente, unknown residual ou finding HIGH/CRITICAL confirmado bloqueiam. Finding preexistente e não relacionado é distinguido de regressão introduzida.

Preparations, contexts e reports são artifacts imutáveis create-only. O primeiro relatório é preservado. Uma correção futura exige política explícita, write authorization, nova execução e nova revisão; attempts são append-only e limitados pelo caller entre um e três. A v0.7 define essa fundação, não implementa loop autônomo.

## Alternativas consideradas

- Usar somente prompts livres de code review: descartado porque não há vínculo verificável entre intent, diff, finding e decisão.
- Executar todo checklist de segurança em toda mudança: descartado por ruído, custo e falsos positivos.
- Aceitar score/confidence do reviewer: descartado porque um número não substitui cenário de falha, guard analysis e counterevidence.
- Deduplicar findings por similaridade textual: descartado porque pode fundir bugs distintos ou perder provenance.
- Permitir ao mesmo provider corrigir automaticamente até passar: descartado porque mistura review, autoria e autoridade de escrita.

## Consequências

- O core permanece neutro a Codex, Cursor, Claude Code e a modelos específicos.
- Zero findings é um resultado válido quando criteria e evidence sustentam a conclusão.
- Review pode terminar honestamente em `BLOCKED` mesmo produzindo findings úteis, por exemplo quando o snapshot exato não está mais disponível.
- Security Review é proporcional aos boundaries realmente alterados.
- O CLI prepara contexto e artifacts; adapters/providers podem produzir submissions estruturadas sem redefinir os contratos.
