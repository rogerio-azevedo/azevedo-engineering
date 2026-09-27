# ECC Gap Analysis Against Azevedo Engineering v0.1-v0.6

> Historical audit baseline: sections 1–7 describe the repository before v0.4.1. v0.4.1 closed the Knowledge/Context foundation and revision lineage; v0.5 closed deterministic Specification Intake and Evidence-backed Exploration. v0.6 closes Guided Execution preparation, sessions and trusted package-script verification. Autonomous provider execution, review runtime and broader stack knowledge remain open.

## Executive Summary

The current Azevedo foundation is not a false start. Its strongest choices—canonical harness-neutral contracts, conservative discovery, safe initialization, persistent Engineering Plans, contextual TDD, revision-bound evidence and a real Definition of Done—are equal to or stricter than the corresponding ECC ideas.

The audit does change the next step. Azevedo has built the **control skeleton**, but it has not yet built a canonical home and selection model for the **engineering expertise** that should guide that control skeleton. Implementing Explorer directly now would force exploration heuristics into a Codex prompt, agent TOML or TypeScript branch. That would recreate the coupling and duplication the architecture is intended to avoid.

The evidence therefore supports a small v0.4.x foundation before v0.5:

1. define versioned knowledge units, provenance, selectors and eval references;
2. define how a task resolves a minimal context manifest;
3. close documentation/runtime drift in the current Codex adapter design;
4. extend plan semantics for supplied acceptance and future evidence-backed enrichment without implementing execution.

Then v0.5 should remain Exploration, but as a bounded, evidence-producing workflow—not merely an “explorer agent”.

## 1. What Azevedo Already Captured

### 1.1 Canonical core and thin adapters

`docs/ARCHITECTURE.md` and ADR-0001 already implement the core principle in ECC `docs/architecture/cross-harness.md`: durable behavior is shared and harness differences belong at the edge. Azevedo is stricter because its Zod contracts are already independent from Codex files.

### 1.2 Conservative discovery and initialization

`src/core/discovery/inspect-project.ts`, initialization planning/application and ADR-0002/0005 provide deterministic evidence, ambiguous/unknown states, dry-run, no overwrite, path containment, symlink checks and group-wide preflight. ECC `commands/project-init.md` has the same broad safety intent, but Azevedo’s implemented filesystem behavior is more explicit and testable.

### 1.3 Persistent, deterministic planning

`src/core/planning/engineering-plan.ts` and `plan-persistence.ts` create a schema-validated, create-only, deterministic handoff. This is stronger than ECC’s mostly Markdown planning artifacts and directly supports session/harness portability.

### 1.4 Contextual risk and TDD

`src/core/risk/classify-task.ts` avoids ECC’s universal TDD/coverage policy. It distinguishes behavior, bugs, refactors, UI, infra, dependencies and docs; only appropriate task types demand RED/GREEN. `src/core/verification/definition-of-done.ts` further verifies that RED precedes GREEN, targets the same verifier/scope and GREEN belongs to the final revision.

### 1.5 Verification and Definition of Done contracts

`src/core/schemas/evidence.ts`, `verification-plan.ts` and `definition-of-done.ts` already model pass/fail/skipped/waived/not-applicable, task/scope-bound waivers, subject revisions, blocking findings and acceptance evidence. This is more trustworthy than ECC’s prose-only `/verify` report and fixed command examples.

### 1.6 Governed learning principle

The architecture’s observation → candidate → human decision → promoted artifact pipeline improves on `skills/continuous-learning-v2/SKILL.md`, whose confidence thresholds can auto-apply or promote behaviors. Azevedo correctly treats learning as quarantined input, not self-authorizing policy.

## 2. What Azevedo Partially Captured

