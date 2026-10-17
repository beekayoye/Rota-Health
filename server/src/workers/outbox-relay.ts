import { Queue } from 'bullmq';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

const connection = { url: config.REDIS_URL };

export const notificationsQueue = new Queue('notifications', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const pushReceiptsQueue = new Queue('push-receipts', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 7 * 86400 },
  },
});

let isRelayRunning = false;

/**
 * Runs one cycle of the outbox relay.
 * Selects unsent rows FOR UPDATE SKIP LOCKED, LIMIT 200, enqueues to BullMQ with jobId = outbox id,
 * and marks sent_at in the same database operation.
 * (PRD 12.3)
 */
export async function runOutboxRelayOnce(): Promise<number> {
  // Use raw SQL with FOR UPDATE SKIP LOCKED to prevent concurrent relay races across shards/workers.
  // The SELECT ... FOR UPDATE SKIP LOCKED, the enqueues, and the sent_at update all happen
  // inside ONE transaction, so row locks are held until sent_at is written.
  return await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; team_id: string; kind: string; payload: any }>>`
        SELECT id, team_id, kind, payload
        FROM outbox_events
        WHERE sent_at IS NULL
        ORDER BY created_at ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return 0;
      }

      const notifyJobs = rows
        .filter((r) => r.kind === 'notify')
        .map((r) => ({
          name: 'notify',
          data: r.payload,
          opts: {
            jobId: r.id,
            removeOnComplete: { age: 86400 },
          },
        }));

      if (notifyJobs.length > 0) {
        await notificationsQueue.addBulk(notifyJobs);
      }

      const rowIds = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE outbox_events
        SET sent_at = NOW()
        WHERE id = ANY(${rowIds}::uuid[])
      `;

      return rows.length;
    },
    {
      timeout: 15000,
      maxWait: 5000,
    },
  );
}

/**
 * Starts the continuous outbox relay runner.
 * Runs every 2 seconds via setInterval (NOT a BullMQ repeatable job to save Redis commands on Upstash free tier - PRD 22 risk 2).
 */
export function startOutboxRelay(): NodeJS.Timeout {
  logger.info('Starting transactional outbox relay (2s interval)...');

  const timer = setInterval(async () => {
    if (isRelayRunning) return;
    isRelayRunning = true;
    try {
      await runOutboxRelayOnce();
    } catch (err: any) {
      logger.error({ err }, 'Error in outbox relay cycle');
    } finally {
      isRelayRunning = false;
    }
  }, 2000);

  return timer;
}
