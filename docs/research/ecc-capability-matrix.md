# ECC Capability Matrix

## 1. Audit identity and scope

This document records a capability-level analysis of the current ECC upstream. It is a research artifact, not an installation plan and not permission to copy ECC files.

| Field | Value |
|---|---|
| Repository | `affaan-m/ECC` |
| Upstream branch | `main` |
| Commit | `e482e579415fde18357cafce70f177ae19fd7f03` |
| Commit date | `2026-09-24T11:52:47-05:00` |
| Analysis date | `2026-09-26` |
| Declared ECC version | `2.2.2` |
| License | MIT, Copyright (c) 2026 Affaan Mustafa |
| Azevedo baseline | local v0.4 worktree at `67ea93147faa00e58a10f8bbab7371b6f13209c7`, including the uncommitted v0.4 changes already present before this audit |

The upstream snapshot contains 292 `skills/*/SKILL.md` files, 68 top-level `agents/*.md` files, 94 top-level commands, 122 rule files, 3 Codex agent definitions, hook configuration plus executable helpers, install manifests, JSON schemas, a native workflow pilot, session/orchestration code and an alpha control plane. The 84 rows below are **relevant conceptual capabilities**, not a claim that all 292 skills belong in Azevedo Engineering. Closely related files are intentionally grouped when they encode one capability.

### Decision vocabulary

- **ADOPT**: preserve the engineering knowledge with negligible conceptual change; packaging still follows Azevedo contracts.
- **ADAPT**: preserve the useful knowledge but change scope, policy, contract or execution mechanism.
- **ALREADY COVERED**: an equivalent capability exists in v0.1-v0.4; depth is still compared.
- **PARTIALLY COVERED**: the current capability is sound but ECC contains material missing heuristics.
- **DEFER**: useful, but depends on later execution, review, learning, distribution or observability work.
- **SKIP**: deliberately excluded; the reason is explicit.

## 2. Relevant upstream structure

```text
ECC/
├── AGENTS.md                         # broad Claude/plugin operating policy
├── .codex/
│   ├── AGENTS.md                     # Codex-specific instructions
│   └── agents/*.toml                 # explorer, reviewer, docs-researcher
├── agents/*.md                       # 68 specialist role prompts
├── skills/*/SKILL.md                 # 292 procedures and knowledge packs
├── commands/*.md                     # 94 command surfaces/shims
├── rules/                            # shared and stack-specific invariants
├── workflows/orch-review.workflow.js # structured fan-out review pilot
├── hooks/                            # event graph, metadata and profiles
├── scripts/                          # installers, hooks, audits, sessions, evals
├── manifests/                        # modules, components and profiles
├── schemas/                          # install, provenance, memory and state contracts
├── mcp-configs/                      # opt-in/reference MCP configuration
├── contexts/                         # context modes
├── docs/architecture/                # cross-harness and adapter contracts
├── examples/                         # worked integration examples
└── ecc2/                             # alpha control-plane/runtime work
```

The durable knowledge is distributed across these surfaces. `skills/` is important, but it is not the whole “brain”: review confidence rules live in agents, enforcement semantics live in workflows/hooks, ownership lives in install schemas, and portability rules live in architecture docs.

## 3. Capability matrix