| Area | Current reality | Missing ECC depth | Source |
|---|---|---|---|
| Component model | `ComponentSchema` has ID, kind, free-text `appliesWhen`, tags, dependencies/conflicts, stability and owners | Provenance/license/upstream revision, structured trigger/non-trigger selectors, expected output, context cost, adapter support and eval references | ECC skill frontmatter; manifests; `schemas/provenance.schema.json`; `context-budget` |
| Codex context | Short generated `AGENTS.md` principle exists | Task routing, nearest-scope precedence, context manifest and measurable lazy loading | `.codex/AGENTS.md`; `docs/CODEX-NAVIGATION-GUIDE.md`; `context-budget` |
| Explorer | Read-only role contract names paths/symbols/unknowns | Reconnaissance, terminology discovery, execution-path tracing, similar pattern, tests, dependency graph, risk extraction and bounded stop criteria | `codebase-onboarding`; `code-explorer`; `spec-miner`; `iterative-retrieval` |
| Planning | Deterministic generic steps, unknowns and verification targets | Supplied acceptance, discovered facts vs business constraints, local patterns, comparable implementation, per-step evidence and plan enrichment lineage | `intent-driven-development`; `commands/plan.md`; `agents/planner.md`; `contract-first` |
| Risk | Task types and a useful initial signal set | Inputs/uploads/URLs/webhooks, serialization, sensitive logging, dependency permissions, data classification and effect/authority classes | `security-review`; `security-reviewer`; `operator-approval-loop`; capsule effect classes |
| Verification | Discovers lint/typecheck/test/build package scripts and plans targets by scope | Executor, actual EvidenceRecord collection, diff/security/docs/browser/migration verifiers, baseline/freshness checks and incomplete-run orchestration | `verification-loop`; `production-audit`; `orch-review.workflow.js` |
| Review | Finding schema includes severity/confidence/location/failure/impact/evidence | Formal pre-report proof gate, false-positive knowledge, reviewer dimensions, evidence-based dedupe and independent verification of severe findings | `agents/code-reviewer.md`; `workflows/orch-review.workflow.js` |
| Security | Security role and trigger boolean exist | Selectable trust-boundary knowledge, threat questions, negative authorization cases, stack-specific validation and false-positive discipline | `agents/security-reviewer.md`; `skills/security-review/SKILL.md` |
| Documentation | Workflow has Document and ADR triggers are described | Constitution/map/status/history ownership, validation of paths/examples and delete-zone for intentional removals | `living-docs-governance`; `doc-updater` |
| Session continuity | EngineeringPlan persists pre-execution intent | Execution checkpoint, failed approaches, current revision, evidence state and exact resume action | `strategic-compact`; `save-session`; `resume-session`; `unified-memory` |

## 3. Important Knowledge Not Yet Captured

### 3.1 Exploration sufficiency and stop criteria

The current plan says exploration is required but does not define when exploration is sufficient. ECC’s `agents/spec-miner.md` and `skills/iterative-retrieval/SKILL.md` provide the missing pattern: every expansion answers a named gap; start from public surfaces; trace representative behavior; stop at an external boundary, diminishing returns or explicit budget; report deferred scope.

### 3.2 Local convention evidence

`commands/plan.md` §Pattern Grounding explicitly searches naming, error handling, logging, data access and test patterns. v0.4 detects stack and commands, but not how the affected part of the repository actually implements those concerns.

### 3.3 Consumer-aware contracts

`skills/contract-first/SKILL.md` requires consumer/owner/jobs, smallest contract, derived types and both-side verification. Azevedo currently detects `public_contract` risk but carries no contract-impact artifact or consumer evidence.

### 3.4 Review quality controls

The combination of `agents/code-reviewer.md` and `workflows/orch-review.workflow.js` contains important anti-hallucination expertise absent from the current reviewer role: concrete trigger/state/outcome, proof requirements for severe findings, valid zero-finding result, dedupe by evidence and adversarial verification.

### 3.5 Stack-specific engineering expertise

