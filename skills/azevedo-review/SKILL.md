---
name: azevedo-review
description: Read-only, evidence-based review of a change against its acceptance criteria and the Azevedo rules. Use after implementing a change, or when the user asks for a review. Defines the finding format and the challenge step that azevedo-security-review reuses.
---

# Azevedo Review

Review the change. Do not edit files. Do not run commands that modify the working tree.

## Inputs

- The full change against the base branch, including untracked files.
- The local task file, with its acceptance criteria, scope, scope expansions and test justifications. If it is missing, say so and review against what the user stated.
- The project's agent instructions and project skills.
- Rules: `delivery`, `data`. Security belongs to `azevedo-security-review`.

## 1. Acceptance

For each acceptance criterion, classify it as `satisfied`, `partially-satisfied`, `contradicted` or `not-verifiable`. Cite the code and the test or evidence for each classification. Also check the effects the criterion forbids. Code that exists is not proof that a criterion is satisfied.

## 2. Change

Examine the changed behavior through these lenses. Report only what applies.

- **Correctness and regression.** Does the changed behavior break existing callers or states?
- **Bounded collections** (`data`). Can any changed query, endpoint or screen return or render an unbounded collection, including nested ones?
- **Partial failure.** When an operation has several side effects (writes, files, notifications, external calls), what state remains when one step fails midway? Does a retry duplicate effects? Does the client tell a failed operation apart from a failed refresh after a successful one?
- **Concurrent invariants** (`data`). Is every invariant that must survive concurrent writes backed by a database constraint?
- **Migrations** (`data`). Does the change edit a shared migration, or introduce a destructive or narrowing change without recorded approval?
- **Tests** (`delivery`). Does each behavior change have a test that would fail without it, or a recorded justification?
- **Conventions and reuse** (`delivery`). Does the change follow the project's conventions and its analogous implementation? Does it duplicate an existing utility, component or service?

Do not report style preferences unless they violate an explicit rule or project convention.

## 3. Finding format

Every candidate finding states:

- `severity`: `critical`, `high`, `medium` or `low`;
- `location`: file and line range;
- `trigger`: the input or state that causes the failure;
- `outcome`: the observable result;
- `guards examined`: the callers, guards, types, constraints, framework behavior and tests you inspected;
- `why they do not prevent it`;
- `criterion or rule`: the related acceptance criterion or rule requirement;
- `verification`: how to confirm the fix.

A `critical` or `high` finding requires a reachable scenario and an explicit argument that the existing protections do not stop it.

## 4. Challenge

Before reporting, try to refute each candidate. Look for the guard, constraint, caller restriction or test that would prevent the failure. Classify the result:

- `confirmed`: the failure is reachable and nothing prevents it;
- `refuted`: you found the protection; cite it as counterevidence;
- `insufficient-evidence`: you cannot decide from the available code; state what is missing.

Consolidate candidates that share a root cause into one finding.

## Output

```markdown
## Acceptance
| id | status | evidence |

## Findings
<confirmed findings, in the format above, ordered by severity>

## Refuted
<candidate, counterevidence>

## Insufficient evidence
<candidate, what is missing>

## Not examined
<lenses or areas not reviewed, and why>
```

Zero findings is a valid result. A `confirmed` `critical` or `high` finding blocks delivery until it is fixed or the user accepts it explicitly.
