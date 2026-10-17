import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';

const targetBaseUrl = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';
const baseUrl = targetBaseUrl.replace(/\/+$/, '');

const DEMO_EMAIL = 'halima@gracepoint.ng';
const DEMO_PASSWORD = 'Password123!';

interface StepResult {
  name: string;
  passed: boolean;
  message?: string;
}

const results: StepResult[] = [];

function recordResult(name: string, passed: boolean, message?: string) {
  results.push({ name, passed, message });
  const prefix = passed ? '✅ [PASS]' : '❌ [FAIL]';
  const detail = message ? ` - ${message}` : '';
  console.log(`${prefix} ${name}${detail}`);
}

async function runSmokeTest() {
  console.log(`\n========================================`);
  console.log(`Rota Health Smoke Test`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Time:   ${new Date().toISOString()}`);
  console.log(`========================================\n`);

  let accessToken: string | null = null;
  let teamId: string | null = null;

  // 1. Health check: GET /v1/healthz
  try {
    const res = await fetch(`${baseUrl}/v1/healthz`);
    if (res.status === 200) {
      const data: any = await res.json();
      if (data.status === 'ok' && data.database === 'connected' && data.redis === 'connected') {
        recordResult('Health check', true, 'Database & Redis connected');
      } else {
        recordResult('Health check', false, `Status: ${data.status}, DB: ${data.database}, Redis: ${data.redis}`);
      }
    } else {
      recordResult('Health check', false, `HTTP status ${res.status}`);
    }
  } catch (err: any) {
    recordResult('Health check', false, `Connection error: ${err.message}`);
  }

  // 2. Login as Halima: POST /v1/auth/login
  try {
    const res = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        deviceId: randomUUID(),
      }),
    });

    if (res.status === 200) {
      const data: any = await res.json();
      if (data.accessToken) {
        accessToken = data.accessToken;
        // NEVER print tokens
        recordResult('Authentication', true, `Successfully authenticated as ${DEMO_EMAIL}`);
      } else {
        recordResult('Authentication', false, 'Missing accessToken in response');
      }
    } else {
      recordResult('Authentication', false, `Login failed with HTTP status ${res.status}`);
    }
  } catch (err: any) {
    recordResult('Authentication', false, `Request error: ${err.message}`);
  }

  // 3. Resolve Team ID: GET /v1/me
  if (accessToken) {
    try {
      const res = await fetch(`${baseUrl}/v1/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 200) {
        const data: any = await res.json();
        const clinics = data.clinics || [];
        const gracePoint = clinics.find((c: any) => c.name === 'Grace Point Clinic') || clinics[0];
        if (gracePoint?.id) {
          teamId = gracePoint.id;
          recordResult('Clinic Resolution', true, `Found ${gracePoint.name} (id: ${teamId})`);
        } else {
          recordResult('Clinic Resolution', false, 'No clinic memberships found for user');
        }
      } else {
        recordResult('Clinic Resolution', false, `GET /v1/me returned HTTP status ${res.status}`);
      }
    } catch (err: any) {
      recordResult('Clinic Resolution', false, `Request error: ${err.message}`);
    }
  }

  // 4. Fetch shifts for current week: GET /v1/teams/:teamId/shifts?weekStart=YYYY-MM-DD
  if (accessToken && teamId) {
    try {
      const nowLagos = DateTime.now().setZone('Africa/Lagos');
      const weekStart = nowLagos.startOf('week').toFormat('yyyy-MM-dd');

      const res = await fetch(`${baseUrl}/v1/teams/${teamId}/shifts?weekStart=${weekStart}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 200) {
        const data: any = await res.json();
        const shifts = data.shifts || [];
        recordResult('Shifts API', true, `Fetched ${shifts.length} shifts for week of ${weekStart}`);
      } else {
        recordResult('Shifts API', false, `GET shifts returned HTTP status ${res.status}`);
      }
    } catch (err: any) {
      recordResult('Shifts API', false, `Request error: ${err.message}`);
    }
  }

  // 5. Fetch first page of activity feed: GET /v1/teams/:teamId/activity
  if (accessToken && teamId) {
    try {
      const res = await fetch(`${baseUrl}/v1/teams/${teamId}/activity?limit=20`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 200) {
        const data: any = await res.json();
        const items = data.items || [];
        recordResult('Activity Feed API', true, `Fetched ${items.length} activity events on first page`);
      } else {
        recordResult('Activity Feed API', false, `GET activity returned HTTP status ${res.status}`);
      }
    } catch (err: any) {
      recordResult('Activity Feed API', false, `Request error: ${err.message}`);
    }
  }

  // Summary
  const allPassed = results.length === 5 && results.every((r) => r.passed);
  console.log(`\n========================================`);
  if (allPassed) {
    console.log(`🎉 ALL SMOKE TESTS PASSED (${results.length}/${results.length})`);
  } else {
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`⚠️ SMOKE TESTS FAILED (${passedCount}/${results.length} passed)`);
  }
  console.log(`========================================\n`);

  process.exit(allPassed ? 0 : 1);
}

runSmokeTest();