Current profiles detect TypeScript, NestJS, Next.js, PostgreSQL/Drizzle and MongoDB/Mongoose, but contain little procedural knowledge. ECC has useful NestJS, React, Postgres, migration, API and error-handling material. It lacks deep Drizzle, MongoDB/Mongoose, Zod and Zustand packs, so Azevedo must author and evaluate those gaps rather than assume upstream completeness.

### 3.6 Context cost as an architecture property

The architecture says “load only what is needed” but has no measurable context manifest. `skills/context-budget/SKILL.md` shows that always-loaded role descriptions, duplicated rules and MCP schemas are material costs. Selection should return not only component IDs but why each was selected and estimated/actual adapter payload.

### 3.7 Failure-preserving handoffs

ECC `commands/save-session.md` makes “what did not work and why” a required field. An EngineeringPlan cannot preserve execution attempts because it is intentionally pre-execution and immutable. A separate checkpoint/run artifact will be needed before a plan executor.

## 4. Potential Problems in v0.1-v0.4

These are audit findings, not changes made by this task.

### 4.1 Current Codex initialization and documented adapter output diverge

`docs/ARCHITECTURE.md` §9.3 says the initial adapter materializes `AGENTS.md` and four `.codex/agents/*.toml` files. `createCodexInstallPlan()` does produce those five artifacts and its adapter tests cover them. However, the actual `init` path in `src/cli/command.ts` calls `createCodexInitializationArtifacts()`, which emits only `AGENTS.md`.

Consequences:

- a public architecture claim is not true of the current CLI initialization behavior;
- `create-install-plan.ts` and `create-init-artifacts.ts` are two authoring paths for Codex baseline content and can drift;
- the four role contracts exist in code/tests but are not installed by `azevedo init`.

This should be resolved deliberately in v0.4.x: either make the documented surface real through the canonical init plan, or document that specialist files are future output. Do not simply wire both paths together without reconciling ownership/conflict semantics.

### 4.2 EngineeringPlan does not persist acceptance criteria

`evaluateDefinitionOfDone()` accepts `AcceptanceCriterion[]`, but `EngineeringPlanSchema` stores only task description/type and a general understanding summary. The plan therefore cannot be the complete persistent contract from intent to evidence yet. ECC’s `intent-driven-development` highlights the missing observable outcome, prohibited side effect, source and verification method.

### 4.3 Plan enrichment has no lineage model

v0.4 plans are create-only, have `status: planned`, and use an ID derived from task/topology/target scopes. Exploration is expected to discover affected paths and exact tests later, but changing the existing JSON under the same ID correctly yields conflict. Before v0.5, the project must decide whether exploration creates:

- a new immutable plan revision linked to its parent;
- a separate ExplorationArtifact referenced by the plan;
- or a derived executable plan with its own ID.

Overwriting the v0.4 plan would violate its strongest guarantee.

### 4.4 `appliesWhen` is not yet executable selection

`ComponentSchema.appliesWhen` is an array of strings. That is adequate as a placeholder, but cannot reliably express stack, task type, path, risk signal, capability, trigger/non-trigger or precedence. An Explorer built on free-text selection would become prompt-dependent.

### 4.5 Risk heuristics are intentionally narrow but easy to over-trust

`classify-task.ts` recognizes a small text/path subset. Inputs such as webhook, upload, external URL, sensitive log, permission change or unsafe deserialization may remain ordinary risk unless a structured signal is supplied. The architecture already treats structured signals as authoritative; the next step is richer discovery/exploration signals, not a larger fragile keyword dictionary.

### 4.6 Verification discovery is not verification execution

`verification-plan.ts` discovers four script classes and creates targets. It does not execute them, collect EvidenceRecords or prove test relevance. Documentation must continue to distinguish “available/planned” from “ran/passed”; ECC’s verification prose sometimes blurs this distinction, while Azevedo’s schema is designed not to.

### 4.7 Monorepo scope remains unresolved until exploration