| # | ECC capability | Type | ECC path | Knowledge extracted | Azevedo equivalent | Coverage | Decision | Target version | Notes |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Shared core, thin harness edges | architecture | `docs/architecture/cross-harness.md` §Portability Model/Rule For New Work | Durable behavior belongs in shared sources; adapters translate loading, event shapes and platform limits only | Canonical core plus `src/adapters/` | Full concept | ALREADY COVERED | existing | Azevedo already states this more strictly in ADR-0001. |
| 2 | Honest adapter compliance | architecture/checklist | `docs/architecture/harness-adapter-compliance.md` §Compliance States/Scorecard | Distinguish native, adapter-backed, instruction-backed and reference-only; every claim needs install path, verification, risk and owner | Adapter contracts exist, no compliance scorecard | Partial | PARTIALLY COVERED | v0.4.x | Prevents claiming Codex hook parity that does not exist. |
| 3 | Canonical skill source | skill architecture | `docs/architecture/cross-harness.md` §What Travels Unchanged | Author portable procedures once; keep harness assumptions labeled and at the edge | Skill contract only; no content library | Partial | PARTIALLY COVERED | v0.4.x | The missing piece is a canonical knowledge/skill catalog, not hundreds of generated copies. |
| 4 | Commands as compatibility surfaces | command architecture | `AGENTS.md` and `commands/`; `skills/orch-pipeline/SKILL.md` | Commands should route to durable skills/workflows rather than duplicate them | No command shim layer needed yet | Concept applies | ADAPT | v0.6+ | CLI commands should invoke canonical runtime contracts, not repeat prompts. |
| 5 | Rules as layered invariants | rule architecture | `rules/common/`, `rules/typescript/`, `rules/react/`, `rules/web/` | Separate shared invariants from language/framework constraints | Rule schema planned, no rule catalog | Partial | PARTIALLY COVERED | v0.4.x | Select by detected capability/path/risk; reject ECC’s universal mandates. |
| 6 | Install modules | manifest/infrastructure | `manifests/install-modules.json` | Package surfaces into dependency-aware, cost/stability-labeled modules | Stack profiles only | Missing | ADAPT | v0.7 | Useful for distribution after content boundaries stabilize. |
| 7 | Install components | manifest/infrastructure | `manifests/install-components.json` | Expose user-facing components that resolve to modules | Capability/profile metadata | Partial | DEFER | v0.7 | Do not introduce two taxonomies until real installation selection exists. |
| 8 | Install profiles | manifest/infrastructure | `manifests/install-profiles.json` | Compose minimal/core/developer/security profiles | Azevedo profiles describe stack, not rigor | Different purpose | ADAPT | v0.7 | Preserve stack/capability selection; do not reintroduce configurable rigor. |
| 9 | Install state and ownership | schema/infrastructure | `schemas/install-state.schema.json`; installer scripts | Record requested/resolved modules, source revision, every operation, hash, ownership and strategy | Future `.azevedo/state.json`; init is create-only | Partial | PARTIALLY COVERED | v0.7 | Deepens doctor/update/uninstall design. |
| 10 | Conservative project initialization | command/workflow | `commands/project-init.md` §Safety Rules/Planning Flow | Detect first, dry-run, preserve existing guidance, narrow permissions, show exact changes | `inspect` → init plan → preflight → apply | Full and stricter | ALREADY COVERED | existing | Azevedo adds group atomicity, containment and no-force semantics. |
| 11 | Source provenance | schema | `schemas/provenance.schema.json`; skill frontmatter `origin` | Track source, author, time and confidence for imported/learned knowledge | Provenance planned for learning, absent from component schema | Partial | PARTIALLY COVERED | v0.4.x | Add upstream origin/revision/license at knowledge-unit level. |
| 12 | Codex baseline instructions | instruction | `.codex/AGENTS.md` | Keep project guidance small; preserve user config; state unavailable hook parity and external-action limits | Generated short `AGENTS.md` bootstrap | Partial | PARTIALLY COVERED | v0.4.x | Azevedo should derive signposts from selected capabilities, not copy ECC text. |
| 13 | Codex specialist roles | agent/runtime | `.codex/agents/{explorer,reviewer,docs-researcher}.toml` | Read-only sandbox, narrow mission, evidence citations, no invented behavior | Four canonical roles, adapter artifacts planned | Partial | PARTIALLY COVERED | v0.5 | Drop pinned model names; keep read-only authority and typed output. |
| 14 | Progressive navigation guide | instruction/checklist | `docs/CODEX-NAVIGATION-GUIDE.md` §Reading Order/Task Routing | Read root contract, then nearest specific scope; route by task; verify likely commands; delegate only bounded independent work | Architecture describes progressive loading | Partial | PARTIALLY COVERED | v0.4.x/v0.5 | Needs executable selection and context manifests. |
| 15 | PR diff packet | template/checklist | `docs/CODEX-NAVIGATION-GUIDE.md` §PR Diff Packet | Review handoff should include intent, diff map, relevant unchanged code, risk lanes, tests and follow-ups | Plan/evidence contracts lack review packet | Missing | ADAPT | v0.6 | Good typed input for reviewers. |
| 16 | Event-driven hooks | hook | `hooks/README.md` §How Hooks Work/Lifecycle Hooks | Use pre/post/stop/session events for fast feedback, not as the only correctness layer | Hooks explicitly future/optional | Correct boundary | DEFER | v0.8+ | Codex parity is instruction-backed today. |
| 17 | Hook profiles and per-hook controls | hook/config | `hooks/README.md` §Runtime Hook Controls | Profiles, master switch, stable IDs, input caps and scoped disable flags make automation inspectable | No hooks | Missing | DEFER | v0.8+ | Avoid ECC’s “minimal/strict” rigor semantics in core; scope only hook cost/behavior. |
| 18 | Hook metadata fingerprints | hook/schema | `hooks/hooks.metadata.json`; `scripts/ci/validate-hooks.js`; `schemas/hooks-metadata.schema.json` | Sidecar metadata is tied to executable matcher/command fingerprints so reordering cannot silently swap identity | No hooks | Missing | DEFER | v0.8+ | Strong drift-control pattern if hooks are added. |
| 19 | Fail-closed safety hooks | hook | `hooks/README.md` §Runtime Hook Controls; `scripts/hooks/` | Safety-sensitive checks must deny when input is truncated or validation cannot complete; low-risk reminders may fail open | CLI filesystem preflight fails closed | Partial | ADAPT | v0.8+ | Generalize into verifier/enforcer criticality, not hook-specific code. |
| 20 | Session lifecycle capture | hook/workflow | `hooks/README.md` §Lifecycle Hooks; `commands/save-session.md`; `commands/resume-session.md` | Persist objective, evidence, failures, decisions, blockers and exact next step before compaction/end | Plans persist intent; no execution checkpoint | Partial | PARTIALLY COVERED | v0.6 | Execution needs a typed checkpoint distinct from memory. |
| 21 | Unified cross-harness memory | skill/schema/runtime | `skills/unified-memory/SKILL.md`; `schemas/memory.schema.json` | Memory is create-only, scoped, unreviewed, non-authoritative, secret-resistant and recalled as evidence—not instruction | Governed learning principle only | Missing runtime | ADOPT | v0.8 | Adopt the trust boundary; design an independent Azevedo format/runtime. |
| 22 | Instinct-based continuous learning | skill/hook | `skills/continuous-learning-v2/SKILL.md` | Atomic trigger/action/evidence observations, project isolation, confidence change and promotion candidates | Observation→candidate→human promotion policy | Partial | ADAPT | v0.8 | Keep atomic/evidence/scoping; reject auto-application and auto-promotion thresholds. |
| 23 | Context budget audit | skill/checklist | `skills/context-budget/SKILL.md` §Inventory/Classify/Detect Issues | Measure always-loaded agents/rules/MCP schemas; detect overlap and lazy-load rare domains | Progressive context principle only | Missing measurement | ADAPT | v0.4.x | Use actual adapter payload sizes; ECC token constants are estimates. |
| 24 | Strategic compaction | skill/hook | `skills/strategic-compact/SKILL.md` §Compaction Decision Guide/What Survives | Compact at phase boundaries; persist plan first; never compact mid-implementation; preserve failures/decisions | Persistent plan, no checkpoint contract | Partial | PARTIALLY COVERED | v0.6 | The knowledge is portable; hook thresholds are harness-specific. |
| 25 | Iterative retrieval | skill | `skills/iterative-retrieval/SKILL.md` §Dispatch/Evaluate/Refine/Loop | Search broadly, score relevance, name missing context, refine up to a bound and stop at sufficient evidence | Inspection only; no semantic exploration | Missing | ADAPT | v0.5 | Replace arbitrary “3 files” with gap- and risk-based sufficiency. |
| 26 | Codebase onboarding reconnaissance | skill | `skills/codebase-onboarding/SKILL.md` §Reconnaissance/Architecture Mapping/Convention Detection | Scan manifests, entries, structure, config and tests; trace one request; detect conventions; flag unknowns | Deterministic stack/topology discovery | Partial | PARTIALLY COVERED | v0.5 | Azevedo has stronger structural discovery but lacks flow/convention tracing. |
| 27 | Execution-path exploration | agent | `agents/code-explorer.md` §Exploration Process | Find entry points, trace branches/async/data/errors, map layers, conventions and dependencies | Canonical explorer role only | Missing procedure | ADAPT | v0.5 | Output should be a typed ExplorationArtifact with citations. |
| 28 | Bounded specification mining | agent/checklist | `agents/spec-miner.md` §Minimum Project Scan/Sample and Expand/Stop Conditions | Start at public surfaces, trace one level, stop at external boundary/15 files/three no-new-behavior files, record deferred files, derive behavior from enforcement points | No semantic explorer | Missing | ADOPT | v0.5 | Particularly valuable guard against both shallow and unbounded exploration. |
| 29 | Repository search before external search | skill | `skills/search-first/SKILL.md` §Quick Mode/Decision Matrix | Search existing code, then packages/primary docs/OSS; report unavailable channels; adopt, wrap, compose or build by evidence | Research phase exists only as plan step | Missing | ADAPT | v0.5 | External research must be risk/need-triggered, not mandatory for every change. |
| 30 | CodeTour artifacts | skill/template | `skills/code-tour/SKILL.md` §Workflow/Validation/SMIG | Ground reusable walkthroughs in verified paths/anchors and persona-specific narrative | None | Optional | DEFER | v0.9+ | Useful documentation output, not a core Explorer prerequisite. |
| 31 | Intent-to-acceptance refinement | skill | `skills/intent-driven-development/SKILL.md` §How It Works/Operating Rules/Rubric | Inspect facts first; never infer business rules from code; ask only material questions; make acceptance observable with prohibited side effects and verification | Task classification and plan summary | Partial | PARTIALLY COVERED | v0.4.x | EngineeringPlan needs explicit acceptance and source distinction. |
| 32 | Implementation planning | agent/command | `agents/planner.md`; `commands/plan.md` §Pattern Grounding | Restate goals, assumptions and constraints; mirror real naming/error/logging/data/test patterns; order dependencies; define per-step proof | Deterministic EngineeringPlan | Partial | PARTIALLY COVERED | v0.5 | Azevedo intentionally leaves files unknown; exploration should enrich, not guess. |
| 33 | Architecture analysis | agent | `agents/architect.md` §Analysis Process/NFR Checklist | Compare current state and alternatives; assess modularity, scale, operations, security and consequences; emit ADR candidates | Architect trigger/role and ADRs | Partial | PARTIALLY COVERED | v0.6 | Add typed decision proposal only when risk classifier triggers it. |
| 34 | Implementation blueprint | agent | `agents/code-architect.md` | Derive architecture from existing patterns and produce dependency-ordered file/symbol blueprint | Plan steps are generic | Missing | ADAPT | v0.6 | Must consume exploration facts and avoid speculative paths. |
| 35 | Contract-first change design | skill | `skills/contract-first/SKILL.md` §Workflow/Change Protocol/Anti-patterns | Name consumers/owners/jobs, define smallest boundary, derive consumer types, verify provider and prevent duplicate truths | Public-contract risk signal only | Missing | ADAPT | v0.6 | Strong knowledge pack for API/event/schema changes. |
| 36 | Plan decomposition into agent chains | skill | `skills/plan-orchestrate/SKILL.md` §Decompose/Tag/Chain/Self-check | Extract bounded steps, acceptance and scope; map expertise per step; dedupe roles; cap chain length | Recommended agents in classification | Partial | ADAPT | v0.6+ | Preserve dependency/role selection, not Claude slash-command syntax or keyword-only routing. |
| 37 | Right-sized orchestration | workflow | `skills/orch-pipeline/SKILL.md` §Classify size/The phases | Scale phases by files, contract/dependency and ambiguity; security/public contract sets a minimum | Risk-driven workflow | Full concept | ALREADY COVERED | existing | Azevedo’s risk model is more explicit; retain ECC’s ambiguity/blast-radius lens. |
| 38 | Human plan and commit gates | workflow | `skills/orch-pipeline/SKILL.md` §The two gates | Stop after plan and before commit; keep autonomous work between explicit gates | Planning persists; no executor/commit | Partial | ADAPT | v0.6 | Gate policy must depend on authority/risk, not a universal two-gate rule. |
| 39 | Operation-specific first move | skills/workflow | `skills/orch-{add-feature,change-feature,fix-defect,refine-code,build-mvp}/SKILL.md` | Feature researches a slice; behavior change amends tests; defect reproduces; refactor preserves; MVP slices vertically | Task type/TDD decision | Partial | PARTIALLY COVERED | v0.6 | Encode as workflow variants, not five duplicate skills. |
| 40 | Independent parallel lanes | skill | `skills/parallel-execution-optimizer/SKILL.md` §Lane Matrix/Execution Rules | Parallelize only independent read/check/write surfaces; isolate writes; pause dependents on plan-changing blockers; collect all results | No execution orchestration | Missing | DEFER | v0.6+ | Useful after a single-writer executor exists. |
| 41 | Team agent orchestration | skill/workflow | `skills/team-agent-orchestration/SKILL.md` §Operating Model/Kanban/Failure Modes | Explicit owner, dependencies, worktree/branch, status, merge gate and handoff for every lane | None | Missing | DEFER | v0.9+ | Do not make multi-agent a prerequisite for v0.5. |
| 42 | Dynamic task-local harnesses | skill | `skills/dynamic-workflow-mode/SKILL.md` §Decision Tree/Template/Eval Gates | Create a harness only when repetition/complexity repays it; require objective, inputs, outputs, eval, stop and handoff; promote after recurrence | None | Missing | DEFER | v1+ | Valuable later; premature for deterministic core. |
| 43 | Agent action/observation design | skill | `skills/agent-harness-construction/SKILL.md` §Action Space/Observation/Error Recovery | Narrow schema-first tools; deterministic response with status/summary/next actions/artifacts; every error has retry and stop condition | Zod schemas and deterministic CLI | Partial | ADAPT | v0.5-v0.6 | Apply to Explorer/Executor contracts. |
| 44 | Contextual TDD | skill/agent | `skills/tdd-workflow/SKILL.md`; `agents/tdd-guide.md` | Prove RED for intended failure, then same-target GREEN, distinguish compile/runtime red, map plan→test→evidence | TDD decision and RED/GREEN evidence semantics | Full core | ALREADY COVERED | existing | Skip ECC’s mandatory use, universal coverage and checkpoint commits. |
| 45 | Behavioral test-gap review | agent | `agents/pr-test-analyzer.md` §Analysis Process | Map changed functions/modules to tests; prioritize behavior, edge/error/integration paths and meaningful assertions | Verification discovers commands, not test adequacy | Missing | ADAPT | v0.6 | A reviewer dimension, not a generic verifier. |
| 46 | React user-observable testing | skill | `skills/react-testing/SKILL.md` §Core Principle/Query Priority/Async/MSW/Decision Boundary | Test accessible behavior, use real providers/network boundary, fail unhandled requests, choose RTL vs browser by capability | No stack knowledge packs | Missing | ADOPT | v0.6+ | Preserve as a selected React knowledge pack; coverage numbers become project policy. |
| 47 | E2E strategy | skill/agent | `skills/e2e-testing/SKILL.md`; `agents/e2e-runner.md` | Reserve E2E for critical cross-page/browser flows; use stable locators, artifacts and flaky-test diagnosis | Test capability only | Missing | ADAPT | v0.6+ | Select only when browser/user-flow evidence is required. |
| 48 | AI regression patterns | skill | `skills/ai-regression-testing/SKILL.md` §Common AI Regression Patterns/Test Where Bugs Were Found | Turn every confirmed bug into a test at the layer where it escaped; check sandbox/production parity, selected fields, error leakage and optimistic rollback | Bugfix TDD decision | Partial | ADAPT | v0.6 | Useful review/testing expertise, examples are framework-specific. |
| 49 | Incremental build repair | command/agent | `commands/build-fix.md`; `agents/build-error-resolver.md` | Group errors, fix dependency-order/root causes minimally, rerun after each change, stop after repeated failure or architectural/dependency expansion | No executor | Missing | DEFER | v0.6 | Error recovery contract for future executor. |
| 50 | Hypothesis-driven debugging | agent/skill cluster | `agents/silent-failure-hunter.md`; `skills/agent-introspection-debugging/SKILL.md` | Hunt swallowed errors, dangerous fallbacks, lost context, missing timeouts/rollback; narrow by observable failure and disconfirm hypotheses | No debugging capability | Missing | ADAPT | v0.6 | Keep as knowledge/reviewer lenses, not necessarily a standalone agent. |
| 51 | Safe dead-code/refactor cleanup | agent/command | `agents/refactor-cleaner.md`; `commands/refactor-clean.md` | Establish green baseline, classify deletion risk, inspect dynamic/public consumers, make atomic removals, rerun tests and stop on uncertainty | Refactor TDD decision only | Missing | DEFER | v0.7 | Some ECC commands use destructive rollback forms; Azevedo should use recoverable patches. |
| 52 | Verification sequence | skill | `skills/verification-loop/SKILL.md` §Verification Phases | Build/type/lint/test/security/diff is a useful ordered checklist; failures remain visible | Scope-aware verification plan/evidence | Core covered, depth differs | PARTIALLY COVERED | v0.6 | Azevedo correctly avoids fixed commands and universal 80%; add diff/security composition. |
| 53 | Definition of Done gate | checklist/workflow | `skills/verification-loop/SKILL.md`; `skills/delivery-gate/SKILL.md` | Completion needs machine checks plus honest skipped/incomplete state, not a narrative claim | Typed DoD with evidence, waiver and subject revision | Full and stronger | ALREADY COVERED | existing | ECC delivery-gate’s “touch learning files” is not correctness evidence. |
| 54 | Evidence-first code review | agent | `agents/code-reviewer.md` §Confidence Filtering/Pre-Report Gate/HIGH-CRITICAL Proof | Cite exact location, concrete trigger/state/outcome, surrounding guards and defensible severity; accept zero findings | Finding schema principles in architecture | Partial | ADOPT | v0.6 | This is core review knowledge worth preserving almost unchanged. |
| 55 | Clean review is valid | agent/invariant | `agents/code-reviewer.md` §It Is Acceptable And Expected To Return Zero Findings | Never manufacture nits; style preferences are not defects without project evidence | Architecture explicitly says zero findings valid | Full | ALREADY COVERED | existing | Retain as a reviewer invariant and eval case. |
| 56 | Parallel review, dedupe and adversarial verify | native workflow | `workflows/orch-review.workflow.js`; `workflows/README.md` | Fan out independent dimensions, dedupe by evidence before verification, keep strictest severity, independently verify high/critical, fail closed on missing dimension/verifier | No review runtime | Missing | ADAPT | v0.6 | One of ECC’s strongest mechanisms; translate to typed findings and subject revision. |
| 57 | Security trigger routing | rule/agent | `skills/orch-pipeline/SKILL.md` §Security-review trigger; `agents/security-reviewer.md` §When to Run | Trigger on authz/authn, inputs, DB, filesystem, external calls, crypto, secrets, sensitive data and dependencies | Risk signals/securityReviewRequired | Partial | PARTIALLY COVERED | v0.4.x | Current classifier misses uploads, URLs/webhooks, serialization, logging and dependency permissions unless supplied. |
| 58 | Security threat checklist | skill | `skills/security-review/SKILL.md` §Security Checklist | Review secrets, validation, injection, authorization, XSS/CSRF, abuse controls, data exposure and dependencies with concrete verification | Security reviewer role only | Missing knowledge | ADAPT | v0.6 | Split generic trust-boundary rules from framework examples and remove universal claims. |
| 59 | Dedicated security reviewer | agent | `agents/security-reviewer.md` §Review Workflow/OWASP/False Positives | Scan high-risk paths, validate context to avoid false positives, apply defense-in-depth/least privilege/fail-secure | Canonical role/trigger | Partial | PARTIALLY COVERED | v0.6 | Output must use the common Finding schema and evidence threshold. |
| 60 | Agent/harness security scanner | command/external tool | `commands/security-scan.md`; `skills/security-scan/SKILL.md` | Separate active runtime findings from docs/templates; report confidence; rerun after fixes | None | External dependency | DEFER | v0.8+ | AgentShield is optional upstream tooling, not an Azevedo core dependency. |
| 61 | Destructive-operation guard modes | skill/hook | `skills/safety-guard/SKILL.md` | Careful/freeze modes make protected paths and forbidden effects explicit; unlock is deliberate | Filesystem safety in init/plan | Partial | ADAPT | v0.6 | Prefer action effect classes and approvals over ad hoc lock files. |
| 62 | Operator approval objects | skill | `skills/operator-approval-loop/SKILL.md` §Approval Object/Baseline Gate | Draft external effects, bind approval to exact payload/baseline, time-box it and revalidate before delivery | Human gates only conceptually | Missing | DEFER | v0.9+ | Relevant when Azevedo performs remote or production effects. |
| 63 | Database review lens | agent | `agents/database-reviewer.md` | Check query shape, indexes, constraints, least privilege, concurrency, short transactions and explain plans | Persistence risk signal | Missing knowledge | ADAPT | v0.6+ | Can be a persistence knowledge pack plus reviewer dimension, not always an agent. |
| 64 | Migration safety | skill | `skills/database-migrations/SKILL.md` §Core Principles/Safety Checklist/Zero-Downtime | Immutable deployed migrations, separate DDL/data, production-size testing, expand-contract, concurrent indexes, batches and rollback/forward recovery | Migration risk only | Missing knowledge | ADAPT | v0.6 | Especially relevant to Drizzle/Postgres reference stack. |
| 65 | PostgreSQL query/schema heuristics | skill | `skills/postgres-patterns/SKILL.md` §Index/Data Type/Common Patterns | Match index to predicates, equality before range, bounded/cursor queries, locking/queue and operational timeouts | Stack profile detects Postgres | Missing knowledge | ADAPT | v0.6+ | Treat type/index choices as contextual, not universal defaults. |
| 66 | Prisma safety knowledge | skill | `skills/prisma-patterns/SKILL.md` §Transactions/N+1/Anti-Patterns | Avoid N+1, know transaction timeouts, shared-env reset risks, multi-step breaking changes and unbounded delete | Fixture proves non-Drizzle compatibility | Missing knowledge | DEFER | v0.7 | Useful for non-reference projects; lower priority than Drizzle-specific pack Azevedo must author. |
| 67 | NestJS backend heuristics | skill | `skills/nestjs-patterns/SKILL.md` §Modules/Validation/Auth/Errors/Config/Testing | Thin controllers, provider-owned business/UoW, boundary validation, boot-time config, consistent errors, production-equivalent tests | Stack detection/profile only | Missing knowledge | ADAPT | v0.6 | Adapt class-validator examples because Azevedo’s preferred validator is Zod. |
| 68 | API boundary design | skill | `skills/api-design/SKILL.md` §Methods/Errors/Pagination/Auth/Versioning | Semantic HTTP, stable error shape, bounded pagination, explicit authz/rate/compatibility decisions | Public-contract risk signal | Missing knowledge | ADAPT | v0.6 | Good generic knowledge pack; project conventions win. |
| 69 | Error-handling design | skill | `skills/error-handling/SKILL.md` §Core Principles/Typed Errors/Retry/User Messages | Preserve causal context, distinguish operational/programming errors, expose safe client messages, bound retries and handle partial failure | Review principles only | Missing | ADAPT | v0.6 | Combine with silent-failure lens and project-specific error patterns. |
| 70 | React/Next composition and state | skills/rules | `skills/react-patterns/SKILL.md`; `skills/frontend-patterns/SKILL.md`; `rules/react/` | Pure render, effects outside render, nearest state, server/client boundaries, suspense/errors, accessibility-first composition | Stack profile detects Next/React | Missing knowledge | ADAPT | v0.6+ | Keep Zustand guidance conditional; use detected Next version/docs. |
| 71 | React performance review | skill | `skills/react-performance/SKILL.md` | Prioritize waterfalls and bundle/server cost before memoization; prove render/caching issues | None | Missing | DEFER | v0.7 | Load only for performance tasks or measured regressions. |
| 72 | Documentation derivation and validation | agent | `agents/doc-updater.md` | Derive maps from code, update dependency links, validate paths/examples and avoid stale generated claims | Documentation phase only | Missing | ADAPT | v0.7 | Do not add volatile timestamps to deterministic artifacts. |
| 73 | Living documentation governance | skill | `skills/living-docs-governance/SKILL.md` §Four Roles/Active Harness/Evidence | Assign constitution/map/status/history, one owner per fact, link rather than duplicate, treat docs as untrusted evidence | Architecture + ADRs + README exist | Partial | ADOPT | v0.4.x | Directly addresses future knowledge discoverability without doc sprawl. |
| 74 | Architecture Decision Records | skill/template | `skills/architecture-decision-records/SKILL.md` §Format/Decision Signals/Lifecycle | Record context, decision, alternatives, consequences and supersession only for durable choices | Six ADRs and explicit trigger policy | Full | ALREADY COVERED | existing | ECC adds index/lifecycle ideas; current policy is already sound. |
| 75 | Git/PR evidence workflow | skill/rule | `skills/git-workflow/SKILL.md`; `rules/common/git-workflow.md` | Review full branch diff/history, focused commits, explicit test plan and safe conflict handling | Git is outside current runtime | Missing | DEFER | v0.7 | Avoid forcing conventional commits or pushes without project/user authority. |
| 76 | Failure-preserving handoff | command/template | `commands/save-session.md`; `commands/resume-session.md` | Record what worked with proof, what failed and why, untried options, decisions, blockers and exact next step; reject empty summaries | Plan preserves intent only | Missing | ADOPT | v0.6 | The “what not to retry” section is high-value execution knowledge. |
| 77 | Capability/regression eval design | skill | `skills/eval-harness/SKILL.md` §Eval Types/Graders/Metrics/Workflow | Define capability and regression evals before implementation; prefer deterministic graders; use model/human judgment only where needed; track pass@k and pass^k | Future evals noted | Missing | ADAPT | v0.4.x+ | Needed to validate knowledge selectors and future agent behavior. |
| 78 | Isolated agent comparison | skill/infrastructure | `skills/agent-eval/SKILL.md` §Worktree Isolation/Metrics/Judges | Run the same task in isolated worktrees, compare deterministic outcomes/cost and separate grader types | None | Missing | DEFER | v0.9+ | Useful only after executable agents exist. |
| 79 | Evidence-based self-evaluation | skill/checklist | `skills/agent-self-evaluation/SKILL.md` §Axes/Evidence Rule/Anti-patterns | Score accuracy/completeness/clarity/actionability/conciseness independently; cite gaps; fix cheap omissions; avoid self-congratulation | DoD checks objective evidence, not prose quality | Complementary | ADAPT | v0.7 | Use as an advisory report, never proof of correctness. |
| 80 | Harness optimization by eval | agent | `agents/harness-optimizer.md` | Snapshot config, make minimal reversible allowlisted changes, run regression evals, roll back on failure, gate safety changes | No runtime optimization | Missing | DEFER | v1+ | Strong future maintenance loop after stable eval suites exist. |
| 81 | State store and tamper-evident run journal | schema/infrastructure | `schemas/state-store.schema.json`; `schemas/capsule-envelope.schema.json` | Track sessions, skill runs, versions, decisions and governance; journal effects with lineage, sequence and hash chain; exclude secrets/raw reasoning | Plans/evidence contracts only | Missing | DEFER | v0.8+ | Consider effect classes and append-only evidence without inheriting ECC2 complexity. |
| 82 | Broad domain/operator/media skill catalog | skill catalog | `skills/` modules such as marketing, healthcare, network, video, prediction markets and operator desks | Domain playbooks can be useful products, but do not improve the core software-engineering harness for the declared stack | None by design | Out of scope | SKIP | none | Keep upstream discoverable; never bundle by default. |
| 83 | Unsupported language/framework packs | skill/rule catalog | `skills/{django,go,rust,java,kotlin,laravel,...}-*`; matching rules/agents | Deep stack-specific expertise exists, but Azevedo currently targets TypeScript/Nest/Next/Postgres/Mongo | None by design | Out of scope now | SKIP | revisit on demand | Add only after a real supported-project need, not for catalog parity. |
| 84 | Universal mandates and runtime-specific coupling | rule/agent/command cluster | `AGENTS.md`; `rules/common/{testing,security,coding-style,agents,performance}.md`; model fields in agents; Claude-only hooks/commands | ECC often mandates 80% coverage, all test types, immutable style, fixed size limits, mandatory agents, model tiers and Claude semantics globally | Azevedo deliberately uses contextual risk and project evidence | Conflict | SKIP | none | Preserve underlying concerns as selectable knowledge; reject universal thresholds, fixed models and fake cross-harness parity. |

