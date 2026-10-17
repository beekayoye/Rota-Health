# Day 1 Deployment Scope — Rota Health

## Overview
Rota Health is an Android shift scheduling application for clinics with 5 to 40 shift workers. This document details the Day 1 deployment scope, system components, and operational boundaries currently running in production.

---

## What is Deployed

### 1. Backend API Service (`api`)
- **Runtime:** Node.js 20+ on Railway.
- **Framework:** Express with TypeScript (compiled to `dist/index.js`).
- **Proxy Configuration:** `app.set("trust proxy", 1)` for Railway ingress IP resolution.
- **Health Check:** `GET /v1/healthz` responding with `{ status: "ok", timestamp: ... }`.
- **Database Migrations:** Executed via Railway pre-deploy command (`npm run db:migrate:deploy`).
- **Graceful Shutdown:** Intercepts `SIGTERM` and `SIGINT`, stops accepting HTTP connections, disconnects Prisma and Redis with a 10-second fail-safe timeout.

### 2. Backend Worker Service (`worker`)
- **Runtime:** Node.js 20+ on Railway.
- **Entry Point:** `dist/worker.js`.
- **Outbox Relay:** 
  - Runs on a 2-second interval (`setInterval`).
  - Fetches unsent events (`LIMIT 100`) using `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction with a 15-second timeout.
  - Enqueues jobs using BullMQ `queue.addBulk()` with deterministic `jobId = outbox_row_id`.
  - Marks rows with `sent_at = NOW()` inside the transaction.
- **Push Notification Worker:**
  - Consumes the `notifications` queue.
  - Evaluates recipient Quiet Hours in the clinic's local timezone.
  - Urgent alerts (swaps, updates) sent immediately; non-urgent alerts during quiet hours rescheduled via delayed jobs (`__delayed__<releaseAt>`).
- **Graceful Shutdown:** Clears outbox intervals, closes BullMQ workers and queues, disconnects Prisma and Redis within 10 seconds.

### 3. Database & Caching
- **PostgreSQL Database:** Supabase PostgreSQL instance.
- **Redis:** Upstash Redis for BullMQ queues and rate limiting.
- **Single Database Mode:** Team isolation enforced using `forTeam` scoping and middleware; sharding directories (`team_directory`) bypassed for single-instance efficiency.
- **Keepalive Workflow:** GitHub Actions workflow (`.github/workflows/keepalive.yml`) runs every 12 hours (and on manual trigger) against `/v1/healthz` to prevent Supabase inactivity pausing.

### 4. Feature Coverage
- **Authentication:** Device registration, access token (JWT), refresh token rotation, device ID binding.
- **Team Management:** Team creation, roles (Owner, Manager, Staff), invite links using `PUBLIC_BASE_URL`.
- **Shift Scheduling:**
  - Draft, edit, delete, and publish shifts.
  - Overlap prevention algorithm within clinics.
  - Timezone-aware ISO week calculations via Luxon.
- **Shift Swaps:**
  - Direct 1-to-1 swap requests, acceptance, manager approval, rejection, and cancellation.
  - State machine with optimistic concurrency control.
- **Billing & Proration:**
  - Plans: Starter ($20/mo, 5 seats) and Team ($45/mo, 15 seats).
  - Seat-based proration algorithm (`prorate()` in `server/src/billing/proration.ts`).
  - Immutable `ledger_entries` audit trail.
- **Activity Feed:** Cursor-based paginated audit feed (`GET /v1/teams/:teamId/activity`).
- **Smoke Testing:** Automated verification script (`scripts/smoke.ts`) for health, auth, shifts, and activity.

### 5. Mobile App (Android Preview Build)
- **Framework:** React Native with Expo (SDK 52) and Expo Router.
- **Profile:** EAS `preview` profile building a standalone APK for internal distribution.
- **Configuration:** Clean client bundle exposing only the 4 allowed public variables (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_EAS_PROJECT_ID`).