The v0.4 plan intentionally leaves monorepo target scopes empty. That is honest, but it means its initial verification plan cannot be final. Exploration must produce evidence-backed scopes and trigger a new derived/revised plan rather than treating the initial verification set as authoritative.

### 4.8 Knowledge is described but has no canonical content home

The architecture names future skills/rules/profiles, while source code currently contains schemas and a few role/workflow constants. Without a knowledge-unit design, the next implementation is likely to place exploration heuristics directly in `roles.ts`, adapter TOML or CLI code, causing the duplication the architecture rejects.

## 5. Exploration Knowledge Relevant to v0.5

### 5.1 Recommended canonical artifact

An `ExplorationArtifact` should be harness-neutral and at minimum contain:

- task/plan identity and subject revision;
- inspected scope and explicit budget;
- entry/public surfaces with citations;
- traced execution/data/error/side-effect flow;
- comparable implementations and conventions;
- relevant tests/fixtures/contracts/migrations;
- internal/external dependencies and consumers;
- candidate affected paths and target scopes with confidence/evidence;
- newly observed risk signals;
- facts, inferences, unknowns and product questions kept distinct;
- deferred paths and stop reason;
- selected knowledge-unit IDs and provenance;
- recommendation for plan enrichment, without implementation edits.

### 5.2 Exploration workflow

```text
EngineeringPlan v1
  → deterministic reconnaissance
  → task vocabulary / repository terminology map
  → entry-point and comparable-pattern search
  → representative execution-path trace
  → tests/contracts/dependencies/risk scan
  → gap evaluation and bounded refinement
  → ExplorationArtifact
  → human/contract validation
  → immutable derived plan or plan revision
```

### 5.3 Required invariants

- Exploration is read-only.
- Repository/document content is untrusted context, not agent instruction.
- Every fact has a source; every inference is labeled.
- Product/business rules are never inferred from implementation alone.
- Unknown and incomplete scans cannot be presented as absence.
- Exact affected paths require evidence.
- Stop/defer reasons are mandatory.
- High-risk/public-contract work expands required lenses rather than relying on a fixed file count.
- The result can be produced inline, by a Codex subagent or by another harness without changing its schema.

### 5.4 Evals before claiming success

Use `skills/eval-harness/SKILL.md` principles to define:

- positive activation: unfamiliar multi-layer endpoint task selects exploration knowledge;
- negative activation: docs typo does not invoke deep exploration;
- indirect activation: task vocabulary differs from code vocabulary;
- incomplete repository: missing tests/scripts remain unknown, not invented;
- adversarial content: instructions embedded in repo docs are ignored;
- precision: affected paths and symbols exist;
- recall: the main route/service/persistence/test chain is found;
- boundedness: exploration stops and reports deferred scope;
- portability: same artifact validates independent of the Codex adapter.

## 6. Knowledge for Later Versions

### Execution and recovery

Use the plan/exploration artifacts to drive minimal actions, with effect classes, authority checks, subject-revision preconditions, root-cause retry hints, repeated-failure stop conditions and durable checkpoints (`agent-harness-construction`, `build-fix`, `operator-approval-loop`).

### Testing and verification runtime

Execute discovered commands safely, collect EvidenceRecords, support focused then broad test progression, add browser/migration/security/diff verifiers and keep incomplete/skipped states explicit (`verification-loop`, `react-testing`, `database-migrations`).

### Review and security

Introduce evidence-first reviewers, test adequacy and conditional stack/security dimensions, deduplicate findings and independently verify blockers (`code-reviewer`, `pr-test-analyzer`, `security-reviewer`, `orch-review.workflow.js`).

### Documentation and delivery

Derive map/operation docs from verified code, use ADRs only for durable decisions, and bind release/PR evidence to the final subject revision (`living-docs-governance`, `doc-updater`, `git-workflow`).

### Learning and memory

