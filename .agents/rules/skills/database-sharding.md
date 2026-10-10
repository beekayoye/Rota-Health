---
name: database-sharding
description: Runbook for executing queries across two Supabase PostgreSQL shards, managing the clinic directory saga, configuring PgBouncer connection pools, applying dual-shard migrations, and enforcing Read-Your-Own-Writes consistency.
---

# Skill: Database Sharding, Connection Pooling, and Read Routing

Use this skill when modifying database schemas, writing multi-shard queries, configuring Prisma client extensions, managing connection pool limits, or implementing read-your-own-writes (RYW) caching.

## 1. Multi-Shard Architecture (PRD 9, 16.3)

### Shard Topology
- **Shard A (`rota-a`, shard 0):** Houses all global tables and shard 0 clinics.
- **Shard B (`rota-b`, shard 1):** Houses shard 1 clinics exclusively.
- Global Tables (Shard A only):
  `users`, `refresh_tokens`, `auth_tokens`, `devices`, `user_settings`, `team_directory`, `user_team_index`, `webhook_events`, `idempotency_keys`, `notification_log`.
- Team-Owned Tables (Located on the clinic's assigned shard):
  `teams`, `memberships`, `invites`, `shifts`, `swap_requests`, `activities`, `subscriptions`, `ledger_entries`, `payment_attempts`, `payment_methods`, `outbox_events`.

### Shard Resolution Workflow
Never calculate `fnv1a32(teamId) % 2` directly during operational requests. Always resolve shard location through `team_directory`:
```typescript
export async function getShardClient(teamId: string): Promise<PrismaClient> {
  const cacheKey = `dir:${teamId}`;
  let shardId = await redis.get<number>(cacheKey);

  if (shardId === null) {
    const record = await shardADb.teamDirectory.findUnique({
      where: { teamId },
      select: { shardId: true },
    });
    if (!record) throw new NotFoundError('Team not found');
    shardId = record.shardId;
    await redis.set(cacheKey, shardId, { ex: 3600 });
  }

  return shardId === 0 ? shardADb : shardBDb;
}
```

### Clinic Creation Saga (PRD 16.3)
Creating a clinic spans both shards in a 3-step saga:
1. Insert directory record on Shard A:
   `shardId = fnv1a32(teamId) % 2`.
   `INSERT INTO team_directory (team_id, shard_id) ...`
2. Connect to target shard (`shardId`) and insert `teams`, `memberships` (as `OWNER`), and `subscriptions` (as `INCOMPLETE`) in one local transaction.
   - If step 2 fails: delete directory record on Shard A and abort.
3. Insert entry on Shard A into `user_team_index` for the user's clinic switcher.

---

## 2. Running Schema Migrations (PRD 9, 16.1)

Prisma migrations must be executed independently against both shards using their direct URLs:

```bash
# Unified migration command defined in package.json
npm run db:migrate --workspace=server
```

### Internal Command Execution
```bash
# Shard A (Direct connection port 5432)
DATABASE_URL=$DIRECT_URL_A npx prisma migrate deploy --schema=server/prisma/schema.prisma

# Shard B (Direct connection port 5432)
DATABASE_URL=$DIRECT_URL_B npx prisma migrate deploy --schema=server/prisma/schema.prisma
```

---

## 3. Read-Your-Own-Writes (RYW) and Read Routing (PRD 16.2)

### Routing Policy
- By default, all read-only queries (`findMany`, `findUnique`, `count`) execute through `@prisma/extension-read-replicas` against `DATABASE_READ_URL`.
- Writes, transactions, billing, outbox, idempotency, and settings in notification workers always execute against `DATABASE_URL` (Primary).

### Middleware Implementation
```typescript
export async function rywMiddleware(req: Request, res: Response, next: NextFunction) {
  // Capture response finish
  res.on('finish', async () => {
    // If request performed a successful write
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400 && req.userId) {
      await redis.set(`ryw:${req.userId}`, '1', { ex: 5 }); // 5-second TTL
    }
  });

  // Check RYW flag on entry
  if (req.userId) {
    const hasActiveWrite = await redis.get(`ryw:${req.userId}`);
    if (hasActiveWrite) {
      req.db = getPrimaryDb(req.teamId); // Route reads to Primary
      return next();
    }
  }

  req.db = getReadDb(req.teamId); // Default to Read Replica
  next();
}
```

### Proving RYW with the Delayed Replica
In `docker-compose.test.yml`, the replica has `recovery_min_apply_delay = '2s'`.
Run `npm test --workspace=server -- routing.test.ts` to assert:
- Without RYW key: A read 50ms after a write returns the stale value.
- With RYW key active: The read queries primary and returns the fresh value immediately.

---

## 4. Connection Pooling Discipline (PRD 16.1)

Ensure all runtime connection strings specify:
- Pooler port 6543.
- `pgbouncer=true` (disables prepared statements).
- Client limits: Primary client `connection_limit=10`, Read client `connection_limit=5`, Worker `connection_limit=5`.
- Fail-fast timeout: `pool_timeout=10` (returns 503 `TRY_AGAIN` after 10 seconds).
