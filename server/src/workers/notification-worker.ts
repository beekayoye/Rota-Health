import { Worker, Job } from 'bullmq';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { decideDelivery } from './quiet-hours.js';
import { notificationsQueue, pushReceiptsQueue } from './outbox-relay.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: redisUrl };

// Global Expo client instance, allows test override
let expoClient = new Expo();

export function setExpoClient(client: any): void {
  expoClient = client;
}

export function getExpoClient(): Expo {
  return expoClient;
}

export interface NotifyJobData {
  type: string;
  refId: string;
  teamId: string;
  userIds: string[];
  version: number;
  requestId?: string;
  startsAt?: string;
}

export interface NotifyUserJobData {
  type: string;
  refId: string;
  teamId: string;
  userId: string;
  version: number;
  requestId?: string;
  startsAt?: string;
}

function getDeepLink(type: string, refId: string): string {
  if (type === 'shift.published' || type === 'shift.updated') {
    return `rotahealth://shifts/${refId}`;
  }
  if (type === 'shift.deleted') {
    return 'rotahealth://calendar';
  }
  if (type.startsWith('swap.')) {
    return `rotahealth://swaps/${refId}`;
  }
  if (type.startsWith('billing.')) {
    return 'rotahealth://billing';
  }
  return 'rotahealth://home';
}

function getNotificationGroup(type: string): 'shifts' | 'swaps' | 'billing' {
  if (type.startsWith('shift.')) return 'shifts';
  if (type.startsWith('swap.')) return 'swaps';
  return 'billing';
}

function getNotificationBody(type: string, teamName: string): string {
  switch (type) {
    case 'shift.published':
      return 'A new shift has been published for you.';
    case 'shift.updated':
      return 'Your shift details have been updated.';
    case 'shift.deleted':
      return 'A shift on your schedule was removed.';
    case 'swap.requested':
      return 'A colleague has proposed a shift swap with you.';
    case 'swap.accepted':
      return 'A shift swap was accepted and is awaiting manager approval.';
    case 'swap.decided':
      return 'A swap request decision has been recorded.';
    default:
      return 'You have a new update from Rota Health.';
  }
}

/**
 * BullMQ Worker for the 'notifications' queue (PRD 12.3, 16.7).
 * Sets drainDelay 30s and stalledInterval 60s per PRD 22 risk 2 to prevent Upstash free tier command exhaustion.
 */
