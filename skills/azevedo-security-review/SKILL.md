---
name: azevedo-security-review
description: Read-only security review of a change that touches handlers, authentication, authorization, tenant or resource access, file storage, private data or secrets. Use after implementing such a change, or when the user asks for a security review. Applies the security rule and reuses the azevedo-review finding format.
---

# Azevedo Security Review

Review the change for security. Do not edit files. Do not run commands that modify the working tree.

The `security` rule states what must be true. Use the finding format, the challenge step and the output structure of `azevedo-review`.

## Inputs

- The full change against the base branch, including untracked files.
- The local task file, and the project's agent instructions and project skills.
- The project's declared convention for public handlers, if there is one.

## 1. Handlers

List every handler the change adds or modifies, including file endpoints, webhooks and server actions. For each one:

- Is it declared public by the project's convention or configuration? If not, are authentication and authorization present?
- Follow the path with missing or invalid credentials. Does every guard deny, or does one return success when the credential, identity or context is absent?
- Does authorization run only after authentication has established the identity? Check the order of middleware, guards and decorators.
- Is there a test, or at least a traceable path, for both an unauthenticated caller and an authenticated caller without permission?

## 2. Tenant and resource authorization

List every tenant or resource identifier the change consumes, and where each comes from: path, query, body, header, cookie or a selection kept in the session. For each one:

- Where does the server's trusted identity prove authorization over that specific tenant or resource, for that action, before the operation runs?
- Can permissions from one tenant be combined with, or applied to, another tenant?
- Is the tenant that was authorized the same one the operation acts on? Check both the server and any client-side permission display.
- For nested resources: is the resource proven to belong to the authorized tenant?

## 3. Stored files

- Who decides the storage location, key and owner? Can the client influence any of them?
- Are files that can contain personal or sensitive data private? How are they served: an authorized operation, or a public URL?
- Do alternative storage modes (local, development, fallback) expose files publicly?

## 4. Private and personal data

- Which fields does each changed operation return, and to whom?
- Does data that the specification marks as private to a role reach listings, shared view models or exports available to other roles?

## 5. Secrets

- Does the change add secret values, secret files, or logs and errors that include secrets?

## Severity

Unauthenticated access to a protected operation or protected data, cross-tenant access and exposure of private files are at least `high` when confirmed.

## Coverage

In the `Not examined` section, list each lens above that was not applicable and why. A lens left out is not evidence of safety.
