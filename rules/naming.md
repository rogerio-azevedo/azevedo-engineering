---
id: naming
summary: Technical identifiers are written in English. User-facing content may use the product language.
---

# Rule: naming

## Requirements

1. Every technical identifier introduced or renamed by a change is written in English. Technical identifiers are:
   - file and directory names;
   - code identifiers: types, classes, interfaces, functions, methods, variables, constants, enum members and exported names;
   - API routes: REST paths and GraphQL type, field, query, mutation and argument names;
   - page routes and URL path segments;
   - database identifiers: tables, collections, columns, enums, indexes and constraints.
2. When the project already uses an English term for a concept, the change uses that same term instead of introducing a synonym.
3. User-facing content is not a technical identifier and may stay in the product language: UI copy, messages, e-mail and notification text, templates and seed content.
4. An exception exists only when it is declared explicitly in the project's Azevedo configuration. A missing translation, a domain term or an existing legacy name is not an implicit exception.
5. Adding or changing an exception is a human decision. An agent may propose one, but never adds it without explicit user approval.

## Scope

The rule applies to names introduced or renamed by the change. Existing names that the change does not touch are not violations.

## Enforcement

| Requirement | Enforced by |
| --- | --- |
| 1, 2, 4 | check `naming.english` (planned) |
| 5 | check `naming.english` reports any exception change in the change set (planned) |
