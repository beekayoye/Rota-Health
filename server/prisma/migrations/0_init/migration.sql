-- Enable btree_gist for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InviteMode" AS ENUM ('EMAIL', 'LINK');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'TEAM', 'BUSINESS');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('CHARGE', 'PRORATION_CHARGE', 'PRORATION_CREDIT', 'REFUND', 'ADJUSTMENT', 'CHANGE_SCHEDULED', 'CHANGE_APPLIED', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'SUPERSEDED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('MAGIC_LINK', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "password_hash" TEXT,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_id" UUID NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_id" UUID NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expo_push_token" TEXT NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "quiet_hours_start" VARCHAR(5),
    "quiet_hours_end" VARCHAR(5),
    "quiet_hours_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "time_zone_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "notify_shifts" BOOLEAN NOT NULL DEFAULT true,
    "notify_shifts_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "notify_swaps" BOOLEAN NOT NULL DEFAULT true,
    "notify_swaps_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "notify_billing" BOOLEAN NOT NULL DEFAULT true,
    "notify_billing_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "language" VARCHAR(5) NOT NULL DEFAULT 'en',
    "language_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "theme" VARCHAR(6) NOT NULL DEFAULT 'system',
    "theme_updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "team_directory" (
    "team_id" UUID NOT NULL,
    "shard_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_directory_pkey" PRIMARY KEY ("team_id")
);

-- CreateTable
CREATE TABLE "user_team_index" (
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "team_name" VARCHAR(80) NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "user_team_index_pkey" PRIMARY KEY ("user_id","team_id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "tx_ref" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "outcome" VARCHAR(40),
    "payload" JSONB NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_body" JSONB,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "urgent" BOOLEAN NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "ticket_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "mode" "InviteMode" NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "assignee_id" UUID NOT NULL,
    "position" VARCHAR(40) NOT NULL,
    "notes" VARCHAR(500),
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_requests" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "requester_shift_id" UUID NOT NULL,
    "target_shift_id" UUID NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'REQUESTED',
    "decided_by" UUID,
    "reason" VARCHAR(280),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "actor_id" UUID NOT NULL,
    "subject_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "plan" "Plan" NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "SubStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "period_number" INTEGER NOT NULL DEFAULT 0,
    "pending_plan" "Plan",
    "pending_seats" INTEGER,
    "grace_ends_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "plan" "Plan" NOT NULL,
    "seats" INTEGER NOT NULL,
    "period_number" INTEGER NOT NULL,
    "days_left" INTEGER,
    "tx_ref" TEXT,
    "corrects_entry_id" UUID,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID,
    "tx_ref" TEXT NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "target_plan" "Plan" NOT NULL,
    "target_seats" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "charge_currency" CHAR(3) NOT NULL,
    "charge_amount" INTEGER NOT NULL,
    "fx_rate" DECIMAL(12,4),
    "status" "AttemptStatus" NOT NULL DEFAULT 'CREATED',
    "flw_transaction_id" TEXT,
    "checkout_url" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "card_token" TEXT NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "brand" VARCHAR(20) NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_kind_idx" ON "auth_tokens"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "devices_expo_push_token_key" ON "devices"("expo_push_token");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "webhook_events_tx_ref_idx" ON "webhook_events"("tx_ref");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE INDEX "notification_log_user_id_created_at_idx" ON "notification_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "memberships_team_id_status_idx" ON "memberships"("team_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_team_id_user_id_key" ON "memberships"("team_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_team_id_status_idx" ON "invites"("team_id", "status");

-- CreateIndex
CREATE INDEX "shifts_team_id_starts_at_idx" ON "shifts"("team_id", "starts_at");

-- CreateIndex
CREATE INDEX "shifts_team_id_assignee_id_starts_at_idx" ON "shifts"("team_id", "assignee_id", "starts_at");

-- CreateIndex
CREATE INDEX "swap_requests_team_id_status_idx" ON "swap_requests"("team_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_team_id_key" ON "subscriptions"("team_id");

-- CreateIndex
CREATE INDEX "ledger_entries_team_id_created_at_idx" ON "ledger_entries"("team_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_tx_ref_key" ON "payment_attempts"("tx_ref");

-- CreateIndex
CREATE INDEX "payment_attempts_team_id_created_at_idx" ON "payment_attempts"("team_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_attempts_team_id_status_idx" ON "payment_attempts"("team_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_team_id_key" ON "payment_methods"("team_id");

-- CreateIndex
CREATE INDEX "outbox_events_sent_at_created_at_idx" ON "outbox_events"("sent_at", "created_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_team_id_assignee_id_fkey" FOREIGN KEY ("team_id", "assignee_id") REFERENCES "memberships"("team_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requester_shift_id_fkey" FOREIGN KEY ("requester_shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_target_shift_id_fkey" FOREIGN KEY ("target_shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_corrects_entry_id_fkey" FOREIGN KEY ("corrects_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =========================================================================
-- Raw SQL from PRD Section 9: Custom Constraints, Functions, & Triggers
-- =========================================================================

-- 1. Overlap safety net (PRD 9, lines 751-753):
-- Deferred so a swap's two updates are checked together at commit
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_no_overlap" EXCLUDE USING gist
  ("team_id" WITH =, "assignee_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) DEFERRABLE INITIALLY DEFERRED;

-- 2. Partial unique indexes on swap_requests (PRD 9, lines 776-777):
-- One open swap per shift
CREATE UNIQUE INDEX "one_open_swap_req" ON "swap_requests" ("requester_shift_id") WHERE "status" IN ('REQUESTED', 'ACCEPTED');
CREATE UNIQUE INDEX "one_open_swap_tgt" ON "swap_requests" ("target_shift_id") WHERE "status" IN ('REQUESTED', 'ACCEPTED');

-- 3. Quiet hours check constraint on user_settings (PRD 9, lines 622-623):
ALTER TABLE "user_settings" ADD CONSTRAINT "quiet_hours_pair"
  CHECK (("quiet_hours_start" IS NULL) = ("quiet_hours_end" IS NULL));

-- 4. One open attempt per clinic on payment_attempts (PRD 9, lines 854-856):
CREATE UNIQUE INDEX "one_pending_attempt" ON "payment_attempts" ("team_id")
  WHERE "status" IN ('CREATED', 'PENDING') AND "reason" <> 'renewal';

-- 5. Ledger append-only trigger (PRD 9, lines 528 & PRD 11.6):
CREATE OR REPLACE FUNCTION block_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_ledger_updates_deletes
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW
  EXECUTE FUNCTION block_ledger_mutation();

-- NOTE: activities_feed_idx is intentionally omitted in this initial migration per PRD 9 and PRD 18.
-- It will be added in migration 0005 after the "before" EXPLAIN ANALYZE query plan is captured:
-- CREATE INDEX CONCURRENTLY activities_feed_idx ON activities (team_id, created_at DESC, id DESC);
