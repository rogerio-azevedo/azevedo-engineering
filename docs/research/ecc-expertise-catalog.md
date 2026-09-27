# ECC Expertise Catalog

## 1. Purpose

This catalog extracts engineering knowledge from ECC commit `e482e579415fde18357cafce70f177ae19fd7f03`. It is organized by engineering domain rather than ECC directory, so future Azevedo work can reuse the knowledge without depending on Claude Code, slash commands or ECC’s filesystem layout.

Source references use `path` plus the relevant section heading. They identify where the heuristic is encoded; the descriptions below are synthesis, not copied operating instructions.

## 2. Curated skill inventory

ECC contains 292 skills in the audited snapshot. The 47 skills below are directly relevant to the Azevedo software-engineering harness or its declared stack. Other relevant knowledge also appears in agents, rules, workflows, hooks and schemas and is covered in later sections.

| # | Skill | Problem and trigger | Engineering knowledge | Dependencies/interactions | Original-runtime dependence | Portable portion and Azevedo destination |
|---:|---|---|---|---|---|---|
| 1 | `accessibility` | Design/review interactive UI | Semantic structure, keyboard/focus, contrast, labels and automated/manual checks | React/frontend review and browser testing | Low except tool examples | High; conditional frontend knowledge pack and review lens |
| 2 | `agent-eval` | Compare agent behavior or configurations | Isolate runs, use identical tasks, separate deterministic/pattern/model graders, compare outcome and cost | `eval-harness`, worktrees | Medium; assumes agent runners | Medium; future harness benchmarking, not v0.5 |
| 3 | `agent-harness-construction` | Design agent tools and observations | Narrow schema-first actions, deterministic observations, actionable error recovery, explicit context budget | All future runtime tools | Low | Very high; design rule for Explorer/Executor contracts |
| 4 | `agent-introspection-debugging` | Diagnose agent/tool loop failures | Reproduce, inspect tool/observation boundaries, narrow hypotheses and verify recovery rather than patching prompts blindly | Harness telemetry/evals | Medium | High; debugging knowledge plus future observability |
| 5 | `agent-self-evaluation` | Review a non-trivial deliverable | Score five output axes independently, cite evidence for gaps, repair cheap omissions, avoid self-awarded perfection | Verification evidence | Low | High as advisory post-check; never a correctness gate |
| 6 | `agentic-engineering` | Structure AI-assisted engineering work | Treat plans, tests, reviews and evidence as system components rather than prose conventions | Planning/orchestration/evals | Medium | Medium; principles already partly in Architecture |
| 7 | `ai-regression-testing` | Prevent recurrence of AI-introduced/escaped bugs | Test at the layer where the bug escaped; check environment parity, error-state leakage and rollback behavior | TDD, test analyzer | Medium; examples are Next/Vitest | High heuristics; regression-testing pack |
| 8 | `api-design` | Create/change an HTTP contract | Resource semantics, status/error shape, bounded pagination, authz, rate limiting and version compatibility | `contract-first`, security, backend patterns | Low | High; API knowledge pack selected by public-contract signal |
| 9 | `architecture-decision-records` | Preserve a durable technical decision | Capture context, alternatives, consequences, risk, status and supersession; do not record routine edits | Architect and docs governance | Low | High; already represented by Azevedo ADR practice |
| 10 | `backend-patterns` | Build/review server code | Layering, validation, service boundaries, data access, errors, caching and observability patterns | API/error/security/database packs | Low | Medium; split into focused packs rather than one large skill |
| 11 | `codebase-onboarding` | First contact with an unfamiliar repo | Cheap reconnaissance before deep reads; architecture/data-flow mapping; convention detection; explicit unknowns | Explorer, iterative retrieval | Low | Very high; exploration phase 1 |
| 12 | `code-tour` | Produce a reusable guided walkthrough | Verify every path/anchor; adapt narrative to reader; explain situation, mechanism, implication and gotcha | Documentation/exploration | Medium; CodeTour output format | Medium; later documentation artifact |
| 13 | `coding-standards` | General code-quality guidance | Simplicity, real-not-speculative abstraction, boundary validation and explicit errors | Stack-specific rules | Low | Medium; decompose into contextual rules and reject universal style thresholds |
| 14 | `context-budget` | Diagnose context bloat | Inventory always-loaded surfaces, find overlap, classify always/sometimes/rarely needed and measure MCP schema cost | Adapter manifests/skills | Medium; Claude paths and estimates | High method; context audit against actual generated payloads |
| 15 | `continuous-learning-v2` | Extract reusable patterns from sessions | Atomic trigger/action/evidence, confidence changes, project isolation and promotion candidates | Hooks, provenance, evals | High; hook/background runtime | Medium; preserve model, require human promotion and no auto-application |
| 16 | `contract-first` | Change a public/shared boundary | Identify consumers and owners, smallest useful contract, derived types, provider/consumer proof and staged change protocol | Architecture, API, migrations | Low | Very high; conditional planning/implementation pack |
| 17 | `database-migrations` | Change schema/data safely | Immutable deployed migrations, separate DDL/DML, production-scale testing, expand-contract, concurrent/batched changes and recovery | DB reviewer, Postgres, ORM packs | Low | Very high; persistence pack, with Drizzle-specific additions authored separately |
| 18 | `delivery-gate` | Mechanically block incomplete sessions | Deterministic gates should inspect machine facts; warnings and blockers need different confidence | Hooks and learning files | High | Low/medium; keep machine-fact principle, skip “file touched today = learned” |
| 19 | `documentation-lookup` | Verify third-party APIs/version behavior | Prefer primary/version-matched docs, cite exact source and distinguish unavailable lookup from negative evidence | Docs researcher, search-first | Medium; connector-specific paths | High; research knowledge and evidence contract |
| 20 | `dynamic-workflow-mode` | Create a task-local repeated loop | Only build a harness when repetition repays it; require objective/input/output/eval/handoff/stop; promote after recurrence | Eval, orchestration, control pane | Medium | High later; defer runtime until v1+ |
| 21 | `e2e-testing` | Validate critical browser flows | Use stable user-facing locators, isolate data, collect artifacts, diagnose flakiness and keep suites focused | Browser tooling, React testing | Medium | High knowledge; conditional E2E pack |
| 22 | `error-handling` | Design reliable failure behavior | Typed/categorized errors, causal context, safe client messages, bounded retries, boundaries and partial-failure handling | API/backend/review | Low | High; generic pack plus project conventions |
| 23 | `eval-harness` | Prove an agent/skill capability and prevent regressions | Define capability and regression cases before changes; deterministic graders first; separate pass@k from pass^k reliability | All probabilistic components | Medium; local helper examples | Very high; v0.4.x foundation and continuous use |
| 24 | `frontend-patterns` | Structure frontend applications | Component boundaries, data/state placement, async/error/loading states and accessibility | React/Next/testing packs | Low | Medium; split into task-selected lenses |
| 25 | `git-workflow` | Prepare commits/PRs safely | Inspect full branch diff/history, focus commits, preserve test evidence and resolve conflicts deliberately | Review and delivery | Medium; assumes certain conventions | Medium; project policy and user authority must override |
| 26 | `intent-driven-development` | Clarify ambiguous/high-impact work | Inspect technical facts first, never derive business truth from code, ask only material questions, define observable acceptance and prohibited effects | Planning/risk/exploration | Low | Very high; enrich EngineeringPlan understanding/acceptance |
| 27 | `iterative-retrieval` | Retrieve sufficient context without loading everything | Dispatch, evaluate relevance/gaps, refine, bound cycles and stop when critical gaps close | Explorer/subagents | Medium; framed around subagents | Very high; harness-neutral exploration loop |
| 28 | `living-docs-governance` | Prevent docs and agent context from rotting | One canonical owner per fact; constitution/map/status/history roles; links over duplication; docs remain untrusted evidence | AGENTS, ADRs, maps, status | Low | Very high; v0.4.x documentation architecture |
| 29 | `nestjs-patterns` | Build/review NestJS backend | Thin controllers, feature modules, provider-owned business logic/UoW, boundary/config validation, consistent errors and production-equivalent tests | API/error/security/persistence | Low | High with adaptation from class-validator to detected Zod conventions |
| 30 | `operator-approval-loop` | Control external/irreversible actions | Bind approval to exact proposed effect and baseline, expire/revalidate it, separate draft from delivery | Effect classes, remote tools | Medium | High later; authority/effect contract for v0.9+ |
| 31 | `orch-pipeline` | Coordinate feature/fix/refactor/MVP work | Right-size ceremony, use operation-specific first moves, gate plan and commit, route security by triggers | Planner/TDD/review agents | High; Claude agents/commands | High knowledge; translate to canonical workflow states |
| 32 | `parallel-execution-optimizer` | Accelerate independent work safely | Build a lane/dependency matrix, isolate writes, collect every result, stop dependents on plan-changing blockers | Worktrees/agents/tests | Medium | High later; execution scheduler policy |
| 33 | `plan-orchestrate` | Convert plans to specialist execution chains | Decompose steps, attach acceptance/scope, choose/dedupe bounded roles and ensure reviewer closure | Agent catalog/orchestrate command | High | Medium; role selection belongs in workflow resolver, not emitted slash commands |
| 34 | `postgres-patterns` | Design/tune PostgreSQL | Index by real predicate, equality-before-range, bounded pagination, lock-aware queues, RLS and operational timeouts | DB reviewer/migrations | Low | High with contextual validation; no universal data-type defaults |
| 35 | `prisma-patterns` | Avoid Prisma production traps | Query-shape discipline, transaction form/timeouts, N+1, pool limits, shared-env migration safety and guarded deletes | Database/migration packs | Low | High for Prisma projects; defer until non-reference packs are supported |
| 36 | `production-audit` | Assess release readiness | Demand evidence for security, data integrity, operations, external effects and UX; score unknowns honestly | Verification/review/security | Low | High later; risk-driven release audit rather than one universal checklist |
| 37 | `react-patterns` | Build/review React/Next UI | Pure render, disciplined effects, nearest state, server/client boundaries, suspense/errors and accessible composition | Frontend/testing/performance | Low | High; detect framework/version and project patterns first |
| 38 | `react-performance` | Diagnose UI performance | Attack waterfalls/bundle/server work before micro-memoization; require measured render/cache evidence | React review/browser evidence | Low | High but defer to performance-triggered work |
| 39 | `react-testing` | Choose and write useful component tests | Test observable accessible behavior, real providers/network boundary, async without sleeps, select JSDOM/component/E2E by capability | E2E/accessibility/TDD | Low | Very high; coverage thresholds become project policy, not pack invariant |
| 40 | `safety-guard` | Prevent dangerous operations during autonomous work | Separate caution from freeze, protect explicit paths/effects and require deliberate unlock | Hooks/permissions | High | Medium; generalize into effect classes, approvals and adapter enforcement |
| 41 | `search-first` | Avoid unnecessary custom implementations | Search repo first, then registries/primary docs/OSS; state unavailable channels; decide adopt/wrap/compose/build by fit, maintenance, license and dependency cost | Docs lookup/researcher/planner | Medium | High; trigger only where external reuse is plausible |
| 42 | `security-review` | Review sensitive changes | Threat-focused checks for secrets, validation, injection, authz, browser attacks, abuse, exposure and dependencies | Security reviewer/scanner | Low | High after removing stack-specific/universal assumptions |
| 43 | `strategic-compact` | Preserve coherence through long tasks | Compact at completed phase boundaries; persist plan/checkpoint first; preserve failures/decisions; avoid mid-implementation compaction | Session lifecycle/context budget | High for hook thresholds | Very high knowledge; execution checkpoint policy |
| 44 | `tdd-workflow` | Prove new behavior/bugs | A valid RED exercises the intended path and fails for the intended reason; GREEN reruns the same target; evidence maps behavior to tests | Planner/test runner/verification | Medium | High core semantics already captured; skip universal application/coverage/commits |
| 45 | `team-agent-orchestration` | Coordinate multi-agent work | Explicit owner, dependency, status, isolated write surface, merge gate and handoff; parent must collect results | Parallel lanes/control pane | High | Medium later; do not require multi-agent for exploration |
| 46 | `unified-memory` | Share durable context across harnesses | Scoped/create-only/unreviewed records, secret boundary, incomplete-scan semantics, source freshness checks and human promotion to governed docs | Memory schema/CLI/MCP | Medium | Very high trust model; independent Azevedo implementation later |
| 47 | `verification-loop` | Check work before completion | Compose build/types/lint/tests/security/diff; record failures and incomplete checks; hooks are supplemental | Verifiers/DoD | Low | High sequence; Azevedo’s discovered commands and risk-based gates remain authoritative |

