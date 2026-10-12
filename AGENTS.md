# AGENTS.md

## 1. Project in one paragraph

Rota Health is an Android shift scheduling app for small clinics with 5 to 40 shift workers. It gives clinics one trusted shift schedule, approved swaps, sleep-respecting alerts, offline shift access, and a per-seat bill where mid-cycle additions cost only the days left in the month. Three roles use the app: Owner (creates clinic, pays bills, manages plans and seats), Manager (drafts and publishes shifts, approves swaps), and Staff (views shifts offline, requests swaps, sets quiet hours). Tagline: "Shift scheduling for clinics that never close." Version 1 is Android only, built with Expo so iOS can follow later without a rewrite. (PRD 1, 2, 3, 25)

## 2. Source of truth and how to use it

- `docs/PRD.md` is the sole source of truth.
- Read specific PRD sections before starting work:
  - API endpoints, request validation, error shapes, idempotency: PRD 10
  - Billing, proration formulas, Flutterwave checkout, webhooks, ledger: PRD 11
  - Notifications, quiet hours algorithm, transactional outbox: PRD 12
  - Data model, Prisma schema, foreign keys, sharding: PRD 9
  - State management, TanStack Query, Zustand, MMKV offline cache: PRD 14
  - Authentication, tokens, link binding, security threats: PRD 15
  - Backend architecture, connection pooling, read routing, Redis cache, queues, rate limits: PRD 16
  - User stories and acceptance criteria: PRD 4
  - Feature rules, membership, shift clashing, swaps, subscription states: PRD 6
  - Permissions matrix: PRD 7
  - Navigation and screen flows: PRD 8
  - Settings sync: PRD 13
  - Cursor pagination: PRD 17
  - Load testing with k6: PRD 18
  - Test suites and test environment: PRD 19
- If a task is not covered by the PRD, or the PRD seems contradictory, stop and ask the user. Never invent behavior.
- Never add anything the PRD lists as out of scope (PRD 2, non-goals):
  - No clock-in or clock-out, payroll, leave management, or patient records.
  - No open-shift marketplace or shift giveaways; swaps are direct between two named people.
  - No recurring shifts or qualification matching.
  - No web dashboard; all roles use the mobile app.
  - No iOS build in v1.
  - No clinic ownership transfer.
  - No real-time WebSockets; the app refetches on open and foreground.
  - No cross-clinic overlap checks on the server.

## 3. Locked tech stack

Agents must use the locked tech stack exactly. Never add an alternative or a new dependency without asking first.

- Mobile client: React Native with Expo and Expo Router (Android development build through EAS Build) (PRD 1, 8, 23)
- List virtualization: FlashList (PRD 8, 23)
- State management: TanStack Query (server state), Zustand (client UI state) (PRD 14)
- Client offline storage: react-native-mmkv with AES encryption for offline cache (PRD 6.8, 14)
- Device secure storage: expo-secure-store (refresh tokens, encryption keys, device ID) (PRD 14, 15.1)
- Backend runtime: Node.js with Express (PRD 1, 16)
- Database: PostgreSQL on Supabase (projects `rota-a` and `rota-b`) with Prisma (PRD 9, 16)
  - Supabase is used only as a database. Never use Supabase Auth, Storage, Realtime, or the Supabase JavaScript client. (PRD 1, 9)
- Cache, locks, queues, rate limits: Upstash Redis (PRD 1, 16.4, 16.6)
- Background workers and jobs: BullMQ (PRD 12.3, 16.7)
- Request validation: Zod with strict schemas (PRD 10)
- Push notifications: Expo push notifications via `expo-server-sdk` (PRD 12)
- Payments: Flutterwave in test mode (PRD 11)
- Transactional email: Resend (PRD 12.3, 16.7)
- Error tracking and performance monitoring: Sentry (`@sentry/react-native` and `@sentry/node`) (PRD 16.9)
- Load testing: k6 (PRD 18)
- Hosting: Railway (API service and worker service) (PRD 16)

## 4. Repo layout

The repository is structured as a monorepo. Decision: Monorepo uses npm workspaces (PRD 23).

