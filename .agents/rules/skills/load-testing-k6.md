---
name: load-testing-k6
description: Runbook for seeding 42,000 activity feed rows, executing k6 performance load tests with 200 virtual users, capturing EXPLAIN ANALYZE execution plans, and cleaning up seed data.
---

# Skill: Load Testing with k6 and Query Optimization

Use this skill when preparing performance benchmarks, benchmarking the activity feed, running k6 load test scripts, analyzing PostgreSQL query plans, or cleaning up test data.

## 1. Seeding Activity Rows for Benchmarking (PRD 18.2, 23)

To test cursor pagination under realistic clinic load, seed 42,000 activity rows into the designated demo clinic:

```bash
npx ts-node server/prisma/seed-activity.ts --teamId=<DEMO_TEAM_ID> --count=42000
```

### Seeding Invariants
- All seeded activity rows must be tagged with a removable marker (e.g., `meta.isSeed = true` or a deterministic prefix in `refId`).
- Distribute timestamps across a 60-day historical window to simulate realistic index depth.
- Never run seed scripts against live production clinics. Target only the dedicated demo environment.

---

## 2. Capturing EXPLAIN ANALYZE Plans (PRD 18.2, 23)

Before running the load test, capture execution plans for Page 1 and Page 500:

### Page 1 Query Plan
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM activities
WHERE team_id = '<DEMO_TEAM_ID>'
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

### Page 500 (Deep Cursor) Query Plan
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM activities
WHERE team_id = '<DEMO_TEAM_ID>'
  AND (created_at, id) < ('<CURSOR_TIMESTAMP>', '<CURSOR_ID>')
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

### Recording Results
Paste the raw PostgreSQL output into `docs/perf/feed-explain.md` detailing:
- Index used: must use compound index `@@index([teamId, createdAt(sort: Desc), id(sort: Desc)])`.
- Execution time in milliseconds.
- Shared buffer hits vs. reads.

---

## 3. Running the k6 Load Test Suite (PRD 18.3, 18.4)

### Prerequisites
1. Temporarily allowlist the runner IP address to avoid triggering `ip-ceiling` rate limits:
   Set `RATE_LIMIT_IP_ALLOWLIST=<RUNNER_IP>` on the server.
2. Ensure the demo team is authenticated and tokens are populated in `load-tests/k6-feed-load.js`.

### Execution Command
```bash
# Run 200 Virtual User load test
k6 run load-tests/k6-feed-load.js
```

### Performance Targets to Verify
- Cache enabled: p95 response time under 300 ms across 200 virtual users.
- Error rate: strictly under 1.0%.
- No server crashes or connection pool exhaustion under Little's law throughput.

### Post-Test Cleanup
1. Unset `RATE_LIMIT_IP_ALLOWLIST` immediately following test completion.
2. Export summary results and metrics into `load-tests/REPORT.md`.

---

## 4. Deleting Seed Rows (PRD 18.2)

Remove all load-test activity rows using the cleanup script:
```bash
npx ts-node scripts/clean-seed.ts --teamId=<DEMO_TEAM_ID>
```
Verify with `SELECT count(*) FROM activities WHERE team_id = ...` that the clinic's normal operational activities remain intact while all seed rows are deleted.
