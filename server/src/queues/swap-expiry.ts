import { Queue, Worker, Job } from 'bullmq';
import { prisma } from '../db/prisma.js';
import pino from 'pino';

const logger = pino({ name: 'swap-expiry' });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: redisUrl };

export const swapExpiryQueue = new Queue('swap-expiry', {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

export async function expireSwapIfDue(swapId: string): Promise<boolean> {
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: {
      requesterShift: true,
      targetShift: true,
    },
  });

  if (!swap) return false;

  // Only expire if not yet approved/decided
  if (swap.status === 'REQUESTED' || swap.status === 'ACCEPTED') {
    await prisma.$transaction(async (tx) => {
      await tx.swapRequest.update({
        where: { id: swapId },
        data: {
          status: 'EXPIRED',
          reason: 'SWAP_EXPIRED_TIME_LIMIT',
        },
      });

      await tx.activity.create({
        data: {
          teamId: swap.teamId,
          type: 'swap.expired',
          actorId: swap.requesterId,
          subjectId: swap.id,
          payload: {
            actorName: 'System',
            summary: 'Swap request expired due to shift start time',
            subjectType: 'swap',
            swapId: swap.id,
            reason: 'SWAP_EXPIRED_TIME_LIMIT',
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          teamId: swap.teamId,
          kind: 'notify',
          payload: {
            type: 'swap.decided',
            refId: swap.id,
            teamId: swap.teamId,
            userIds: [swap.requesterId, swap.targetUserId],
            version: 3,
            requestId: crypto.randomUUID(),
          },
        },
      });
    });

    logger.info({ swapId }, `Swap ${swapId} expired due to shift start time`);
    return true;
  }

  return false;
}

export async function scheduleSwapExpiry(swapId: string, earliestStartsAt: Date): Promise<void> {
  const delay = Math.max(0, earliestStartsAt.getTime() - Date.now());
  try {
    await swapExpiryQueue.add(
      'expire',
      { swapId },
      {
        delay,
        jobId: `swap-expiry-${swapId}`,
      },
    );
  } catch (err) {
    logger.warn({ err, swapId }, 'Could not schedule BullMQ swap-expiry job (redis down or testing)');
  }
}

// Worker definition for processing delayed swap expiry
export function createSwapExpiryWorker(): Worker {
  return new Worker(
    'swap-expiry',
    async (job: Job<{ swapId: string }>) => {
      await expireSwapIfDue(job.data.swapId);
    },
    { connection },
  );
}
