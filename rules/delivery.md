---
id: delivery
summary: Product intent comes from the user, project conventions prevail, existing solutions are reused, scope and tests are explicit, verification is real and non-mutating, and done requires evidence.
---

# Rule: delivery

## Requirements

### Intent

1. Acceptance criteria come from the user or from a product artifact the user supplied. They are never inferred from existing code or from an analogous feature.
2. A product question that changes behavior, data, security or scope is answered by the user before the affected behavior is implemented.

### Conventions and reuse

3. The project's own conventions take precedence over generic practice. These are its instructions, project skills and established patterns.
4. A conflict between a project convention and an Azevedo rule is resolved by explicit project configuration, not by the agent.
5. Before creating a utility, component, service, storage mechanism or dependency, the change looks for an existing equivalent in the project. When one exists, the change reuses it, or moves it to a shared location, instead of duplicating it.

### Scope

6. The task file declares the intended scope. A changed path outside that scope has a recorded reason in the task file.
7. Tools that rewrite files in bulk, such as formatters and fixers, are not applied outside the declared scope.

### Tests

8. A change in behavior is covered by an automated test at the layer that proves it. Otherwise, the task file records why it is not covered, for example because the project has no test capability for that layer.

### Verification

9. Verification uses the project's own scripts and tools.
10. A verification command does not modify files. Fix or write modes are not verification.
11. A failure that existed before the change and lies outside its scope is reported. It is neither hidden nor fixed through unrelated edits.

### Done

12. A change is done only when:
    - every applicable verification passes on the current state of the change;
    - every acceptance criterion has evidence, or is explicitly reported as unverified with the reason;
    - no open product question remains.
    When `azevedo check` is available, it is the authority for the objective part of this condition.
13. The final report states what was not verified. Code that exists is not evidence that a criterion is satisfied.

### Destructive operations

14. Destructive or irreversible commands run only with explicit user authorization for that specific command. Examples: rewriting history, resetting, cleaning or restoring files, force-pushing, dropping or resetting a database.

## Enforcement

| Requirement | Enforced by |
| --- | --- |
| 1, 2 | check `acceptance`: no open questions (planned); review |
| 3, 4, 5 | review |
| 6, 7 | check `scope` (planned) |
| 8 | check `tests.required` (planned); review |
| 9, 10, 11 | check `commands` with mutation detection and delta mode (planned) |
| 12, 13 | check `acceptance` and the aggregate `azevedo check` result (planned); review |
| 14 | guidance; harness hook (planned) |
