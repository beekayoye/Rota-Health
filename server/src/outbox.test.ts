import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Expo } from 'expo-server-sdk';
import { app } from './index.js';
import { prisma } from './db/prisma.js';
import { runOutboxRelayOnce, notificationsQueue } from './workers/outbox-relay.js';
import {
  createNotificationWorker,
  getExpoClient,
  setExpoClient,
} from './workers/notification-worker.js';

describe('Transactional Outbox & Notifications (outbox.test.ts)', () => {
  let ownerToken: string;
  let ownerId: string;
  let staffToken: string;
  let staffId: string;
  let teamId: string;
  let deviceId: string;
  const pushToken = 'ExponentPushToken[test_token_12345]';

  beforeAll(async () => {
    // 1. Owner
    const ownerRes = await request(app).post('/v1/auth/register').send({
      email: `outbox_owner_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Owner Adaeze',
      deviceId: randomUUID(),
    });
    ownerToken = ownerRes.body.accessToken;
    ownerId = ownerRes.body.user.id;

    // 2. Staff
    deviceId = randomUUID();
    const staffRes = await request(app).post('/v1/auth/register').send({
      email: `outbox_staff_${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Staff Emeka',
      deviceId,
    });
    staffToken = staffRes.body.accessToken;
    staffId = staffRes.body.user.id;

    // 3. Create Team
    const teamRes = await request(app)
      .post('/v1/teams')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Outbox Test Clinic',
        timeZone: 'Africa/Lagos',
      });
    expect(teamRes.status).toBe(201);
    teamId = teamRes.body.team.id;

    // 4. Add Staff membership
    await prisma.membership.create({
      data: {
        teamId,
        userId: staffId,
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });

    // 5. Register device for staff
    await request(app)
      .put(`/v1/me/devices/${deviceId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        expoPushToken: pushToken,
        platform: 'android',
      });
  });

  afterAll(async () => {
    setExpoClient(new Expo());
    if (teamId) {
      await prisma.outboxEvent.deleteMany({ where: { teamId } });
      await prisma.shift.deleteMany({ where: { teamId } });
      await prisma.activity.deleteMany({ where: { teamId } });
      await prisma.membership.deleteMany({ where: { teamId } });
      await prisma.subscription.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
    }
    if (staffId) {
      await prisma.device.deleteMany({ where: { userId: staffId } });
      await prisma.notificationLog.deleteMany({ where: { userId: staffId } });
    }
  });

  it('1. Shift publish writes outbox rows in the same transaction as the shifts', async () => {
    // Create draft shift
    const startsAt = new Date(Date.now() + 48 * 3600 * 1000);
    const endsAt = new Date(startsAt.getTime() + 8 * 3600 * 1000);

    const shift = await prisma.shift.create({
      data: {
        teamId,
        assigneeId: staffId,
        position: 'Nurse',
        startsAt,
        endsAt,
        status: 'DRAFT',
        createdBy: ownerId,
      },
    });

    const res = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ shiftIds: [shift.id] });

    expect(res.status).toBe(200);

    // Verify outbox row exists
    const outboxRow = await prisma.outboxEvent.findFirst({
      where: {
        teamId,
        kind: 'notify',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(outboxRow).not.toBeNull();
    const payload = outboxRow!.payload as any;
    expect(payload.type).toBe('shift.published');
    expect(payload.refId).toBe(shift.id);
    expect(payload.userIds).toContain(staffId);
    expect(outboxRow!.sentAt).toBeNull();
  });

  it('2. Publish HTTP response returns without any call to the Expo client (spied on)', async () => {
    const expo = getExpoClient();
    const sendSpy = vi.spyOn(expo, 'sendPushNotificationsAsync');

    const startsAt = new Date(Date.now() + 72 * 3600 * 1000);
    const endsAt = new Date(startsAt.getTime() + 8 * 3600 * 1000);

    const shift = await prisma.shift.create({
      data: {
        teamId,
        assigneeId: staffId,
        position: 'Doctor',
        startsAt,
        endsAt,
        status: 'DRAFT',
        createdBy: ownerId,
      },
    });

    const res = await request(app)
      .post(`/v1/teams/${teamId}/shifts/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ shiftIds: [shift.id] });

    expect(res.status).toBe(200);
    // Spying on Expo client guarantees handler never called Expo in-process
    expect(sendSpy).not.toHaveBeenCalled();

    sendSpy.mockRestore();
  });

  it('3. If process stops before relay runs, next relay run enqueues and marks sent_at', async () => {
    // Find unsent outbox row
    const unsentRow = await prisma.outboxEvent.findFirst({
      where: { teamId, sentAt: null },
    });
    expect(unsentRow).not.toBeNull();

    // Run outbox relay
    const processed = await runOutboxRelayOnce();
    expect(processed).toBeGreaterThan(0);

    // Verify sent_at was set
    const updatedRow = await prisma.outboxEvent.findUnique({
      where: { id: unsentRow!.id },
    });
    expect(updatedRow?.sentAt).not.toBeNull();

    // Verify job in queue
    const job = await notificationsQueue.getJob(unsentRow!.id);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(unsentRow!.id);
  });

  it('4. Relaying the same row twice deduplicates via stable jobId', async () => {
    const outboxRow = await prisma.outboxEvent.findFirst({
      where: { teamId },
    });
    expect(outboxRow).not.toBeNull();

    // Reset sentAt to simulate re-running
    await prisma.outboxEvent.update({
      where: { id: outboxRow!.id },
      data: { sentAt: null },
    });

    // Run relay again
    await runOutboxRelayOnce();

    // Check BullMQ job with this outbox ID is single/deduplicated
    const jobs = await notificationsQueue.getJobs(['waiting', 'active', 'delayed', 'completed']);
    const matches = jobs.filter((j) => j.id === outboxRow!.id);
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('5. Token cleanup: fake Expo client returning DeviceNotRegistered deletes that devices row', async () => {
    // Verify device exists
    let device = await prisma.device.findFirst({ where: { userId: staffId } });
    expect(device).not.toBeNull();

    // Create a mock Expo client returning DeviceNotRegistered
    const mockExpo = {
      isExpoPushToken: () => true,
      chunkPushNotifications: (msgs: any[]) => [msgs],
      chunkPushNotificationReceiptIds: (ids: any[]) => [ids],
      sendPushNotificationsAsync: vi.fn().mockResolvedValue([
        {
          status: 'error',
          message: 'DeviceNotRegistered',
          details: { error: 'DeviceNotRegistered' },
        },
      ]),
      getPushNotificationReceiptsAsync: vi.fn().mockResolvedValue({}),
    };

    setExpoClient(mockExpo as any);

    // Run worker logic by creating worker and processing the job
    const worker = createNotificationWorker();

    const testRefId = randomUUID();
    // Create shift so it is not skipped_stale
    await prisma.shift.create({
      data: {
        id: testRefId,
        teamId,
        assigneeId: staffId,
        position: 'Pharmacist',
        startsAt: new Date(Date.now() + 2 * 3600 * 1000), // urgent (< 12h)
        endsAt: new Date(Date.now() + 6 * 3600 * 1000),
        status: 'PUBLISHED',
        createdBy: ownerId,
      },
    });

    await notificationsQueue.add(
      'notify-user',
      {
        type: 'shift.published',
        refId: testRefId,
        teamId,
        userId: staffId,
        version: 1,
        requestId: randomUUID(),
      },
      {
        jobId: `test-cleanup-${Date.now()}`,
        removeOnComplete: true,
      },
    );

    // Wait for worker to process job
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await worker.close();

    // Assert that the device token row was deleted (PRD 12.5)
    device = await prisma.device.findFirst({ where: { userId: staffId } });
    expect(device).toBeNull();
  });

  it('6. Notification decided as DELAY ends up as a delayed job, and when run after quiet hours, push is sent once', async () => {
    // 1. Configure quiet hours for staff: 22:00 to 07:00 UTC
    const nowIso = new Date('2026-10-15T20:00:00Z');
    await prisma.userSettings.upsert({
      where: { userId: staffId },
      create: {
        userId: staffId,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timeZone: 'UTC',
        notifyShifts: true,
        quietHoursUpdatedAt: nowIso,
        timeZoneAt: nowIso,
        notifyShiftsAt: nowIso,
        notifySwapsAt: nowIso,
        notifyBillingAt: nowIso,
        languageAt: nowIso,
        themeAt: nowIso,
      },
      update: {
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timeZone: 'UTC',
        notifyShifts: true,
        quietHoursUpdatedAt: nowIso,
      },
    });

    // Register active device for staff
    await prisma.device.create({
      data: {
        id: randomUUID(),
        userId: staffId,
        expoPushToken: 'ExponentPushToken[delayed_push_test_token]',
        platform: 'android',
        lastSeenAt: new Date(),
      },
    });

    // 2. Control clock to 23:00 UTC (inside quiet hours)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T23:00:00Z'));

    // Create non-urgent shift (> 12h away)
    const startsAt = new Date('2026-10-17T09:00:00Z');
    const endsAt = new Date('2026-10-17T17:00:00Z');
    const delayedShift = await prisma.shift.create({
      data: {
        teamId,
        assigneeId: staffId,
        position: 'Doctor',
        startsAt,
        endsAt,
        status: 'PUBLISHED',
        createdBy: ownerId,
      },
    });

    const sendPushSpy = vi.fn().mockResolvedValue([
      { status: 'ok', id: 'fake_delayed_receipt_id' },
    ]);
    const mockExpo = {
      isExpoPushToken: () => true,
      chunkPushNotifications: (msgs: any[]) => [msgs],
      chunkPushNotificationReceiptIds: (ids: any[]) => [ids],
      sendPushNotificationsAsync: sendPushSpy,
      getPushNotificationReceiptsAsync: vi.fn().mockResolvedValue({}),
    };
    setExpoClient(mockExpo as any);

    const worker = createNotificationWorker();
    const originalJobId = `delayed_test_job_${randomUUID()}`;

    try {
      // Enqueue job while inside quiet hours
      await notificationsQueue.add(
        'notify-user',
        {
          type: 'shift.published',
          refId: delayedShift.id,
          teamId,
          userId: staffId,
          version: 1,
          requestId: randomUUID(),
          startsAt: startsAt.toISOString(),
        },
        {
          jobId: originalJobId,
          removeOnComplete: true,
        },
      );

      // Wait for initial job execution (at 23:00 UTC)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Push must NOT be sent during quiet hours
      expect(sendPushSpy).not.toHaveBeenCalled();

      // Verify notification log has status 'delayed'
      const delayedLog = await prisma.notificationLog.findFirst({
        where: {
          userId: staffId,
          kind: 'shift.published',
          status: 'delayed',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(delayedLog).not.toBeNull();

      // Expected delayed jobId suffix is 07:00 UTC (2026-10-16T07:00:00.000Z = 1792134000000)
      const releaseEpoch = new Date('2026-10-16T07:00:00.000Z').getTime();
      const expectedDelayedJobId = `${originalJobId}__delayed__${releaseEpoch}`;

      const delayedJob = await notificationsQueue.getJob(expectedDelayedJobId);
      expect(delayedJob).not.toBeNull();
      const isDelayed = await delayedJob!.isDelayed();
      expect(isDelayed).toBe(true);

      // 3. Advance controlled clock past quiet hours (07:05 UTC)
      vi.setSystemTime(new Date('2026-10-16T07:05:00Z'));

      // Promote the delayed job to waiting so BullMQ worker executes it immediately
      await delayedJob!.promote();

      // Wait for worker to process the promoted job
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Push must be sent exactly once now that quiet hours have ended
      expect(sendPushSpy).toHaveBeenCalledTimes(1);
    } finally {
      await worker.close();
      vi.useRealTimers();
      setExpoClient(new Expo());
    }
  });
});