export function createNotificationWorker(): Worker {
  // PRD 22 risk 2: drainDelay 30s and stalledInterval 60s to reduce Upstash free tier command usage
  const worker = new Worker(
    'notifications',
    async (job: Job) => {
      const startTime = Date.now();
      const requestId = job.data?.requestId;
      const teamId = job.data?.teamId;
      const userId = job.data?.userId;

      try {
        if (job.name === 'notify') {
          // Fan out one notify-user job per recipient (PRD 12.3)
          const data = job.data as NotifyJobData;
          for (const uid of data.userIds) {
            const userJobId = `${data.type}__${data.refId}__${uid}__${data.version}`;
            await notificationsQueue.add(
              'notify-user',
              {
                type: data.type,
                refId: data.refId,
                teamId: data.teamId,
                userId: uid,
                version: data.version,
                requestId: data.requestId,
                startsAt: data.startsAt,
              },
              {
                jobId: userJobId,
                attempts: 5,
                backoff: {
                  type: 'exponential',
                  delay: 5000,
                },
                removeOnComplete: { age: 86400 },
              },
            );
          }

          logger.info({
            ts: new Date().toISOString(),
            queue: 'notifications',
            jobName: job.name,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            durationMs: Date.now() - startTime,
            result: 'ok',
            teamId,
            requestId,
          }, 'Fan-out notify job complete');
          return;
        }

        if (job.name === 'notify-user') {
          const data = job.data as NotifyUserJobData;
          const now = DateTime.utc();
          const nowJs = now.toJSDate();

          // 1. Check if the entity still exists (PRD 12.2 skipped_stale)
          let isUrgent = false;
          const group = getNotificationGroup(data.type);

          if (data.type === 'shift.published' || data.type === 'shift.updated') {
            const shift = await prisma.shift.findUnique({
              where: { id: data.refId },
            });
            if (!shift) {
              await prisma.notificationLog.create({
                data: {
                  userId: data.userId,
                  teamId: data.teamId,
                  kind: data.type,
                  urgent: false,
                  status: 'skipped_stale',
                },
              });
              logger.info({ jobId: job.id, refId: data.refId }, 'Shift no longer exists: skipped_stale');
              return;
            }
            // Urgent when shift starts within 12 h (PRD 12.1)
            const diffHours = shift.startsAt.getTime() - nowJs.getTime();
            isUrgent = diffHours <= 12 * 3600 * 1000 && diffHours >= 0;
          } else if (data.type === 'shift.deleted') {
            if (data.startsAt) {
              const startsAtDate = new Date(data.startsAt);
              const diffHours = startsAtDate.getTime() - nowJs.getTime();
              isUrgent = diffHours <= 12 * 3600 * 1000;
            }
          } else if (data.type.startsWith('swap.')) {
            const swap = await prisma.swapRequest.findUnique({
              where: { id: data.refId },
              include: {
                requesterShift: true,
                targetShift: true,
              },
            });
            if (!swap) {
              await prisma.notificationLog.create({
                data: {
                  userId: data.userId,
                  teamId: data.teamId,
                  kind: data.type,
                  urgent: false,
                  status: 'skipped_stale',
                },
              });
              logger.info({ jobId: job.id, refId: data.refId }, 'Swap no longer exists: skipped_stale');
              return;
            }
            // Earlier shift starts within 12 h (PRD 12.1)
            const s1 = swap.requesterShift.startsAt.getTime();
            const s2 = swap.targetShift.startsAt.getTime();
            const earlier = Math.min(s1, s2);
            isUrgent = earlier - nowJs.getTime() <= 12 * 3600 * 1000 && earlier - nowJs.getTime() >= 0;
          }

          // 2. Read settings from primary DB (PRD 12.2, 16.2)
          const settings = await prisma.userSettings.findUnique({
            where: { userId: data.userId },
          });

          // Mandatory flag for billing failures to Owner
          const isMandatory =
            data.type === 'billing.payment_failed' ||
            data.type === 'billing.grace_reminder' ||
            data.type === 'billing.restricted';

          // 3. Decide delivery
          const decision = decideDelivery(
            settings,
            { group, urgent: isUrgent, mandatory: isMandatory },
            now,
          );

          if (decision.action === 'SKIP') {
            await prisma.notificationLog.create({
              data: {
                userId: data.userId,
                teamId: data.teamId,
                kind: data.type,
                urgent: isUrgent,
                status: 'skipped_pref',
              },
            });
            logger.info({
              ts: new Date().toISOString(),
              queue: 'notifications',
              jobName: job.name,
              jobId: job.id,
              attempt: job.attemptsMade + 1,
              durationMs: Date.now() - startTime,
              result: 'skipped_pref',
              teamId,
              userId,
              requestId,
            }, 'Notification skipped by user preferences');
            return;
          }

          if (decision.action === 'DELAY') {
            await prisma.notificationLog.create({
              data: {
                userId: data.userId,
                teamId: data.teamId,
                kind: data.type,
                urgent: isUrgent,
                status: 'delayed',
              },
            });

            const delayMs = Math.max(1000, decision.releaseAt.getTime() - Date.now());
            // BullMQ ignores a new job whose jobId already exists. When notify-user returns DELAY,
            // it must not re-add itself with the same jobId.
            // We choose adding a new job with jobId = <original>__delayed__<releaseAt epoch ms>
            // rather than job.moveToDelayed(releaseAt) because:
            // 1. job.moveToDelayed requires acquiring and coordinating BullMQ worker tokens, which can
            //    cause concurrency races or unhandled rejections if the token expires or worker stalls.
            // 2. Creating a discrete delayed job with a release timestamp makes delayed jobs explicitly observable,
            //    cleanly tracked in BullMQ queues/dashboards, and allows the current job to complete successfully.
            const originalJobId = job.id ? job.id.split('__delayed__')[0] : `${data.type}__${data.refId}__${data.userId}__${data.version}`;
            const delayedJobId = `${originalJobId}__delayed__${decision.releaseAt.getTime()}`;

            await notificationsQueue.add(
              'notify-user',
              {
                ...data,
              },
              {
                delay: delayMs,
                jobId: delayedJobId,
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 86400 },
              },
            );

            logger.info({
              ts: new Date().toISOString(),
              queue: 'notifications',
              jobName: job.name,
              jobId: job.id,
              attempt: job.attemptsMade + 1,
              durationMs: Date.now() - startTime,
              result: 'delayed',
              releaseAt: decision.releaseAt.toISOString(),
              teamId,
              userId,
              requestId,
            }, 'Notification delayed for quiet hours');
            return;
          }

          // 4. SEND_NOW
          const devices = await prisma.device.findMany({
            where: { userId: data.userId },
          });

          if (devices.length === 0) {
            await prisma.notificationLog.create({
              data: {
                userId: data.userId,
                teamId: data.teamId,
                kind: data.type,
                urgent: isUrgent,
                status: 'sent',
                ticketId: null,
              },
            });
            logger.info({ userId: data.userId }, 'No devices registered for user: marked sent');
            return;
          }

          const team = await prisma.team.findUnique({
            where: { id: data.teamId },
            select: { name: true },
          });
          const teamName = team?.name || 'Rota Health';

          const messages: ExpoPushMessage[] = [];
          for (const dev of devices) {
            if (!dev.expoPushToken || !Expo.isExpoPushToken(dev.expoPushToken as any)) {
              continue;
            }
            messages.push({
              to: dev.expoPushToken,
              sound: 'default',
              title: `${teamName}`,
              body: getNotificationBody(data.type, teamName),
              data: {
                url: getDeepLink(data.type, data.refId),
                teamId: data.teamId,
              },
              channelId: group,
              priority: isUrgent ? 'high' : 'default',
            });
          }

          if (messages.length === 0) {
            return;
          }

          const chunks = expoClient.chunkPushNotifications(messages);
          const tickets: ExpoPushTicket[] = [];

          for (const chunk of chunks) {
            try {
              const ticketChunk = await expoClient.sendPushNotificationsAsync(chunk);
              tickets.push(...ticketChunk);

              for (let i = 0; i < ticketChunk.length; i++) {
                const ticket = ticketChunk[i];
                const msg = chunk[i];

                if (ticket.status === 'error') {
                  // PRD 12.5 Token cleanup: DeviceNotRegistered deletes that devices row
                  if (ticket.details?.error === 'DeviceNotRegistered') {
                    await prisma.device.deleteMany({
                      where: { expoPushToken: msg.to as string },
                    });
                    logger.warn({ token: msg.to }, 'DeviceNotRegistered: deleted device token');
                  }

                  // Retry on Expo 429 or 5xx only
                  const isRetryable =
                    (ticket as any).status === 429 ||
                    ((ticket as any).status >= 500 && (ticket as any).status < 600);
                  if (isRetryable) {
                    throw new Error(`Expo transient delivery error: ${ticket.message}`);
                  }
                } else if (ticket.status === 'ok') {
                  await prisma.notificationLog.create({
                    data: {
                      userId: data.userId,
                      teamId: data.teamId,
                      kind: data.type,
                      urgent: isUrgent,
                      status: 'sent',
                      ticketId: ticket.id,
                    },
                  });
                }
              }
            } catch (err: any) {
              logger.error({ err }, 'Error sending chunk to Expo push service');
              throw err;
            }
          }

          // Enqueue push-receipts job with 15-minute delay (PRD 12.3)
          const validTicketIds = tickets
            .filter((t): t is { status: 'ok'; id: string } => t.status === 'ok' && !!t.id)
            .map((t) => t.id);

          if (validTicketIds.length > 0) {
            await pushReceiptsQueue.add(
              'check-receipts',
              { ticketIds: validTicketIds },
              { delay: 15 * 60 * 1000 },
            );
          }

          logger.info({
            ts: new Date().toISOString(),
            queue: 'notifications',
            jobName: job.name,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            durationMs: Date.now() - startTime,
            result: 'ok',
            teamId,
            userId,
            requestId,
          }, 'Push notification delivered to Expo service');
        }
      } catch (err: any) {
        logger.error({
          ts: new Date().toISOString(),
          queue: 'notifications',
          jobName: job.name,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          durationMs: Date.now() - startTime,
          result: 'error',
          error: err?.message,
          teamId,
          userId,
          requestId,
        }, 'Notification job attempt failed');
        throw err;
      }
    },
    {
      connection,
      concurrency: 10,
      drainDelay: 30, // 30 seconds
      stalledInterval: 60000, // 60 seconds
    },
  );

  return worker;
}

