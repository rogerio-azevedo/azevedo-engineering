# ADR-0014 — Review Semantic Hardening

- Status: aceito
- Data: 2026-09-28

## Contexto

O dogfood da v0.7 provou a utilidade da arquitetura evidence-backed, inclusive preservando candidates refutados, mas expôs quatro ambiguidades semânticas. Todo residual unknown bloqueava; um critério obrigatório podia ser marcado `not-applicable` apenas com evidence genérica; IDs lógicos distintos não demonstravam invocações independentes; e integration surfaces ou risk signals sem mapping podiam desaparecer da seleção de segurança.

O incidente anterior de lint mutante também motivou avaliar uma taxonomia mais ampla para mutations. A proteção atual, baseada na observação before/after do workspace, permanece correta e não deve ser enfraquecida.

## Decisão

`ReviewUnknown` passa a representar descrição, impacto, razão, provenance, evidence, acceptance criteria e risk domains relacionados, além de uma disposition explícita `blocking | non-blocking`. Unknowns estruturados nunca desaparecem do relatório. Um unknown não bloqueante precisa de evidence utilizável; strings históricas da v0.7 continuam legíveis e permanecem bloqueantes por não possuírem disposition auditável.

`not-applicable` passa a ser uma declaração de responsabilidade, não uma fuga de evidence. Um critério obrigatório só é aceitável como N/A com `NotApplicableScopeClaim`: basis explícita, target responsável, evidence de artifact/contract incluída no próprio acceptance review e confirmação por reviewer logicamente distinto com evidence direta ou corroborada. N/A sem claim defensável bloqueia quando o critério é obrigatório e permanece um aviso quando ele é opcional.

`ReviewerRun` pode registrar `runId` e provenance provider-neutral com invocation, adapter, modelo opcional e digest do contexto. Candidates e verificações podem apontar para esses runs. O relatório classifica a separação como `logical-only` ou `independent-invocation`; mesmo invocações distintas nunca são apresentadas como independência de provider. Um digest da submissão preserva sua identidade auditável.

`RiskCoverage` registra capabilities e sinais conhecidos cobertos, além de gaps evidence-backed sem mapping. Cada gap exige uma avaliação explícita de impacto e disposition. Gap ainda não avaliado bloqueia por ausência de decisão; gap avaliado pode ser bloqueante ou não bloqueante. Incerteza crítica deve bloquear, enquanto incerteza de baixo impacto não pode ser promovida arbitrariamente a bloqueio. O sistema não interpreta ausência de mapping como ausência de risco.

Os schemas permanecem na versão 1 com extensões aditivas: novos campos de contexts e reports são opcionais para leitura, submissions aceitam o formato estruturado e a string histórica de unknown, e o runtime novo sempre emite os campos endurecidos. Artifacts v0.7 permanecem imutáveis e legíveis.

A taxonomia `SOURCE_MUTATION | EXPECTED_ARTIFACT_MUTATION | HARNESS_MUTATION | UNKNOWN_MUTATION` fica adiada. Introduzi-la corretamente exige um modelo de ownership e lifecycle de artifacts, não somente uma lista de diretórios. A v0.7.1 mantém a autoridade da comparação before/after, prova que mutation inesperada de source continua falhando e documenta que saída gerada ignorada, como `dist/`, fica fora do conjunto de source observado.

## Alternativas consideradas

- Manter todo unknown como bloqueante: descartado porque confunde ausência de conhecimento de baixo impacto com impedimento de entrega.
- Permitir ao reviewer escolher livremente N/A: descartado porque transforma scope em escape hatch.
- Exigir providers ou modelos diferentes: descartado por custo e por não provar independência operacional; provenance observável é a garantia correta.
- Rodar todos os domínios de segurança: descartado por ruído. Gaps explícitos preservam seleção proporcional sem alegar cobertura inexistente.
- Classificar mutations somente pelo path: adiado porque diretório não demonstra ownership nem expectativa para toda stack.

## Consequências

- `PASS_WITH_FINDINGS` pode representar unknowns e gaps explicitamente não bloqueantes.
- Required AC insuficiente continua bloqueando independentemente da disposition de um unknown relacionado.
- Cross-project N/A é possível, mas sua responsabilidade e challenge permanecem auditáveis.
- Reviews históricos sem invocation provenance dizem somente `logical-only`; não há inferência retroativa de independência.
- Coverage desconhecida precisa de decisão evidence-backed, sem paranoia automática e sem silêncio.
- O resultado do dogfood pode permanecer `BLOCKED` pelas razões concretas originais, mesmo com unknowns mais precisos.