### Classification totals

| Decision | Count |
|---|---:|
| ADOPT | 6 |
| ADAPT | 32 |
| ALREADY COVERED | 7 |
| PARTIALLY COVERED | 18 |
| DEFER | 18 |
| SKIP | 3 |
| **Total** | **84** |

## 4. Mechanism versus knowledge

The matrix deliberately classifies knowledge separately from ECC’s implementation surface:

| ECC mechanism | Portable knowledge | Azevedo destination |
|---|---|---|
| Claude `Agent` prompt | Role, authority, input expectations, analysis heuristics and output contract | Canonical role plus selected knowledge pack; adapter decides whether it is a subagent |
| Slash command | Trigger, workflow entry point and handoff | CLI/runtime operation that references a workflow ID |
| `SKILL.md` | Procedure, criteria, stop conditions, examples and domain heuristics | Versioned canonical knowledge unit; adapter materialization only when useful |
| Rule Markdown | Invariant, selector, rationale and exception | Typed rule selected by capability/path/risk |
| Hook | Event trigger, fast feedback and enforcement criticality | Optional adapter acceleration; deterministic verifier/enforcer remains canonical |
| Native workflow | Dependency graph, parallelism, barriers, dedupe and failure semantics | Harness-neutral workflow state machine plus an optional native adapter |
| MCP | Tool schema and external capability | Opt-in adapter declared with authority/cost/trust boundary |
| Filesystem convention | Persistence, ownership and resumption contract | `.azevedo/` typed artifacts with schema/version/subject revision |

