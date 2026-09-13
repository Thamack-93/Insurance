# Client portal design (deferred runtime)

This document defines the external client experience without adding portal routes,
identities, invitations, or migrations.

## Access model

External users are separate from employee `User` records and organization
memberships. An invitation creates a revocable external identity scoped to one
client. Sessions are short-lived, revocable, and never select an employee
organization context.

An agent or administrator explicitly shares individual documents or creates a
document request. The portal has no implicit access to a client's full folder.
Every view, download, upload, invitation, and revocation is audited.

## First portal surface

- Shared documents with expiring authorized downloads.
- Outstanding document requests with upload status and review state.
- Agent-approved claim progress summaries.
- Invitation acceptance, session revocation, and sign-out.

Internal notes, commissions, Nora, payment mutation, quotes, and employee
dashboard routes are excluded. Uploaded files enter review and are not visible
until explicitly accepted.

## Future API contract

`GET /portal/session`, `GET /portal/documents`, `GET /portal/claims`,
`POST /portal/document-requests/:id/upload`, and `POST /portal/session/revoke`
are illustrative contracts only. Each endpoint must derive client scope from
the external session and explicit grant, never from a client-supplied ID.