## 3. Planning knowledge

### Facts, intent and assumptions are different kinds of input

`skills/intent-driven-development/SKILL.md` §Operating Rules draws a boundary that Azevedo has not yet encoded deeply enough: the repository can establish current technical behavior but cannot establish product policy, target users, compliance obligations or desired limits. An enriched plan should classify statements as:

- **supplied intent**: authoritative because the user or product artifact supplied it;
- **discovered fact**: cited to code/config/tests;
- **assumption**: necessary but unverified and visible for confirmation;
- **unknown**: blocks or increases the risk of later work.

Acceptance must describe an initial condition, action, observable outcome, prohibited side effect and verification method. “Works correctly” is not an acceptance criterion.

### Plans must mirror the repository

`commands/plan.md` §Pattern Grounding and `agents/planner.md` require the planner to inspect naming, errors, logging, data access and tests before naming changes. The portable rule is not “always predict exact files”; it is:

1. cite the closest working pattern;
2. name an exact file/symbol only when exploration found it;
3. otherwise leave the target unresolved and add a research step;
4. order work by dependency and executable vertical slice;
5. bind each step to a proof.

This complements the conservative v0.4 EngineeringPlan: exploration may refine its empty `affectedPaths`, but planning must never fill them from vocabulary alone.

### Boundary changes require consumer evidence

