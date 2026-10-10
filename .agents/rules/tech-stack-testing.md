# Tech Stack, Testing, and Definition of Done Rules

These rules govern approved dependencies, workspace configuration, coding conventions, testing protocols, and completion criteria.

## 1. Locked Tech Stack (PRD 1, 3, 23)
- Agents must use the locked tech stack exactly. Never add alternative libraries or new dependencies without prior user approval:
  - Mobile Client: React Native with Expo and Expo Router (Android development build via EAS Build).
  - Virtualized Lists: FlashList.
  - Client State: TanStack Query (server state), Zustand (client UI state).
  - Client Offline Storage: `react-native-mmkv` with AES encryption.
  - Device Secure Storage: `expo-secure-store`.
  - Backend Runtime: Node.js with Express.
  - Database: PostgreSQL on Supabase (`rota-a` and `rota-b`) with Prisma ORM.
    - Supabase is used strictly as raw PostgreSQL. Never use Supabase Auth, Storage, Realtime, or the Supabase JavaScript SDK.
  - Cache, Locks, Rate Limiting: Upstash Redis.
  - Background Queues: BullMQ.
  - Input Validation: Zod with `.strict()` schemas.
  - Push Notifications: `expo-server-sdk`.
  - Payments: Flutterwave in test mode.
  - Transactional Email: Resend.
  - Error Tracking: Sentry (`@sentry/react-native` and `@sentry/node`).
  - Load Testing: k6.
  - Cloud Hosting: Railway (API service and worker service).

## 2. Monorepo and Coding Conventions (PRD 7, 10, 23)
- Monorepo structure uses npm workspaces:
  - `/app`: Mobile client.
  - `/server`: API and background worker.
  - `/scripts`: Operational and CI verification scripts.
  - `/docs`: Architecture, decisions, and system documentation.
  - `/load-tests`: k6 performance test suites.
- TypeScript strict mode must be enabled on both `/app` and `/server`.
- Error response standard: All server error responses must conform strictly to:
  `{ "error": { "code": "STRING_CODE", "message": "Human readable description", "details": {} } }` (PRD 10).
- Query keys for team data must always follow: `["team", teamId, ...]` (PRD 14).
- Timestamps must be stored as `timestamptz(3)` in UTC in PostgreSQL and formatted in the clinic's local time zone using Luxon.
- Mutation idempotency: An `Idempotency-Key` header (UUID v4) is required on all mutating endpoints marked "Idem" in PRD 10 (`/teams`, invites, shift publish, swap requests, swap approvals, checkout, and plan changes).

## 3. Testing Rules and PgBouncer Integration (PRD 19)
- Integration tests must run against real PostgreSQL instances through PgBouncer in transaction mode using `docker-compose.test.yml`.
- Never mock PostgreSQL in backend integration tests.
- Local fakes (`FakeFlutterwave`, `FakeExpo`) must be used in CI to avoid third-party network calls.
- Test suite domain mapping:
  - Billing or proration modifications: update `proration.test.ts`, `checkout.test.ts`, and `webhook.test.ts`.
  - Route, role, or middleware modifications: update `permissions.test.ts`, `isolation.test.ts`, and `subscription-state.test.ts`.
  - Shift scheduling and swap logic: update `shifts.test.ts` and `swaps.test.ts`.
  - Auth, session, and token handling: update `refresh-reuse.test.ts` and `tokens.test.ts`.
  - Notifications and quiet hours: update `quiet-hours.test.ts` and `outbox.test.ts`.
  - Database read routing or replica changes: update `routing.test.ts`.
  - Rate limiting logic: update `ratelimit.test.ts`.
  - Activity feed pagination: update `feed.test.ts`.

## 4. Definition of Done (DoD)
A task is complete only when all of the following requirements are satisfied:
1. All relevant acceptance criteria in PRD 4 and PRD 6 are met.
2. Automated tests are written and passing, including 403 permission and 404 isolation test cases for any new or modified endpoint.
3. TypeScript typecheck and ESLint pass with zero errors.
4. No new package or external service was added without explicit user approval.
5. Documentation updated where applicable (`STATE.md`, `SECURITY.md`, `ARCHITECTURE.md`, `SHARDING.md`, or `README.md`).
6. An Architecture Decision Record (ADR) added to `docs/decisions/` for any significant technical choice.
7. An entry added to `docs/LEARNING-LOG.md` if an operational or design lesson was learned.

## 5. When to Stop and Ask
Halt execution and request user clarification when:
- The PRD is silent or contradictory on a required scenario.
- A proposed change modifies money calculations, auth flows, team isolation, or the database schema in a way not documented in the PRD.
- A requirement relies on an unverified item from PRD 26.3 (`[VERIFY IN DOCS]`).
- A new dependency or third-party provider is required.
- A test failure would require weakening an assertion, test case, or security boundary to pass.
