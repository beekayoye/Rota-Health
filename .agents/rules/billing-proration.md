# Billing, Proration, and Ledger Rules

These rules govern money calculations, payment checkouts, webhook verification, background renewals, and ledger operations.

## 1. Monetary Precision (PRD 6.5, 11)
- All monetary amounts must be stored, computed, and transferred as integer cents.
- Never use floating-point types for currency or price logic.
- Base plan costs in integer cents: Starter 2000 ($20.00), Team 5000 ($50.00), Business 12000 ($120.00) (PRD 11.3).
- Extra seat costs: Team 300 cents ($3.00/seat), Business 200 cents ($2.00/seat). Starter has no extra seats and a hard cap of 5 seats (`PLAN_SEAT_CAP`) (PRD 11.3).

## 2. Proration Logic (PRD 11.1, 11.4)
- All proration calculations must be performed solely by `prorate()` in `server/src/billing/proration.ts`.
- `prorate()` must remain a pure function. It must never read the system clock (`Date.now()`); pass the current date explicitly as an argument.
- Formula and rounding rule:
  - `daysLeft = 30 - daysElapsed` (calendar days elapsed in clinic's time zone).
  - Multiply `monthly * daysLeft` as an integer first.
  - Divide by 30 and round down using `Math.floor()` separately for credit and cost.
  - `charge = cost - credit` (applied only when new monthly price exceeds old monthly price).
- Decreases (downgrades or seat removals): charge 0 cents today; store `pendingPlan` and `pendingSeats` on the subscription to take effect at `currentPeriodEnd` (PRD 11.1).
- Plan or seat changes requested when `now >= currentPeriodEnd` must return 409 `RENEWAL_IN_PROGRESS` and enqueue `renewals:charge` immediately to prevent free upgrades before renewal runs (PRD 11.1).

## 3. Flutterwave Checkout and Payment Attempts (PRD 11.7)
- `POST /v1/teams/:teamId/billing/checkout` requires an `Idempotency-Key` UUID v4 header.
- Enforce exactly one open payment attempt per clinic.
- If a `CREATED` or `PENDING` attempt already exists for the identical plan and seats, return the existing checkout URL.
- If an open attempt exists for a different configuration, mark the old attempt `SUPERSEDED`.
- Transaction reference must follow the exact format: `rh_<teamId8>_<idempotencyKey>` (PRD 11.7, 16.8).
- Attempts remaining `PENDING` after 60 minutes must be marked `ABANDONED` by a maintenance job (PRD 11.7).

## 4. Webhook Processing and Automatic Refunds (PRD 11.8)
- Only a verified Flutterwave webhook processed in a background job can alter payment or subscription state.
- Webhook endpoints must verify signatures using constant-time string comparison (`crypto.timingSafeEqual`) against `FLW_SECRET_HASH`. Reject invalid signatures with 401 (PRD 11.8).
- Webhook events must be deduplicated on `webhook_events.id = "<event>:<data.id>"` using `ON CONFLICT DO NOTHING`. Return 200 within 1 second after deduplication and queueing (PRD 11.8).
- Background worker must re-verify the transaction with Flutterwave's transaction verification API, checking that `status === "successful"`, `currency`, and `amount` match the attempt record (PRD 11.8).
- Handling stale or superseded payments:
  - If a webhook confirms payment for an attempt that was marked `SUPERSEDED` or `ABANDONED`, or the subscription already holds the target plan and seats, apply no subscription change.
  - Automatically mark the attempt `REFUND_PENDING` and trigger an automated refund via the outbox (`billing.refund`).
  - Upon Flutterwave refund confirmation, mark the attempt `REFUNDED`, insert a negative `REFUND` ledger entry, and notify the Owner (PRD 11.8).

## 5. Append-Only Ledger Integrity (PRD 9, 11.6)
- The `ledger_entries` table is strictly append-only.
- A PostgreSQL database trigger must block all `UPDATE` and `DELETE` operations on `ledger_entries`.
- All ledger mutations must occur within the same database transaction that updates `subscriptions`.
- Corrections must be recorded as new rows of type `ADJUSTMENT` referencing `corrects_entry_id`.
- CI must verify that running `scripts/rebuild-subscription.ts <teamId>` replaying the ledger matches the live subscription state exactly (PRD 11.6).

## 6. Renewal Job and Grace Period (PRD 11.9, 11.10)
- The repeatable job `renewals:scan` runs hourly and enqueues `renewals:charge` with deterministic `jobId = renew_<subscriptionId>_<periodNumber + 1>`.
- Failed renewal starts a 7-day grace period: status transitions to `PAST_DUE` with `graceEndsAt = now + 7 days`.
- Automated retry attempts run on Day 3 (`_r3`) and Day 6 (`_r6`).
- If unpaid by Day 7, status transitions to `RESTRICTED`.
- Any successful payment restores status to `ACTIVE`, clearing `graceEndsAt` and starting a new 30-day period from the payment timestamp.
