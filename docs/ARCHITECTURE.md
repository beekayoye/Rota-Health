# System Architecture — Rota Health

## 1. High-Level Architecture Overview

Rota Health is built as a modular monorepo consisting of a React Native (Expo) mobile client, an Express API server, and a BullMQ background worker service.

```
                           +------------------------+
                           |  Expo Mobile App (APK) |
                           +-----------+------------+
                                       |
                                HTTPS (TLS)
                                       |
                                       v
                           +------------------------+
                           | Railway API Service    |
                           | (Express / Node.js)    |
                           +-----+------------+-----+
                                 |            |
                                 |         Outbox Events
                                 |            |
                                 v            v
                      +------------------+  +----------------------+
                      | Supabase Postgres|  | Upstash Redis Queue  |
                      +------------------+  +----------+-----------+
                                 ^                     ^
                                 |                     |
                                 +----------+----------+
                                            |
                              +-------------+--------------+
                              | Railway Worker Service     |
                              | (Outbox Relay & BullMQ)    |
                              +-------------+--------------+
                                            |
                                  Expo Push Notifications
                                            |
                                            v
                                 +--------------------+
                                 | Mobile Device FCM  |
                                 +--------------------+
```

---

## 2. Core Components

### 2.1 Mobile Application (`/app`)
- **Framework:** React Native with Expo Router.
- **State Management:** TanStack Query for server cache, Zustand for local client state.
- **Storage:** `react-native-mmkv` with AES encryption for offline shifts; `expo-secure-store` for tokens and device identifiers.
- **Security:** Zero client-side secrets; only the 4 allowed `EXPO_PUBLIC_*` configuration variables.

### 2.2 API Server (`/server`)
- **Framework:** Express with Zod strict validation.
- **Isolation:** Multi-tenant team isolation enforced on every route.
- **Idempotency:** UUID v4 idempotency keys with distributed lock protection.
- **Side Effects:** Handlers write `outbox_events` rows within the transactional boundary rather than calling external services directly.

### 2.3 Background Worker (`/server/src/workers`)
- **Outbox Relay:** Polling interval (2s) streaming outbox events to BullMQ via `queue.addBulk()`.
- **Notification Worker:** Handles quiet hours calculation and pushes alerts through Expo Push SDK.

---

## 3. Deployment

### 3.1 Railway Services Architecture
The backend is deployed to Railway as two decoupled services sourced from the same repository:
1. **API Service (`api`)**:
   - **Root Directory:** `server`
   - **Build Command:** `npm run build` (`prisma generate && tsc`)
   - **Pre-deploy Command:** `npm run db:migrate:deploy` (`prisma migrate deploy`)
   - **Start Command:** `npm run start:api` (`node dist/index.js`)
   - **Healthcheck Path:** `/v1/healthz`
   - **Proxy Configuration:** `app.set("trust proxy", 1)` enabled to resolve real client IPs through Railway's proxy layer.

2. **Worker Service (`worker`)**:
   - **Root Directory:** `server`
   - **Build Command:** `npm run build` (`prisma generate && tsc`)
   - **Start Command:** `npm run start:worker` (`node dist/worker.js`)
   - **Pre-deploy Command:** None (migrations are exclusively executed by the API service).

### 3.2 Database Migrations (Pre-Deploy)
To guarantee zero-downtime schema evolution and prevent race conditions between workers and APIs:
- Only the `api` service runs migrations as a pre-deploy phase before traffic is switched.
- The `worker` service never executes migrations.

### 3.3 Keepalive Workflow (Supabase Persistence)
To prevent the Supabase PostgreSQL database from sleeping due to project inactivity:
- A GitHub Actions workflow (`.github/workflows/keepalive.yml`) is scheduled to run every 12 hours (and supports manual triggers via `workflow_dispatch`).
- The job issues an HTTP GET request to `/v1/healthz` using the repository secret `API_HEALTH_URL`. Non-200 responses fail the workflow and notify repository maintainers.

### 3.4 Graceful Shutdown
Both the API and Worker processes listen for `SIGTERM` and `SIGINT`:
- **API Service:** Stops accepting new connections (`server.close()`), flushes ongoing in-flight requests, disconnects Prisma and Redis clients, with an unconditional process exit after a 10-second deadline.
- **Worker Service:** Stops the outbox polling interval, pauses BullMQ workers and closes active queue connections, disconnects Prisma and Redis, with an unconditional exit after a 10-second deadline.