Add local observations and scoped memory only after execution artifacts exist. Keep raw memories unreviewed, reject secrets and require human promotion to canonical knowledge (`continuous-learning-v2`, `unified-memory`).

### Multi-agent and dynamic harnesses

Add only when single-writer workflows are stable and evals show benefit. Preserve explicit ownership, isolation, dependency edges, result collection and fail-closed required lanes (`team-agent-orchestration`, `dynamic-workflow-mode`).

## 7. Things We Should Explicitly Not Copy

1. **The entire catalog.** Marketing, healthcare, network, media, prediction-market and operator skills do not belong in the default software-engineering harness.
2. **Catalog parity as a goal.** 292 skills and 68 agents would increase discovery/context/drift cost without proving better task outcomes.
3. **Universal 80% coverage and all-test-type requirements.** These conflict with risk- and behavior-based verification.
4. **Mandatory TDD for docs/UI/refactors and artificial checkpoint commits.** Preserve real RED/GREEN evidence only where it proves behavior.
5. **Universal immutability, function/file length and rate-limit rules.** Treat them as contextual review signals, not invariants.
6. **Fixed model routing.** ECC agent TOMLs and performance rules pin Claude/OpenAI tiers; Azevedo adapters should inherit supported user defaults unless policy explicitly requires otherwise.
7. **Claude hooks as cross-harness enforcement.** ECC itself calls Codex instruction-backed; no adapter should promise native parity.
8. **Duplicated skill copies and command semantics.** Canonical knowledge must be rendered or referenced, never maintained independently per harness.
9. **Automatic learning promotion.** Confidence and recurrence nominate candidates; people approve policy.
10. **Global config changes, MCP enablement or auto-update by default.** Installation remains project-local, reviewable and reversible.
11. **External skill pointers as trusted capabilities.** `skills/repo-scan/SKILL.md` primarily installs another repository; it is not a built-in audit and requires separate provenance/security review.
12. **Delivery gates based on activity proxies.** Touching a learning file or elapsed time is not evidence that engineering work is correct.

## 8. Recommended Roadmap Changes

### v0.4.1 — Knowledge and context foundation (implemented)

Implemented before Explorer so ECC expertise is not embedded in adapter prompts.

- canonical `KnowledgeUnit`/component metadata with kind, structured selectors, non-triggers, dependencies/conflicts, provenance/license/upstream revision, context cost and eval references;
- small initial catalog containing only exploration/intent/review foundations needed by upcoming versions;
- deterministic resolver producing a minimal ContextManifest with selection reasons;
- eval fixtures for activation, non-activation, output requirements and adversarial repo content;
- decision for immutable plan enrichment lineage and persisted acceptance criteria;
- reconcile the two Codex artifact-generation paths and the Architecture §9.3 claim.

This is foundation work, not a large skill library and not an executor.

### v0.5 — Evidence-backed Exploration (implemented)

- deterministic reconnaissance plus semantic/bounded exploration workflow;
- harness-neutral ExplorationArtifact;
- exact citations, fact/inference/unknown separation, similar patterns, flows, tests, dependencies and risk signals;
- stop/defer reasons and context budget;
- evidence-backed plan derivation/revision;
- provider-agnostic CLI surface with dry-run; no subagent or LLM dependency.

The implementation also adds a versioned `FeatureSpecification`, immutable persistence under `.azevedo/specifications/` and `.azevedo/explorations/`, eight exploration Knowledge Units with pinned ECC provenance, acceptance-coverage links and read-only dogfood against backend, frontend and a real product specification. Partial and blocked results are first-class; no target command or feature implementation is performed.

### v0.6 — Guided execution and verification evidence (implemented)