/**
 * BullMQ Worker for the 'push-receipts' queue (PRD 12.3, 12.5).
 */
export function createPushReceiptsWorker(): Worker {
  const worker = new Worker(
    'push-receipts',
    async (job: Job<{ ticketIds: string[] }>) => {
      const { ticketIds } = job.data;
      if (!ticketIds || ticketIds.length === 0) return;

      try {
        const receiptIdChunks = expoClient.chunkPushNotificationReceiptIds(ticketIds);
        for (const chunk of receiptIdChunks) {
          const receipts = await expoClient.getPushNotificationReceiptsAsync(chunk);

          for (const receiptId in receipts) {
            const receipt = receipts[receiptId];
            if (receipt.status === 'error') {
              if (receipt.details?.error === 'DeviceNotRegistered') {
                // Find ticket in notification_log and delete device
                const logEntry = await prisma.notificationLog.findFirst({
                  where: { ticketId: receiptId },
                });
                if (logEntry) {
                  await prisma.device.deleteMany({
                    where: { userId: logEntry.userId },
                  });
                  logger.warn({ userId: logEntry.userId }, 'DeviceNotRegistered receipt: cleaned up devices');
                }
              }
            }
          }
        }
      } catch (err: any) {
        logger.error({ err }, 'Error retrieving push notification receipts from Expo');
        throw err;
      }
    },
    {
      connection,
      concurrency: 2,
      drainDelay: 30,
      stalledInterval: 60000,
    },
  );

  return worker;
}