The same heuristic must have one canonical owner. A role references knowledge; it does not repeat it. A workflow references roles, knowledge and verifiers by ID. An adapter translates only loading and execution.

## 5. Conceptual dependency graph

```text
project files + task + user constraints
                │
                ▼
      deterministic inspection
                │
                ▼
  intent/acceptance + risk classification
                │
                ▼
  exploration ──────────────── primary docs / search-first
  │  entry points, flows, conventions, similar code, tests
  │  dependencies, affected paths, unknowns, evidence, stop reason
  ▼
enriched EngineeringPlan
  │
  ├──────── architecture/contract/security/migration knowledge (conditional)
  ▼
implementation workflow (future)
  │
  ├──────── contextual TDD / build recovery / checkpoints
  ▼
behavioral tests + deterministic verification
  │
  ▼
parallel review dimensions
  │  correctness · test adequacy · stack · security (conditional)
  ▼
dedupe findings → adversarial verify blockers → disposition
  │
  ▼
DoD bound to current subject revision
  │
  ├──────── docs/ADR when required
  └──────── quarantined learning candidate + human promotion
```

Cross-cutting concerns are context budgeting, provenance, authority/effect class, session checkpoints, source traceability and adapter capability reporting. Multi-agent execution is one optional runtime strategy inside this graph, not the architecture itself.