- consumes an enriched immutable Plan Revision with Specification and Exploration provenance;
- binary readiness separates product blockers from investigable technical unknowns;
- budgeted ExecutionContext plus seven execution Knowledge Units with pinned ECC provenance;
- provider-neutral CodingAgent handoff, explicit isolated-write permission and evidence-backed scope expansion;
- append-only ExecutionSession snapshots, classified attempts and a three-attempt recovery ceiling;
- trusted-script verification executor with EvidenceRecord output, deny rules and no shell;
- subject-revision invalidation, HEAD/status checkpoints, dirty-work protection and secret-value rejection;
- no provider API, autonomous coding loop, commit, push or external mutation.

### v0.7 — Review and security system

- common Finding lifecycle;
- correctness and test-adequacy dimensions;
- conditional security/architecture/persistence/stack lenses;
- evidence dedupe and independent verification of severe findings;
- incomplete/fail-closed review status tied to DoD.

### v0.8 — Stack knowledge and delivery documentation

- evaluated packs for NestJS+Zod, Next/React/Tailwind/Zustand, Postgres+Drizzle and MongoDB+Mongoose;
- migration and contract-first workflows;
- documentation/ADR selection and living-doc role map;
- distribution manifests only after real packs justify them.

### v0.9+ — Learning, memory, doctor/update and optional orchestration

- governed candidates and scoped unreviewed memory;
- install state, provenance audit, doctor/repair/update/uninstall;
- hooks as optional acceleration;
- multi-agent/dynamic harnesses only after comparative evals.

Version boundaries may be adjusted, but the dependency order is evidence-driven: knowledge selection → exploration → execution/evidence → review → broader packs/learning/distribution.

## 9. Central Question

### If we continued without returning to ECC, what would we risk reinventing or losing?

We would risk losing concrete engineering knowledge, not just prompt templates:

1. **Bounded exploration**: public-surface-first sampling, explicit missing-context questions, representative flow tracing and stop/defer criteria (`spec-miner`, `iterative-retrieval`).
2. **Repository-grounded planning**: mirror naming/errors/logging/data/tests and never invent exact paths (`commands/plan.md`, `planner`).
3. **Intent discipline**: code describes current behavior, not business truth; acceptance needs observable outcomes and prohibited effects (`intent-driven-development`).
4. **Consumer-aware contract evolution**: consumers/owners/jobs, smallest contract, derived types and both-side proof (`contract-first`).
5. **Real TDD evidence**: RED must execute the intended path and fail for the intended reason; GREEN reruns the same target (`tdd-workflow`).
6. **Behavioral test selection**: user-visible component tests, real network-boundary mocks, browser escalation and test-at-escape-layer regression (`react-testing`, `ai-regression-testing`).
7. **Low-noise review**: exact failure scenario, guard/context analysis, defensible severity, valid zero findings and explicit false-positive filters (`code-reviewer`).
8. **Adversarial blocker verification**: parallel dimensions, evidence dedupe, independent high/critical verification and fail-closed incomplete review (`orch-review.workflow.js`).
9. **Trust-boundary security routing**: authz, inputs, data, filesystem/process, external calls, secrets/logs, dependencies and abuse limits selected only when relevant (`security-review`, `security-reviewer`).
10. **Failure-preserving continuity**: record failed approaches and why, subject state, blockers and exact next action before compaction/handoff (`save-session`, `strategic-compact`, `unified-memory`).
11. **Knowledge governance**: provenance, project scoping, context cost, human promotion and one canonical owner per fact (`continuous-learning-v2`, `context-budget`, `living-docs-governance`).
12. **Safe orchestration semantics**: dependency lanes, isolated writes, collected results, payload-bound approval and explicit stop conditions (`parallel-execution-optimizer`, `rules/common/agents.md`, `operator-approval-loop`).

Without mining these patterns, Azevedo could still become a good deterministic CLI, but it would risk becoming a thin process engine whose future agents must rediscover the author’s engineering heuristics task by task. The immediate architectural lesson is to make expertise a versioned, selectable, evaluated first-class input before automating more of the workflow.