`skills/contract-first/SKILL.md` §Workflow and §Change Protocol says to identify consumers and owners before choosing a provider shape, define the smallest contract that satisfies consumer jobs, derive types where possible, then prove provider and consumer compatibility. It explicitly warns against provider guesswork, duplicate sources of truth and relying only on compilation. This is relevant to HTTP APIs, events, shared Zod schemas and database-facing contracts.

## 4. Exploration knowledge

### The exploration algorithm

The combined process from `skills/codebase-onboarding/SKILL.md`, `agents/code-explorer.md`, `agents/spec-miner.md` and `skills/iterative-retrieval/SKILL.md` is:

1. **Orient cheaply**: inspect manifests, config, top-level structure, entry points, test layout and existing harness instructions.
2. **Translate task vocabulary**: search task nouns/verbs, then learn the repository’s actual terms from matches.
3. **Find a public/entry surface**: route/controller/page/command/export/schema or test that exposes the behavior.
4. **Trace one real path**: follow calls/imports through validation, business logic, persistence, events/side effects and error handling.
5. **Trace one comparable behavior**: locate an analogous implementation and record conventions worth mirroring.
6. **Locate behavioral proof**: tests, fixtures, contracts, migrations and build/type/lint commands for that path.
7. **Map dependencies and blast radius**: callers, consumers, shared packages, public contracts and external boundaries.
8. **Extract risk signals**: authz, persistence, external effects, destructive operations, data exposure and compatibility.
9. **Name gaps**: every additional read must answer an explicit missing-context question.
10. **Stop with a reason**: sufficient evidence, external boundary, configured file/time budget, or diminishing returns. Record unread/deferred areas rather than implying total coverage.