## 6. Important capability details

### 6.1 Exploration is a convergence process

ECC does not encode exploration in one place. The useful composite is:

1. `codebase-onboarding` performs cheap reconnaissance over manifests, entry points, structure, tooling and tests.
2. `code-explorer` traces a real execution path, including branches, async/data/error flow and layer boundaries.
3. `spec-miner` supplies a bounded “sample and expand” algorithm and concrete stop conditions.
4. `iterative-retrieval` makes missing context explicit and refines the next search instead of loading the repository.
5. `search-first` checks repository patterns before external packages/docs and reports unavailable research channels honestly.
6. `intent-driven-development` prevents code from being mistaken for product truth and converts supplied intent into observable acceptance.

The Azevedo target should therefore not be “an explorer prompt”. It should be a harness-neutral exploration workflow that produces evidence, unknowns, affected scope, local patterns, tests, risk signals and a stop reason. A Codex read-only subagent can execute that workflow, but the artifact and policy must not depend on subagents.

### 6.2 Review has two distinct loops

`agents/code-reviewer.md` contains reviewer judgment: confidence filtering, exact failure scenarios, contextual guard checks and defensible severity. `workflows/orch-review.workflow.js` contains orchestration: parallel dimensions, evidence-based dedupe, independent verification of severe findings and fail-closed incomplete status. These should remain distinct in Azevedo:

