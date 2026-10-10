---
name: testing-pgbouncer
description: Runbook for executing backend integration tests against real PostgreSQL shards through PgBouncer in transaction mode, configuring local test fakes, and verifying security boundaries.
---

# Skill: Testing with PgBouncer and CI Test Environment

Use this skill when running backend test suites, diagnosing transaction pooler issues, testing read-your-own-writes against delayed replicas, or writing security test cases.

## 1. Test Environment Setup (`docker-compose.test.yml`) (PRD 19)

### Topology
- `pg-a`: Shard 0 PostgreSQL 16 container.
- `pg-b`: Shard 1 PostgreSQL 16 container.
- `pg-a-replica`: Streaming replica of Shard A configured with `recovery_min_apply_delay = '2s'`.
- `pgbouncer-a`: PgBouncer instance in transaction mode fronting `pg-a` (port 6543).
- `pgbouncer-b`: PgBouncer instance in transaction mode fronting `pg-b` (port 6543).
- `redis`: Redis instance for rate limiting, cache, and BullMQ queues.

### Starting the Test Infrastructure
```bash
docker compose -f docker-compose.test.yml up -d
```

### Connection Rules
- All test database connections in CI must target the PgBouncer ports with `pgbouncer=true`:
  `postgres://postgres:postgres@localhost:6543/postgres?pgbouncer=true`
- Never mock PostgreSQL in backend integration tests. Tests must execute real SQL through the pooler.
- Migrations in CI bypass the pooler and target direct ports (5432) on `pg-a` and `pg-b`.

---

## 2. Test Execution Commands (PRD 19)

### Running Specific Suites
```bash
# Run all server tests
npm test --workspace=server

# Run role permission test suite
npm test --workspace=server -- permissions.test.ts

# Run team tenant isolation suite
npm test --workspace=server -- isolation.test.ts

# Run proration calculation and billing tests
npm test --workspace=server -- proration.test.ts

# Run webhook signature, deduplication, and refund tests
npm test --workspace=server -- webhook.test.ts

# Run Read-Your-Own-Writes replica routing tests
npm test --workspace=server -- routing.test.ts

# Run quiet hours delivery algorithm tests
npm test --workspace=server -- quiet-hours.test.ts
```

---

## 3. Test Suite Domain Mapping (PRD 19)

Whenever modifying code, you must update and verify the corresponding test files:

| Area Modified | Required Test Suites to Run & Update |
| :--- | :--- |
| Billing, Proration, or Ledger | `proration.test.ts`, `checkout.test.ts`, `webhook.test.ts` |
| Express Routes, Roles, or Middleware | `permissions.test.ts`, `isolation.test.ts`, `subscription-state.test.ts` |
| Shifts, Calendars, or Swaps | `shifts.test.ts`, `swaps.test.ts` |
| Invites or Magic Links | `invites.test.ts`, `tokens.test.ts` |
| Refresh Tokens or Session Revocation | `refresh-reuse.test.ts`, `tokens.test.ts` |
| Outbox or Notifications | `quiet-hours.test.ts`, `outbox.test.ts` |
| Read Replica or RYW Middleware | `routing.test.ts` |
| Rate Limiter or Redis Outages | `ratelimit.test.ts` |
| Activity Feed Pagination | `feed.test.ts` |

---

## 4. Writing Security Test Assertions (PRD 6.2, 19)

Every new or modified endpoint must include automated test cases for permissions and isolation:

### 1. Role Permission Test (Expect 403)
Verify that lower-privileged roles receive 403 `FORBIDDEN`:
```typescript
test('Staff cannot delete shift', async () => {
  const staffToken = await createTestUserToken({ role: 'STAFF', teamId });
  const res = await request(app)
    .delete(`/v1/teams/${teamId}/shifts/${shiftId}`)
    .set('Authorization', `Bearer ${staffToken}`);

  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('FORBIDDEN');

  // Verify shift was NOT deleted in database
  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  expect(shift).not.toBeNull();
});
```

### 2. Tenant Isolation Test (Expect 404)
Verify that authenticated users from other clinics receive 404 `NOT_FOUND`:
```typescript
test('User from Clinic A cannot view Clinic B shift', async () => {
  const clinicAToken = await createTestUserToken({ role: 'MANAGER', teamId: clinicAId });
  const res = await request(app)
    .get(`/v1/teams/${clinicBId}/shifts/${clinicBShiftId}`)
    .set('Authorization', `Bearer ${clinicAToken}`);

  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NOT_FOUND');
});
```

### 3. Subscription State Test (Expect 402)
Verify that subscription restrictions are enforced:
```typescript
test('INCOMPLETE clinic cannot publish shifts', async () => {
  const ownerToken = await createTestUserToken({ role: 'OWNER', teamId: incompleteTeamId });
  const res = await request(app)
    .post(`/v1/teams/${incompleteTeamId}/shifts/publish`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ shiftIds: [draftShiftId] });

  expect(res.status).toBe(402);
  expect(res.body.error.code).toBe('PAYMENT_REQUIRED');
});
```

---

## 5. Mocking Policy (PRD 19)
- Never mock PostgreSQL, Prisma transactions, or database constraints.
- Replace external providers with local fakes only:
  - `FakeFlutterwave`: Returns scripted checkout responses, verification payloads, and refund confirmations.
  - `FakeExpo`: Records dispatched push message payloads and simulates `DeviceNotRegistered` receipts.
  - `FakeResend`: Records outbound email bodies without dispatching over SMTP.
