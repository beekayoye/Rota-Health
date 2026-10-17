# Rota Health

> Shift scheduling for clinics that never close.

- **Deployed backend:** `<placeholder URL>`
- **Android build:** `<placeholder link>`

---

## About Rota Health

Rota Health is an Android shift scheduling application designed specifically for small clinics with 5 to 40 shift workers. It delivers:
- **One trusted shift schedule:** Clash prevention, timezone-aware ISO calendar views, and draft/publish workflows.
- **Approved swaps:** 1-on-1 shift swaps with manager approval.
- **Sleep-respecting alerts:** Quiet hours algorithm delaying non-urgent push notifications until wake hours.
- **Offline shift access:** Secure local cache with encrypted MMKV for offline reliability.
- **Fair per-seat billing:** Seat-based pricing with exact day-prorated charges on mid-cycle changes.

---

## 🚀 Run It Yourself

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker (optional, for local PostgreSQL / Redis) or hosted Supabase PostgreSQL + Upstash Redis instances.

### 1. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` inside `server/` (and root if applicable) and configure:
```bash
DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres?sslmode=require"
DIRECT_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres?sslmode=require"
UPSTASH_REDIS_REST_URL="https://[cluster].upstash.io"
UPSTASH_REDIS_REST_TOKEN="[token]"
JWT_SECRET="super-secret-key-32-chars-long"
PUBLIC_BASE_URL="http://localhost:3000"
PORT=3000
```

### 3. Run Migrations & Seed Data
```bash
# Apply Prisma migrations
npm run db:migrate --workspace=server

# Seed demo clinic (Grace Point with 5 staff members)
npx tsx scripts/seed-demo.ts
```

### 4. Start Development Services
Run the API server:
```bash
npm run dev:server
```

Run the background worker (outbox relay & notifications):
```bash
npm run dev:worker
```

Start the Expo mobile application:
```bash
npm run dev:app
```

### 5. Run Tests
```bash
# Server test suite
npm test --workspace=server

# App unit tests
npm test --workspace=app

# Smoke test against running backend
npx tsx scripts/smoke.ts http://localhost:3000
```
