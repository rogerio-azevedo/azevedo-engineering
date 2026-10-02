---
id: security
summary: Handlers are deny-by-default, client-supplied tenant and resource identifiers are untrusted, stored files and private data are protected, secrets stay out of the change.
---

# Rule: security

## Requirements

### Handlers are deny-by-default

1. Every handler that exposes an operation requires authentication and authorization. This includes HTTP routes, GraphQL operations, server actions, webhooks and file upload or download endpoints.
2. A handler is public only when the project's convention or configuration declares it public explicitly. A handler without authentication or authorization that is not declared public is a defect, never an implicit public endpoint.
3. Authentication and authorization fail closed. Missing credentials, missing identity, missing context or an evaluation error deny the operation.
4. An authorization decision is never taken before the identity it depends on has been established.

### Tenant and resource identifiers are untrusted

5. Every tenant or resource identifier received from the client is untrusted input, wherever it comes from: path, query, body, headers, cookies or a selection kept in the session.
6. Before the operation runs, the server's trusted identity and context must prove that the caller is authorized for the requested action on that specific tenant and resource.
7. Permissions granted in one tenant never authorize an action in another tenant.
8. The tenant and resource that were authorized are the same ones the operation acts on.

### Stored files

9. The server decides where a file is stored and who owns it. Client-supplied storage location, path, owner or tenant values are untrusted input and are validated under requirements 5 to 8.
10. Files that can contain personal or sensitive data are private by default. They are served only through an authenticated and authorized operation. A publicly reachable URL requires an explicit product decision.

### Private and personal data

11. Personal and sensitive data is returned only to callers authorized for that specific data, and only the fields the operation needs.
12. Data that the specification marks as private to a role is not included in listings, shared view models or exports available to other roles.

### Secrets

13. Secret values are never committed, logged, returned in errors or written to reports. Secret files are not added to version control.
14. The contents of secret files (for example `.env` files and private keys) are not read unless the user asks for it explicitly.

## Enforcement

| Requirement | Enforced by |
| --- | --- |
| 1, 2 | check `route.auth`, against the convention declared by the project (planned); security review |
| 3, 4 | security review |
| 5 to 8 | security review |
| 9, 10 | security review |
| 11, 12 | security review |
| 13 | check `secrets` (planned) |
| 14 | guidance |