- `/app`: React Native Expo mobile application.
- `/server`: Node.js Express backend and BullMQ worker.
- `/scripts`: Operational, maintenance, and verification scripts (PRD 11.6, 15.4, 16.7, 16.9, 18.2).
- `/docs`: Documentation, architecture diagrams, decision records, and performance reports.
- `/load-tests`: k6 load test scripts and configuration.

Detailed structure (unconfirmed folders inside `/app` and `/server` are marked "proposed"):

```
/
├── app/                                 # Expo React Native mobile app
│   ├── app/                             # Expo Router routes (tabs, modals, auth) (PRD 8)
│   ├── src/                             # App source code (proposed)
│   │   ├── components/                  # UI components and FlashList rows (proposed)
│   │   ├── hooks/                       # Custom hooks, network status (proposed)
│   │   ├── state/                       # Zustand stores (auth, active team) (PRD 14)
│   │   ├── api/                         # Axios client, auth interceptor, query options (PRD 14, 15.1)
│   │   ├── storage/                     # Secure store and encrypted MMKV persister (PRD 14)
│   │   └── utils/                       # Shift clashing, Luxon dates (PRD 6.3, 14) (proposed)
│   ├── app.json                         # Expo configuration
│   └── package.json
├── server/                              # Node.js backend
│   ├── prisma/                          # Prisma schema, migrations, and seed scripts (PRD 9)
│   │   ├── schema.prisma
│   │   ├── seed-activity.ts             # 42,000-row activity seed for feed load test (PRD 18.2, 23)
│   │   └── migrations/
│   ├── src/
│   │   ├── api/                         # Express API server (PRD 16)
│   │   │   ├── middleware/              # requestId, auth, resolveTeam, requireRole, etc. (PRD 6.2, 10)
│   │   │   └── routes/                  # Route handlers under /v1 (PRD 10)
│   │   ├── billing/                     # Billing and proration logic (PRD 11)
│   │   │   └── proration.ts             # Pure prorate() function (PRD 11)
│   │   ├── db/                          # Database clients and read replica routing (PRD 16.2)
│   │   │   └── routing.ts               # Read replica client and RYW routing logic (PRD 16.2, 19)
│   │   ├── i18n/                        # Internationalization strings (PRD 13.1, 26.1)
│   │   │   └── en.json                  # English push notification strings (PRD 13.1, 26.1)
│   │   ├── workers/                     # BullMQ worker process and queue handlers (PRD 16.7)
│   │   │   ├── outbox-relay.ts          # Outbox relay runner (PRD 12.3)
│   │   │   └── notification-worker.ts   # Push worker with quiet hours (PRD 12.2)
│   │   ├── lib/                         # Shared Prisma clients, Redis, logger (PRD 16) (proposed)
│   │   └── index.ts                     # Server entry point (proposed)
│   └── package.json
├── scripts/                             # Operational, maintenance, and verification scripts (PRD 11.6, 15.4, 16.7, 16.9, 18.2)
│   ├── trace-payment.ts                 # Trace payment by txRef across logs and tables (PRD 16.9)
│   ├── rebuild-subscription.ts          # Rebuild subscription state from ledger entries (PRD 11.6)
│   ├── clean-seed.ts                    # Delete load test seed rows from database (PRD 18.2)
│   ├── check-bundle-secrets.sh          # Scan Android bundle for leaked secrets (PRD 15.4)
│   ├── replay-failed.ts                 # Move failed queue jobs back to waiting (PRD 16.7)
│   └── refund.ts                        # Manual refund script (PRD 11.6)
├── docs/                                # Documentation (PRD 23)
│   ├── PRD.md                           # Product Requirements Document (source of truth)
│   ├── ARCHITECTURE.md                  # System architecture with Mermaid diagram (PRD 16, 23)
│   ├── architecture.mmd                 # Mermaid diagram source (PRD 16)
│   ├── SECURITY.md                      # Threat model and mitigations (PRD 15.5)
│   ├── SHARDING.md                      # Sharding design and saga details (PRD 16.3)
│   ├── STATE.md                         # Client state map (PRD 14)
│   ├── LEARNING-LOG.md                  # Weekly build learning entries (PRD 23)
│   ├── decisions/                       # Architecture decision records (PRD 23)
│   └── perf/                            # Performance reports and EXPLAIN ANALYZE (PRD 23)
├── load-tests/                          # k6 load testing suite (PRD 18)
│   ├── k6-feed-load.js                  # Feed load test script (PRD 18)
│   └── REPORT.md                        # Load test results report (PRD 18, 23)
├── docker-compose.test.yml              # CI Postgres shards, delayed replica, PgBouncer (PRD 19)
├── package.json                         # Monorepo root package.json
└── AGENTS.md                            # Agent instructions and rules
```

