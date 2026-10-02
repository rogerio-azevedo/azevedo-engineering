---
id: data
summary: Collections are bounded, concurrent invariants live in database constraints, applied migrations are immutable and destructive schema changes need approval.
---

# Rule: data

## Requirements

### Bounded collections

1. An operation that returns a collection that can grow with usage is bounded on the server, through pagination or an explicit limit. Nested collections are bounded too.
2. The client does not request or render an unbounded collection.

### Invariants

3. An invariant that must hold under concurrent writes, such as uniqueness or "at most one per parent", is enforced by a database constraint. An application-level check may complement the constraint, but does not replace it.
4. When the ORM cannot express the constraint, the migration declares it.

### Migrations

5. A migration that has been committed to a shared branch is never edited. Changes go into a new migration.
6. A destructive or narrowing schema change requires explicit user approval before it is written. Destructive or narrowing changes are: dropping or renaming a table or column, narrowing a type, or making a populated column required without a default or backfill.

## Enforcement

| Requirement | Enforced by |
| --- | --- |
| 1, 2 | review |
| 3, 4 | review |
| 5, 6 | review; check `migrations.safety` (planned) |