- a **Finding contract** owns the evidence and lifecycle;
- **review knowledge packs** own lenses and false-positive guidance;
- a **review workflow** owns dimensions, dedupe, verification and gates;
- an adapter decides whether dimensions run as subagents, inline passes or external tools.

### 6.3 Knowledge selection is a missing first-class layer

ECC proves that detailed stack knowledge is valuable, but its 292-skill scale also proves that loading/catalog parity is the wrong goal. Azevedo needs a compact registry that can answer:

- Which knowledge unit applies to this task, detected stack, path and risk?
- Is it a rule, procedure, reviewer lens, reference or example?
- What does it depend on and conflict with?
- What is its provenance and license?
- Which adapter surfaces can load it and at what context cost?
- Which evals prove its activation and output quality?

This registry should precede automatic exploration/execution so future agents do not hard-code expertise in prompts.

## 7. License and provenance

ECC’s repository-level `LICENSE` is the MIT License and names Affaan Mustafa as the 2026 copyright holder. The license permits use, copying, modification, distribution, sublicensing and sale subject to retaining the copyright and permission notice in substantial copies or portions. This audit only synthesizes concepts and cites source paths; it does not copy ECC files into Azevedo Engineering.

If Azevedo later reuses an ECC skill, agent, script, workflow, template or substantial textual/code portion directly, that artifact must carry appropriate MIT attribution/notice and its upstream commit should be recorded. A rewritten implementation based on general ideas is still tracked for provenance here, but this document does not make claims beyond the repository license or provide legal advice. Community-origin skills and files with their own metadata require file-level provenance review rather than assuming the repository-level notice is the only relevant source.

## 8. Method limitations

- Counts describe the audited commit and can change upstream.
- “Relevant” is defined against Azevedo’s stated software-engineering harness and TypeScript/Nest/Next/Postgres/Mongo direction; it is not a quality judgment on excluded domains.
- Examples in ECC sometimes encode preferences as universals or reflect Claude-specific APIs. Each future adoption needs a primary-doc/version check and an eval.
- No ECC code or content is a runtime dependency of Azevedo Engineering as a result of this audit.