`agents/spec-miner.md` provides useful concrete defaults—public surfaces first, one-level expansion, external-boundary stop, no-new-behavior streak and a file cap. Azevedo should make these configurable budgets and allow high-risk tasks to expand them.

### Example: “Adicionar endpoint para arquivar uma realização”

Using the ECC knowledge, but expressed as an Azevedo exploration workflow:

1. Parse supplied intent without assuming what “archive” means: reversible status, soft delete, permission model and response semantics remain questions unless product artifacts answer them (`intent-driven-development`).
2. Inspect detected backend project and commands; identify Nest bootstrap/modules, validation choice, ORM, tests and relevant package scope (`codebase-onboarding`).
3. Search for the domain term in Portuguese and likely code identifiers; learn the repository’s real entity/service/controller vocabulary (`iterative-retrieval`).
4. Locate the existing “realização” read/update endpoint and trace controller → schema/DTO/guard → service/use case → repository/Drizzle → events/logs → error mapping (`code-explorer`).
5. Locate a comparable state transition such as cancel/deactivate/complete and extract its authorization, idempotency, not-found/conflict behavior, audit/event and test pattern (`spec-miner`).
6. Find the database constraint/state representation and determine whether a schema migration is actually required. Do not infer a migration merely from the verb “archive” (`database-migrations`).
7. Identify consumers and contract implications: frontend list/filter, API schema, event consumers and logs (`contract-first`).
8. Locate unit/integration/E2E tests closest to the boundary; identify the smallest regression/behavioral proof and applicable verification scripts (`tdd-workflow`, `react-testing` only if UI is in scope).
9. Emit cited affected paths, similar-pattern references, test targets, security/data risk signals, acceptance unknowns and the stop reason.
10. Enrich or revise the EngineeringPlan; do not implement during exploration.

