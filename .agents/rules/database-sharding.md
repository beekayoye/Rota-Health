# Database, Sharding, and Caching Rules

These rules govern database access, connection pooling, sharding architecture, read-replica routing, and Redis caching.

## 1. Sharding Architecture (PRD 9, 16.3)
- The database is partitioned across two independent PostgreSQL instances on Supabase: `rota-a` (shard 0) and `rota-b` (shard 1).
- Global tables exist solely on Shard A (`rota-a`):
  - `users`, `refresh_tokens`, `auth_tokens`, `devices`, `user_settings`, `team_directory`, `user_team_index`, `webhook_events`, `idempotency_keys`, `notification_log`.
- Team-owned tables exist on the clinic's assigned shard:
  - `teams`, `memberships`, `invites`, `shifts`, `swap_requests`, `activities`, `subscriptions`, `ledger_entries`, `payment_attempts`, `payment_methods`, `outbox_events`.
- Shard placement:
  - When creating a clinic, assign `shardId = fnv1a32(teamId) % 2` and record it in `team_directory` on Shard A.
  - All subsequent database routing must resolve the shard via `team_directory` (cached in Redis as `dir:{teamId}` with TTL 3600s), never by recalculating the hash directly (PRD 16.3).
- Schema migrations must be applied to both shards independently using the direct connection URL:
  `npm run db:migrate --workspace=server` runs `prisma migrate deploy` once for Shard A and once for Shard B (PRD 16.1).

## 2. Connection Pooling (PRD 9, 16.1)
- All runtime connections must connect through the Supabase transaction pooler on port 6543:
  `postgres://...?pgbouncer=true&connection_limit=10&pool_timeout=10`.
- The connection parameter `pgbouncer=true` is mandatory to disable Prisma prepared statements.
- Configure client pool limits strictly:
  - API primary client: `connection_limit = 10`.
  - API read client: `connection_limit = 5`.
  - Worker client: `connection_limit = 5`.
- Pool timeout of 10 seconds (`pool_timeout=10`) must fail fast with 503 `TRY_AGAIN` instead of hanging requests.

## 3. Database Read Routing and Read-Your-Own-Writes (PRD 16.2)
- Read routing:
  - Read-only queries (`findMany`, `findUnique`, `count`) default to the read client (`DATABASE_READ_URL`).
  - All write mutations and queries wrapped in `$transaction` must execute against the primary client (`DATABASE_URL`).
- Read-Your-Own-Writes (RYW) guarantee:
  - Following any successful non-GET request, middleware must set Redis key `ryw:{userId}` with a 5-second TTL (`EX 5`).
  - If `ryw:{userId}` exists, all read queries for that user must route to the primary client (`db.$primary()`).
- Invariant primary routing:
  - Billing queries, payment attempt checks, ledger queries, settings reads within the notification worker, idempotency lookups, and outbox operations must always query the primary database, regardless of RYW state.

## 4. Redis Caching Rules (PRD 16.4, 16.5)
- Every Redis cache key must be set with an explicit Time-To-Live (TTL):
  - Team roster (`team:{teamId}:roster`): TTL 300 s.
  - Week calendar (published) (`team:{teamId}:shifts:pub:{weekStart}`): TTL 120 s.
  - Week calendar (drafts) (`team:{teamId}:shifts:all:{weekStart}`): TTL 60 s.
  - Activity feed first page (`team:{teamId}:feed:first`): TTL 30 s.
  - Team directory lookup (`dir:{teamId}`): TTL 3600 s.
  - Token version check (`auth:tv:{userId}`): TTL 60 s.
- Invalidation must occur after the database commit via the transactional outbox (`kind = cache.invalidate`).
- Strict Cache Exclusions (Never Cache):
  - Subscriptions, billing status, payment attempts, ledger entries, webhook events, idempotency records, refresh tokens, outbox events, and recipient notification settings must never be cached in Redis. Always read these from PostgreSQL.