## 5. Commands

The commands below are best guesses for the scaffolded project.

| Task                         | Command                                                                                                                                                                                  | Status                        |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- |
| Install all dependencies     | `npm install`                                                                                                                                                                            | TODO: confirm once scaffolded |
| Start API dev server         | `npm run dev:server --workspace=server`                                                                                                                                                  | TODO: confirm once scaffolded |
| Start background worker      | `npm run dev:worker --workspace=server`                                                                                                                                                  | TODO: confirm once scaffolded |
| Start mobile app dev server  | `npm run dev:app` (or `npx expo start app`)                                                                                                                                              | TODO: confirm once scaffolded |
| Run server test suite        | `npm test --workspace=server`                                                                                                                                                            | TODO: confirm once scaffolded |
| Run app unit tests           | `npm test --workspace=app`                                                                                                                                                               | TODO: confirm once scaffolded |
| Run migrations (both shards) | `npm run db:migrate --workspace=server` (runs `prisma migrate deploy` once for shard A and once for shard B, setting each shard's `DATABASE_URL` and `DIRECT_URL`, as in PRD 9 and 16.1) | TODO: confirm once scaffolded |
| Seed databases (both shards) | `npm run db:seed --workspace=server`                                                                                                                                                     | TODO: confirm once scaffolded |
| Lint codebase                | `npm run lint`                                                                                                                                                                           | TODO: confirm once scaffolded |
| Typecheck TypeScript         | `npm run typecheck`                                                                                                                                                                      | TODO: confirm once scaffolded |
| Build EAS Android dev build  | `eas build --platform android --profile development`                                                                                                                                     | TODO: confirm once scaffolded |

## 6. Non-negotiable rules

Agents must enforce every rule below without exception:

- **Team isolation:** Every query on a team-owned table must filter by `teamId` through the Prisma client extension. If `teamId` is missing, the extension must throw. When a user requests another clinic's resource, the server must return 404 `NOT_FOUND`, never 403. (PRD 6.2, 15.5)
- **Server-enforced permissions:** Permissions are enforced on the server only. The client hides buttons only for usability. Every team route must execute this exact middleware order: `requestId` -> `authenticate` -> `resolveTeam` -> `requireMembership` -> `requireRole` -> `requireSubscriptionState` -> `validate(zodSchema)` -> handler. (PRD 6.2)
- **Subscription states:**
  - `INCOMPLETE`: Allows only clinic settings, drafting shifts, and billing routes. Member invites, shift publishing, and all swap actions must return 402 `PAYMENT_REQUIRED`.
  - `ACTIVE` and `PAST_DUE`: All routes allowed.
  - `RESTRICTED`: Reads and billing routes allowed. All team-scoped writes return 402 `SUBSCRIPTION_RESTRICTED`.
  - User-scoped routes (`/me/...`, `/auth/...`) are never blocked by subscription state. (PRD 6.5, 7)
- **Input validation:** Every request body, query parameter, and route parameter must be validated with a Zod `.strict()` schema. Reject unexpected fields with 400 `VALIDATION_FAILED`. (PRD 10)
- **Money and billing integrity:**
  - All monetary values must be stored and computed as integer cents. Never use floating-point numbers for money. (PRD 6.5, 11)
  - Proration must be calculated solely through `prorate()` in `server/src/billing/proration.ts`. The function must be pure and never read the system clock; pass the date explicitly. (PRD 11, 11.4)
  - Only a verified and re-verified Flutterwave webhook processed in a background job can change payment state. (PRD 2, 11.8)
  - Enforce exactly one open checkout attempt per clinic. (PRD 11.7)
  - If a stale or superseded attempt is paid, refund it automatically. Never apply it. (PRD 11.8)
  - The ledger (`ledger_entries`) is strictly append-only. A database trigger blocks updates and deletes. Corrections must be written as new `ADJUSTMENT` rows referencing `corrects_entry_id`. (PRD 9, 11.6)
- **Transactional outbox for side effects:** Handlers must never call queues, Expo Push, Resend, or Flutterwave directly. Write side effects (`outbox_events`) in the same database transaction as the data change. The outbox relay picks them up. (PRD 12.3)
- **Idempotency:** An `Idempotency-Key` header (UUID v4) is required on all routes marked "Idem" in PRD 10 (`/teams`, invites, shift publish, swaps, swap approve, checkout, plan changes). Background jobs must use deterministic, stable `jobId` values. (PRD 10, 16.8)
- **Strict cache exclusions:** Never cache subscriptions, billing state, payment attempt status, ledger entries, webhook events, idempotency records, refresh tokens, outbox rows, or notification settings. Every Redis cache key must have an explicit TTL. (PRD 16.4, 16.5)
- **Database read routing:** Read queries go to the read client (`DATABASE_READ_URL`) by default. Billing, outbox, idempotency, and any query inside a transaction must use the primary. Write operations set Redis key `ryw:{userId}` with a 5-second TTL to ensure read-your-own-writes consistency. (PRD 16.2)
- **Authentication security:**
  - Access tokens (JWT, 15-minute expiry) must live in memory only. Never persist access tokens to disk, MMKV, or AsyncStorage. (PRD 14, 15.1)
  - Refresh tokens live exclusively in `expo-secure-store`. Rotate the refresh token on every use. Reusing an old refresh token must immediately revoke the entire token family. (PRD 15.1, 15.2)
  - Magic links and password reset links must bind to the requesting phone using `deviceId` and PKCE-style `codeVerifier`. (PRD 15.3)
- **No secrets in client app:** The client bundle must contain only the four approved variables: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_APP_ENV`, and `EXPO_PUBLIC_EAS_PROJECT_ID`. All server and provider secrets remain on the server. (PRD 15.4)
- **Logging privacy:** Never log passwords, tokens, verifiers, card tokens, full webhook payloads, or email bodies. (PRD 16.9)
- **Sharding rules:** Shard routing goes through `team_directory`, never through the hash directly. Global tables live only on Shard A. Migrations and seed scripts must run on both shards. (PRD 9, 16.3)

## 7. Coding conventions

- TypeScript: Strict mode enabled on both `/app` and `/server`.
- Error shape: All server error responses must use this exact structure:
  `{ "error": { "code": "SEAT_LIMIT_EXCEEDED", "message": "...", "details": {} } }`. (PRD 10)
- Error codes: Use only the documented error codes in PRD 10.
- Query keys: Team-scoped TanStack Query keys must always start with `["team", teamId, ...]`. (PRD 14)
- Dates and time: Store all timestamps as `timestamptz(3)` in UTC in the database. Use Luxon for time zone conversions. Show calendar and shift times in the clinic's time zone. (PRD 6.3, 12.2)
- Naming conventions: Use kebab-case for file names (`proration.ts`, `outbox-relay.ts`, `shift-editor.tsx`). Use camelCase for variables and functions. Use PascalCase for types and components.
- Schemas: Write Zod schemas with `.strict()` directly next to their route handlers. (PRD 10)

## 8. Testing rules

- Integration tests must run through PgBouncer in transaction mode with `docker-compose.test.yml`. Never mock PostgreSQL in integration tests. (PRD 19)
- Test suite mapping (agents must update these test suites when modifying corresponding areas):
  - Billing and proration: update `proration.test.ts`, `checkout.test.ts`, and `webhook.test.ts`. (PRD 19)
  - Routes, roles, or middleware: update `permissions.test.ts`, `isolation.test.ts`, and `subscription-state.test.ts`. (PRD 19)
  - Shifts, calendar, and swaps: update `shifts.test.ts` and `swaps.test.ts`. (PRD 19)
  - Invites and deep links: update `invites.test.ts` and `tokens.test.ts`. (PRD 19)
  - Auth, rotation, and reset links: update `refresh-reuse.test.ts` and `tokens.test.ts`. (PRD 19)
  - Notifications and quiet hours: update `quiet-hours.test.ts` and `outbox.test.ts`. (PRD 19)
  - Settings and sync: update `settings.test.ts`. (PRD 19)
  - Feed pagination: update `feed.test.ts`. (PRD 19)
  - Read replica and RYW: update `routing.test.ts`. (PRD 19)
  - Rate limiting and Redis-down fallbacks: update `ratelimit.test.ts`. (PRD 19)
  - Mobile client tests: Jest with React Native Testing Library for optimistic swap requests, settings rollback, offline shifts rendering from 3-day-old cache, and shift clashing. (PRD 19)
- A task is not done until all associated test suites pass, including 403 permission and 404 isolation test cases for any new or modified endpoint. (PRD 19)

## 9. Definition of done for any task

Verify this checklist before marking any task complete:

1. All relevant acceptance criteria in PRD 4 and PRD 6 are met.
2. Automated tests are written and passing, including 403 and 404 security test cases.
3. TypeScript typecheck and ESLint pass cleanly with zero errors.
4. No new dependency or package was added without explicit user approval.
5. Documentation updated where applicable: `STATE.md`, `SECURITY.md`, `ARCHITECTURE.md`, `SHARDING.md`, or `README.md`.
6. An Architecture Decision Record added to `docs/decisions/` for any significant architectural or technical choice.
7. An entry added to `docs/LEARNING-LOG.md` if an operational or design lesson was learned.

## 10. Git workflow

- Branch naming convention (PRD 23):
  - `feat/<feature-name>` for features.
  - `chore/<chore-name>` for setup, builds, and tooling.
  - `perf/<perf-name>` for performance optimizations and load tests.
  - `docs/<doc-name>` for documentation updates.
- One pull request per feature, containing:
  - Concise description of changes.
  - Screenshots or screen recordings for any UI changes.
  - List of PRD sections and acceptance criteria covered.
- Small commits with clear messages written in active voice.
- Never commit `.env` files or secrets.

## 11. When to stop and ask

Stop and ask the user for clarification in any of these situations:

- The PRD is silent or contradictory on a scenario.
- A change touches money calculations, auth logic, team isolation, or the database schema in a way not described in the PRD.
- A requirement relies on an unverified item from PRD 26.3 (`[VERIFY IN DOCS]`).
- A new dependency, package, or third-party service is needed.
- A test failure would require weakening an assertion or security rule to pass.

## 12. Glossary

- **Clinic or Team:** The tenant organization in Rota Health, stored in the `teams` table. (PRD 1, 9)
- **Seat:** The purchased user capacity under a clinic's subscription plan. (PRD 6.5, 9, 11)
- **Shard:** One of two independent PostgreSQL databases (`rota-a` or `rota-b`). (PRD 9, 16.3)
- **Directory:** The global mapping table on Shard A (`team_directory`) that maps each `team_id` to its `shard_id`. (PRD 9, 16.3)
- **Outbox:** The `outbox_events` table where side effects (push, emails, cache invalidations, refunds) are written inside the database transaction. (PRD 12.3)
- **Idempotency Key:** A UUID v4 header sent on mutating requests to prevent duplicate operations on network retries. (PRD 10, 16.8)
- **tx_ref:** A unique payment reference string formatted as `rh_<teamId8>_<idempotencyKey>` identifying a Flutterwave transaction. (PRD 11.7, 16.8)
- **Ledger:** The append-only `ledger_entries` table recording every billing event in integer cents. (PRD 9, 11.6)
- **Grace Period:** A 7-day period starting when a renewal fails (`PAST_DUE`) before the clinic becomes `RESTRICTED`. (PRD 11.10)
- **Quiet Hours:** A user-configured window during which non-urgent push notifications are held until the window ends. (PRD 12.2)
- **Read-Your-Own-Writes (RYW):** A mechanism using a 5-second Redis key (`ryw:{userId}`) that directs a user's reads to the primary database immediately after a write. (PRD 16.2)