The current v0.4 plan has the right placeholder—“exact implementation files require repository exploration”—but not the process or artifact needed to resolve it.

## 5. Implementation knowledge

- Make the smallest change that satisfies the observable acceptance; avoid adjacent cleanup unless it is required for correctness (`agents/planner.md`, `commands/build-fix.md`).
- Preserve existing architecture and conventions before introducing a new abstraction (`commands/plan.md` §Pattern Grounding).
- For public contracts, prove both provider and consumer behavior, not only types (`contract-first`).
- For state/data changes, separate schema transition, backfill and application compatibility; deploy expand-before-contract (`database-migrations`).
- Every tool/action error needs a root-cause hint, safe retry and stop condition (`agent-harness-construction`).
- A future executor should stop when the same failure repeats, a dependency/architecture decision appears, the subject revision changes unexpectedly or an action exceeds its authority (`commands/build-fix.md` §Guardrails; `operator-approval-loop`).

## 6. Testing knowledge

### TDD is evidence, not ritual

ECC’s strongest TDD idea is in `skills/tdd-workflow/SKILL.md` §RED gate: the test must compile/run the intended target and fail because behavior is missing or wrong, not because setup is broken. GREEN must rerun the same target. Azevedo already captures this in evidence/revision semantics.

ECC’s weakest policy is the universal mandate in `rules/common/testing.md`: every change must use RED/GREEN, all three test types and 80% coverage. Azevedo correctly replaced this with task-type and risk decisions. Preserve the RED/GREEN proof; skip the ritual and global threshold.

### Choose tests by observable boundary

- Pure/domain logic: focused unit tests.
- Controller/service/persistence contract: integration test with real validation/error mapping when practical.
- Browser behavior: React Testing Library for user-visible component behavior; real browser for layout/browser APIs; full E2E for critical multi-page flows (`react-testing` §Decision Boundary).
- Bug: add a regression at the layer where the defect escaped (`ai-regression-testing` §Test Where Bugs Were Found).
- Review adequacy: map changed behavior and branches to assertions, not line coverage alone (`agents/pr-test-analyzer.md`).

Unexecuted, skipped and flaky tests are not passing evidence. Coverage is a diagnostic and project-owned threshold, never sufficient proof by itself.

## 7. Debugging knowledge

ECC’s debugging knowledge is scattered across `commands/build-fix.md`, `agents/silent-failure-hunter.md`, `skills/agent-introspection-debugging/SKILL.md` and regression skills:

1. reproduce the observed failure and preserve its exact signal;
2. separate setup/environment failure from product behavior;
3. group symptoms by likely root dependency, then fix prerequisites first;
4. form one falsifiable hypothesis at a time;
5. change minimally and rerun the narrow reproducer;
6. inspect swallowed exceptions, default-empty fallbacks, log-and-forget paths, missing timeouts and transactional rollback;
7. stop after repeated unchanged failure or when resolution requires an architectural/dependency decision;
8. add regression evidence only after the real cause is understood.

