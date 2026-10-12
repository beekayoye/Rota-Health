# Activity Feed Query Plan & Performance Report (PRD 17.4)

## Performance Comparison: Before vs After Index

The table below summarizes real execution metrics captured against a seeded PostgreSQL database containing 42,000 activity rows (12,000 for Grace Point Clinic, 30,000 across 30 other clinics).

| Metric | Page 1 (Before) | Page 1 (After) | Page 500 (Before) | Page 500 (After) |
| :--- | :--- | :--- | :--- | :--- |
| **Execution Time** | **8.170 ms** | **0.144 ms** | **15.725 ms** | **0.176 ms** |
| **Shared Buffers Hit** | 1,266 | 6 | 1,266 | 4 |
| **Shared Buffers Read** | 0 | 0 | 0 | 0 |
| **Plan Shape** | `Seq Scan` → `Sort` → `Limit` | `Limit` over `Index Scan` | `Seq Scan` → `Sort` → `Limit` | `Limit` over `Index Scan` |
| **Rows Removed by Filter** | 30,001 | 0 | 40,001 | 0 |

### What Changed
Adding the composite index `activities_feed_idx ON activities (team_id, created_at DESC, id DESC)` replaced a full table sequential scan and top-N heapsort with an efficient direct index seek. The query engine no longer scans through 30,000–40,000 rows from other clinics or older timestamps, eliminating the sorting overhead entirely and reducing shared buffer lookups from 1,266 pages down to just 4–6 pages.

---

## Migration Note: CONCURRENTLY vs Plain CREATE INDEX
In migration `20261012000000_activities_feed_idx`, PostgreSQL's `CREATE INDEX CONCURRENTLY` is required in zero-downtime production environments. However, because Prisma's migration runner executes migration scripts inside an implicit transaction block (`BEGIN ... COMMIT`), PostgreSQL throws an error (`CREATE INDEX CONCURRENTLY cannot run inside a transaction block`) if executed through `prisma migrate deploy`. The migration therefore applies `CREATE INDEX` within Prisma's migration runner, with the concurrent syntax noted for zero-downtime manual deployments.

---

## Before (Without Index: Primary Key Only)

### Page 1 Plan
```text
Limit  (cost=2115.67..2115.72 rows=21 width=214) (actual time=8.030..8.037 rows=21 loops=1)
  Buffers: shared hit=1266
  ->  Sort  (cost=2115.67..2145.77 rows=12040 width=214) (actual time=8.029..8.033 rows=21 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 31kB
        Buffers: shared hit=1266
        ->  Seq Scan on activities  (cost=0.00..1791.05 rows=12040 width=214) (actual time=0.024..5.104 rows=12003 loops=1)
              Filter: (team_id = 'afbe3006-b44b-4a3b-80ad-cbf6146a64b8'::uuid)
              Rows Removed by Filter: 30001
              Buffers: shared hit=1266
Planning:
  Buffers: shared hit=62
Planning Time: 1.116 ms
Execution Time: 8.170 ms
```

### Page 500 Plan (Cursor at Row 10,000)
Cursor row: `ID=7a6b989a-460f-416a-8ad3-cf609b72a4b5, createdAt=2026-05-16T00:18:50.893Z`
```text
Limit  (cost=2054.86..2054.91 rows=21 width=214) (actual time=15.376..15.386 rows=21 loops=1)
  Buffers: shared hit=1266
  ->  Sort  (cost=2054.86..2059.85 rows=1995 width=214) (actual time=15.373..15.379 rows=21 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=1266
        ->  Seq Scan on activities  (cost=0.00..2001.07 rows=1995 width=214) (actual time=0.198..14.230 rows=2003 loops=1)
              Filter: ((team_id = 'afbe3006-b44b-4a3b-80ad-cbf6146a64b8'::uuid) AND (ROW(created_at, id) < ROW('2026-05-16 00:18:50.893+00'::timestamp with time zone, '7a6b989a-460f-416a-8ad3-cf609b72a4b5'::uuid)))
              Rows Removed by Filter: 40001
              Buffers: shared hit=1266
Planning Time: 0.635 ms
Execution Time: 15.725 ms
```

---

## After (With Composite Index `activities_feed_idx`)

### Page 1 Plan
```text
Limit  (cost=0.41..10.22 rows=21 width=214) (actual time=0.067..0.082 rows=21 loops=1)
  Buffers: shared hit=6
  ->  Index Scan using activities_feed_idx on activities  (cost=0.41..5627.23 rows=12048 width=214) (actual time=0.064..0.076 rows=21 loops=1)
        Index Cond: (team_id = 'afbe3006-b44b-4a3b-80ad-cbf6146a64b8'::uuid)
        Buffers: shared hit=6
Planning:
  Buffers: shared hit=64 read=1
Planning Time: 1.590 ms
Execution Time: 0.144 ms
```

### Page 500 Plan (Cursor at Row 10,000)
Cursor row: `ID=7a6b989a-460f-416a-8ad3-cf609b72a4b5, createdAt=2026-05-16T00:18:50.893Z`
```text
Limit  (cost=0.41..48.20 rows=21 width=214) (actual time=0.032..0.039 rows=21 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using activities_feed_idx on activities  (cost=0.41..4596.79 rows=2020 width=214) (actual time=0.030..0.035 rows=21 loops=1)
        Index Cond: ((team_id = 'afbe3006-b44b-4a3b-80ad-cbf6146a64b8'::uuid) AND (ROW(created_at, id) < ROW('2026-05-16 00:18:50.893+00'::timestamp with time zone, '7a6b989a-460f-416a-8ad3-cf609b72a4b5'::uuid)))
        Buffers: shared hit=4
Planning Time: 0.166 ms
Execution Time: 0.176 ms
```
