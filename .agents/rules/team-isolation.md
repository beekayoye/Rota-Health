# Team Isolation, Roles, and Permission Rules

These rules govern multi-tenant isolation, role-based access control, subscription state gating, and request validation across all backend services.

## 1. Team Isolation (PRD 6.2, 15.5)
- Every query touching a team-owned database table must filter by `teamId` using the Prisma client extension.
- The Prisma client extension must throw an exception if `teamId` is missing from any team-scoped query.
- When an authenticated user requests a resource belonging to a clinic they do not belong to, the server must return 404 `NOT_FOUND`, never 403 `FORBIDDEN`. This prevents clinic resource ID enumeration across tenants.
- Shift overlap validation must run only within the scope of a single clinic. Never perform cross-clinic shift overlap queries on the server to prevent schedule data leakage between clinics (PRD 6.3).

## 2. Server-Enforced Permissions (PRD 6.2, 7)
- All authorization decisions must be enforced on the server. The mobile client hides UI buttons strictly for usability.
- Every team route (`/v1/teams/:teamId/...`) must execute this exact middleware sequence:
  `requestId` -> `authenticate` -> `resolveTeam` -> `requireMembership` -> `requireRole` -> `requireSubscriptionState` -> `validate(zodSchema)` -> handler.
- The user's role must be loaded fresh from the database or verified membership record per request. Never trust or embed roles inside JWT access tokens (PRD 6.2, 15.1).
- The clinic Owner cannot be demoted or removed. Any attempt to demote or delete the Owner must return 409 `OWNER_IMMUTABLE` (PRD 6.2).
- Removing a member with future assigned shifts must be blocked with 409 `MEMBER_HAS_FUTURE_SHIFTS` (PRD 6.2).
- When a member is removed, their open swaps must transition to `CANCELLED` (PRD 6.2, 6.4).

## 3. Subscription State Gating (PRD 6.5, 7)
Every team-scoped endpoint must be evaluated against the clinic's subscription state via `requireSubscriptionState`:
- `INCOMPLETE` (clinic created but initial checkout unpaid):
  - Allowed: clinic settings (`PATCH /teams/:teamId`), drafting shifts (`POST /teams/:teamId/shifts`), and billing routes.
  - Blocked: member invites, shift publishing, and all swap actions must return 402 `PAYMENT_REQUIRED`.
- `ACTIVE` and `PAST_DUE`:
  - All routes allowed.
- `RESTRICTED` (grace period expired):
  - Allowed: all read endpoints and billing routes.
  - Blocked: all team-scoped writes return 402 `SUBSCRIPTION_RESTRICTED`.
- User-scoped endpoints (`/me/...`, `/auth/...`) must never be blocked by a clinic's subscription state.

## 4. Request Validation (PRD 10)
- Every request body, query parameter, and route parameter must be validated with a Zod `.strict()` schema.
- Request payloads containing unexpected or unwhitelisted properties must be rejected with 400 `VALIDATION_FAILED`.
- Body parsers must enforce a 100kb payload ceiling: `express.json({ limit: "100kb" })` (PRD 15.5).

## 5. Privacy and Logging Rules (PRD 16.9)
- Never log passwords, access tokens, refresh tokens, auth verifiers, card tokens, full webhook payloads, or email bodies.
- Truncate client IP addresses to `/24` subnets in all request logs.