The key anti-pattern is a “graceful” fallback that converts failure into plausible empty data. A review/debug lens should ask whether fallback preserves semantics or hides a fault.

## 8. Architecture knowledge

`agents/architect.md`, `agents/code-architect.md`, `skills/contract-first/SKILL.md` and ADR guidance encode four separate jobs:

- describe current boundaries/data flow with citations;
- compare alternatives against explicit functional and non-functional constraints;
- produce a dependency-ordered blueprint only after the decision is made;
- record only durable, costly-to-reverse decisions as ADRs.

Architecture review triggers include public contracts, new packages/apps, persistence strategy, auth, cross-component integration and operational model. File count alone is not architecture impact. A reviewer must include negative consequences and operational/security implications, not just a preferred diagram.

## 9. Security knowledge

### Trigger by trust boundary, not by a generic “security mode”

From `agents/security-reviewer.md`, `skills/security-review/SKILL.md` and `skills/orch-pipeline/SKILL.md`:

- authentication and authorization;
- untrusted input, files, URLs, webhooks and serialization;
- database queries and migrations;
- filesystem/process execution;
- external services and callbacks;
- secrets, credentials, PII and logging;
- dependency or permission changes;
- cryptography, payments and irreversible/external effects.

### Review questions

1. Where does untrusted data enter, and is it parsed/validated before use?
2. Is authorization checked for the resource/action, not only authentication?
3. Can input alter query, path, command, URL or rendered content semantics?
4. Are secrets and sensitive values absent from source, output, logs and client errors?
5. Are retries, rate/size/time limits and abuse paths bounded?
6. Do dependency/permission changes expand authority?
7. Does failure default safe, preserve auditability and avoid partial state?
8. Can existing framework guards invalidate the apparent finding? Review context before reporting.

The examples in ECC must not become universal rules. For example, CSRF controls depend on authentication/transport model, and rate limiting “every endpoint” is not a context-free invariant.

## 10. Review knowledge

### A finding requires a failure story

`agents/code-reviewer.md` §Pre-Report Gate and §HIGH/CRITICAL Require Proof define a strong portable rubric:

- exact file/symbol/line or other stable location;
- triggering input and state;
- observable bad outcome;
- surrounding callers/guards/tests examined;
- explanation of why existing types/validation/framework defaults do not prevent it;
- severity proportional to impact and likelihood;
- confidence high enough to report.

Zero findings is valid. Unchanged code, preferences, generic “add error handling” and theoretical edge cases are excluded unless they connect to the changed behavior or a critical existing exposure.

### Severe findings need an independent check

`workflows/orch-review.workflow.js` and `workflows/README.md` add an orchestration layer:

1. run correctness, stack and conditional security dimensions independently;
2. deduplicate using normalized evidence, not drifting titles;
3. keep the strictest severity and all reporting dimensions;
4. independently try to refute high/critical findings;
5. keep unverifiable severe findings blocking and mark review incomplete when any required dimension fails.

This is more robust than simply calling several reviewers and concatenating their outputs.

## 11. Documentation knowledge

`skills/living-docs-governance/SKILL.md` assigns non-overlapping roles:

- **constitution**: active instructions and policy signposts;
- **map**: stable structure, ownership and where-to-look navigation;
- **status**: current health, blockers and intentional-removal zone;
- **history**: durable decisions, replacements and incidents.

One fact has one canonical owner; other documents link to it. Harness instructions remain short. Maps/status/ADRs are context to verify, not executable instructions. `agents/doc-updater.md` adds that paths, commands, examples and dependency maps must be validated against current code.

## 12. Git and delivery knowledge

The portable pieces of `skills/git-workflow/SKILL.md`, `rules/common/git-workflow.md` and review commands are:

- inspect the full task/branch diff, not only the last commit;
- separate unrelated logical changes;
- preserve test/review evidence when history will be squashed;
- do not publish, push, commit or post reviews without the authority granted by the user/workflow;
- treat Git state as subject identity for evidence and invalidate stale proof after changes.

