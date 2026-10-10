---
name: billing-proration
description: Procedures and runbook for calculating pure proration in integer cents, managing Flutterwave checkouts, processing verified webhooks, handling automatic refunds, and maintaining append-only ledger integrity.
---

# Skill: Billing, Proration, and Ledger Management

Use this skill when implementing or modifying billing calculations, plan changes, seat adjustments, payment checkouts, webhook handlers, refund workflows, or ledger entries.

## 1. Proration Implementation Workflow (PRD 11.1, 11.4)

### Rules & Signature
- The calculation must reside in `server/src/billing/proration.ts` as a pure function:
  ```typescript
  export interface ProrateInput {
    oldPlan: 'STARTER' | 'TEAM' | 'BUSINESS';
    oldSeats: number;
    newPlan: 'STARTER' | 'TEAM' | 'BUSINESS';
    newSeats: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    now: Date; // Mandatory: Never read Date.now() internally
  }

  export interface ProrateResult {
    daysLeft: number;
    creditCents: number;
    costCents: number;
    chargeCents: number;
    newMonthlyCents: number;
    isDowngrade: boolean;
  }
  ```

### Step-by-Step Calculation Procedure
1. Compute calendar days elapsed in the clinic's local time zone using Luxon.
2. `daysLeft = Math.max(0, 30 - daysElapsed)`.
   - Day 1 of 30 has 30 days left.
   - Day 30 of 30 has 1 day left.
3. If `now >= currentPeriodEnd`, throw an error or return 409 `RENEWAL_IN_PROGRESS`.
4. Calculate monthly base prices in integer cents:
   - Starter: 2000 cents ($20.00), max 5 seats. Extra seats throw 409 `PLAN_SEAT_CAP`.
   - Team: 5000 cents ($50.00), 15 included seats, 300 cents per extra seat.
   - Business: 12000 cents ($120.00), 40 included seats, 200 cents per extra seat.
5. Apply rounding rule strictly:
   ```typescript
   const creditCents = Math.floor((oldMonthlyCents * daysLeft) / 30);
   const costCents = Math.floor((newMonthlyCents * daysLeft) / 30);
   ```
6. If `newMonthlyCents > oldMonthlyCents`:
   - `chargeCents = costCents - creditCents`.
7. If `newMonthlyCents < oldMonthlyCents`:
   - Mark as downgrade: `chargeCents = 0`. Store as `pendingPlan` and `pendingSeats` applied at period end.
8. If `newMonthlyCents === oldMonthlyCents` and `newPlan === oldPlan`:
   - Return 422 `NO_CHANGE`.

### Verification Test Cases (PRD 11.4)
Always run `npm test --workspace=server -- proration.test.ts` to verify:
- Starter 5 to Team 15 (Day 11, 20 days left): Credit 1333, Cost 3333, Charge 2000 cents.
- Team 15 to Team 18 (12 days left): Credit 2000, Cost 2360, Charge 360 cents.
- Downgrades: Charge 0 cents, scheduled for renewal.

---

## 2. Flutterwave Checkout & Single Open Attempt (PRD 11.7)

### Checkout Workflow (`POST /v1/teams/:teamId/billing/checkout`)
1. Validate incoming `Idempotency-Key` header (UUID v4).
2. Query the primary database for live subscription state under row lock.
3. If `now >= currentPeriodEnd`, reject with 409 `RENEWAL_IN_PROGRESS`.
4. Run `prorate()`. If `chargeCents <= 0`, reject.
5. Check existing non-renewal attempts on the clinic's shard:
   - If an open attempt (`CREATED` or `PENDING`) matches the exact target plan and seats, return its existing `checkoutUrl` immediately.
   - If an open attempt exists for a different configuration, mark the existing attempt `SUPERSEDED`.
6. Insert new row in `payment_attempts`:
   - `txRef = rh_${teamId.slice(0, 8)}_${idempotencyKey}`.
   - `status = CREATED`.
7. Call Flutterwave Hosted Checkout API (`POST https://api.flutterwave.com/v3/payments`):
   - Send `tx_ref`, `amount` in major units (`chargeCents / 100`), customer email, redirect URL, and metadata `{ teamId, attemptId }`.
8. Save `checkoutUrl`, update status to `PENDING`, and return to client.

---

## 3. Webhook Handling and Automatic Refunds (PRD 11.8)

### Ingestion Procedure (`POST /v1/webhooks/flutterwave`)
1. Read raw request buffer.
2. Verify signature header with `FLW_SECRET_HASH` using `crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret))`. Reject mismatched signatures with 401.
3. Extract `eventId = "${event}:${data.id}"`.
4. Execute `INSERT INTO webhook_events (id, ...) VALUES (...) ON CONFLICT (id) DO NOTHING`.
5. If duplicate, return 200 immediately.
6. Enqueue BullMQ job in `webhooks` queue with `jobId = eventId` and return 200 within 1 second.

### Background Verification & Refund Logic
1. Background job calls Flutterwave verification API: `GET /v3/transactions/{data.id}/verify`.
2. Confirm `status === "successful"`, `currency`, and `amount` equal stored values on `payment_attempts`.
3. Lock subscription on the clinic shard with `SELECT ... FOR UPDATE`.
4. **Stale or Superseded Check:**
   - If attempt is `SUPERSEDED` or `ABANDONED`, or the subscription already holds the target plan and seats:
   - Mark attempt `REFUND_PENDING`.
   - Write outbox row with `kind = "billing.refund"`.
   - BullMQ `billing:refund` worker calls Flutterwave refund API, creates negative `REFUND` ledger row, marks attempt `REFUNDED`, and notifies Owner.
5. **Normal Upgrade Check:**
   - Mark attempt `SUCCEEDED`.
   - Write append-only ledger rows (`PRORATION_CREDIT`, `PRORATION_CHARGE`, `CHANGE_APPLIED`).
   - Update subscription `plan`, `seats`, and encrypted card token (`CARD_TOKEN_KEY`).
   - Write outbox row with `kind = "notify"` for Owner alert.

---

## 4. Append-Only Ledger Verification (PRD 9, 11.6)

- Never issue `UPDATE` or `DELETE` on `ledger_entries`. PostgreSQL trigger will abort the transaction.
- When fixing an incorrect entry, insert an `ADJUSTMENT` row with `corrects_entry_id = targetId`.
- Verify ledger consistency using the verification script:
  ```bash
  npx ts-node scripts/rebuild-subscription.ts <teamId>
  ```
  The script replays all ledger rows and must arrive at the identical plan, seats, and period numbers as the live subscription row.