Branch naming, conventional commits and merge strategy are project/team policy, not global harness invariants.

## 13. Context management and memory knowledge

- Always-loaded instructions must contain only identity, authority, essential invariants and routing (`context-budget`, `docs/CODEX-NAVIGATION-GUIDE.md`).
- Load detailed knowledge by task/stack/path/risk and then its references progressively.
- Compact after a durable phase artifact exists, not at an arbitrary point; do not compact during a coupled edit loop (`strategic-compact`).
- Execution checkpoints record current objective, subject revision, decisions, files, verification, failures, risks and next action.
- Memory is not checkpoint, issue tracker or policy. It is unreviewed context with scope, provenance, freshness uncertainty and links to authoritative artifacts (`unified-memory`).
- A failed approach and its exact failure reason are first-class context; otherwise future sessions waste time retrying it (`commands/save-session.md`).

## 14. Orchestration knowledge

ECC’s actual dependency structure is not “use many agents”. The durable knowledge is:

1. classify operation, ambiguity, blast radius and security/contract minimum;
2. build a dependency graph and identify gates;
3. choose expertise by phase;
4. parallelize only independent lanes and isolate write surfaces;
5. collect every delegated result before the parent completes;
6. carry state through typed artifacts, not hidden conversation;
7. fail closed when a required review/verification lane is missing;
8. keep external/irreversible effects behind payload-bound approval.

Sources: `skills/orch-pipeline/SKILL.md`, `skills/parallel-execution-optimizer/SKILL.md`, `skills/team-agent-orchestration/SKILL.md`, `rules/common/agents.md` §Delegation Completion Contract and `skills/operator-approval-loop/SKILL.md`.

## 15. Stack expertise relevant to Azevedo

### NestJS

`skills/nestjs-patterns/SKILL.md` recommends feature ownership, thin HTTP controllers, injectable business services, domain-speaking persistence providers, coarse guard plus resource-specific authorization, centralized error shape, boot-time config validation and request-level tests using production-equivalent pipes/filters. Azevedo should adapt its `class-validator` examples to the project’s actual Zod integration rather than prescribing both.

### PostgreSQL and migrations

`skills/postgres-patterns/SKILL.md` and `skills/database-migrations/SKILL.md` encode predicate-driven indexes, equality-before-range composites, bounded/cursor reads, lock-aware queues, query evidence, expand-contract rollout, separate backfills, concurrent indexes and production-scale testing. These belong in persistence/migration knowledge packs selected by task signals.

### React/Next.js

`skills/react-patterns/SKILL.md`, `skills/react-testing/SKILL.md` and `skills/react-performance/SKILL.md` cover server/client boundaries, state locality, effect discipline, suspense/errors, accessibility-oriented tests, network-boundary mocks and performance prioritization. These should load separately by task type; a backend task should never pay their context cost.

### Missing upstream depth for the declared reference stack

ECC does not contain dedicated `drizzle-patterns`, `mongoose-patterns`, `mongodb-patterns`, `zod-patterns`, `zustand-patterns` or Azevedo-specific Nest+Zod integration skills in this snapshot. Its migration skill includes a short Drizzle section, while Prisma has a much deeper pack. Therefore ECC is a source, not a complete stack standard. Azevedo will eventually need original, evidence-tested knowledge packs for these gaps instead of translating a Prisma/class-validator worldview.

## 16. Quality and stop criteria worth preserving

- Unknown is preferable to invented certainty.
- A search channel that was unavailable is “not checked”, not “nothing exists”.
- Exploration must disclose its stop reason and deferred scope.
- RED caused by setup failure is not TDD evidence.
- Coverage is not behavioral adequacy.
- Review may correctly return zero findings.
- HIGH/CRITICAL without a concrete scenario and guard analysis is not proven.
- A required failed/missing dimension makes the result incomplete, not approved.
- Memory and documentation are evidence to revalidate, not authorization.
- A background/delegated task is not complete until its result is collected.
- A future runtime must stop when authority, scope, subject revision or safe recovery is unclear.
