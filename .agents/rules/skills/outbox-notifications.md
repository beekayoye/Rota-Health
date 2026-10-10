---
name: outbox-notifications
description: Procedures for writing transactional outbox rows, running the outbox-relay scanner, evaluating quiet hours delivery with time zones, batching Expo push alerts, and cleaning up deregistered devices.
---

# Skill: Transactional Outbox and Quiet Hours Notifications

Use this skill when publishing shifts, requesting/approving swaps, sending invites, dispatching push notifications or transactional emails, and updating recipient settings.

## 1. Writing to the Transactional Outbox (PRD 12.3)

### Core Rule
Never call BullMQ `queue.add`, Expo Push SDK, Resend, or external HTTP clients directly within an Express route handler. Always commit the event payload to `outbox_events` within the same database transaction.

### Outbox Transaction Pattern
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Mutate application data (e.g., publish shift)
  const shift = await tx.shift.update({
    where: { id: shiftId, teamId },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });

  // 2. Insert outbox row in the same transaction
  await tx.outboxEvent.create({
    data: {
      teamId,
      kind: 'notify',
      payload: {
        userIds: [shift.assigneeId],
        type: 'shift.published',
        refId: shift.id,
        teamId,
        urgent: startsWithin12Hours(shift.startsAt),
      },
    },
  });
});
```

---

## 2. Outbox Relay Runner Workflow (PRD 12.3)

The `outbox-relay` runner executes every 2 seconds on each shard:
1. Query unsent outbox rows using PostgreSQL row locking:
   ```sql
   SELECT * FROM outbox_events
   WHERE sent_at IS NULL
   ORDER BY created_at ASC
   LIMIT 200
   FOR UPDATE SKIP LOCKED;
   ```
2. For each row:
   - Enqueue to the corresponding BullMQ queue with deterministic `jobId = outboxRow.id`:
     - `kind === "notify"` -> `notifications` queue.
     - `kind === "email"` -> `emails` queue.
     - `kind === "cache.invalidate"` -> invalidate Redis cache keys.
     - `kind === "billing.refund"` -> `billing` queue.
   - Update `outbox_events.sent_at = now()`.
3. If the relay crashes between queue insertion and `sent_at` update, the next run re-enqueues the row safely because BullMQ deduplicates on identical `jobId`.

---

## 3. Quiet Hours Delivery Algorithm (PRD 12.2)

When the `notify-user` job processes in BullMQ:

```typescript
import { DateTime } from 'luxon';

export async function decideDelivery(userId: string, notification: NotificationPayload, now: Date) {
  // 1. Load settings directly from Primary DB (NEVER from cache)
  const settings = await primaryDb.userSettings.findUnique({ where: { userId } });
  if (!settings) return { action: 'SEND_NOW' };

  // 2. Check group enablement
  if (!settings[`group_${notification.group}`] && !notification.mandatory) {
    return { action: 'SKIP', reason: 'pref_off' };
  }

  // 3. Urgent notifications bypass quiet hours
  if (notification.urgent) {
    return { action: 'SEND_NOW' };
  }

  // 4. If no quiet hours window configured
  if (!settings.quietHoursStart || !settings.quietHoursEnd) {
    return { action: 'SEND_NOW' };
  }

  // 5. Convert to user's IANA time zone
  const userZone = settings.timeZone || 'Africa/Lagos';
  const localNow = DateTime.fromJSDate(now).setZone(userZone);

  const [startH, startM] = settings.quietHoursStart.split(':').map(Number);
  const [endH, endM] = settings.quietHoursEnd.split(':').map(Number);

  const windowStart = localNow.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
  const windowEnd = localNow.set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

  let inQuiet = false;
  let releaseAt: DateTime;

  if (windowStart <= windowEnd) {
    // Same-day window (e.g. 13:00 to 15:00)
    inQuiet = localNow >= windowStart && localNow < windowEnd;
    releaseAt = windowEnd;
  } else {
    // Midnight-crossing window (e.g. 22:00 to 06:00)
    if (localNow >= windowStart) {
      inQuiet = true;
      releaseAt = windowEnd.plus({ days: 1 });
    } else if (localNow < windowEnd) {
      inQuiet = true;
      releaseAt = windowEnd;
    } else {
      inQuiet = false;
    }
  }

  if (!inQuiet) {
    return { action: 'SEND_NOW' };
  }

  // 6. Delay job in BullMQ
  return {
    action: 'DELAY',
    releaseAtUtc: releaseAt.toUTC().toJSDate(),
    delayMs: releaseAt.diff(localNow).milliseconds,
  };
}
```

### Delayed Job Re-Evaluation
When a delayed job awakens, it must run `decideDelivery` again. Verify that the referenced shift or swap still exists. If deleted or superseded while held, finish with outcome `skipped_stale`.

---

## 4. Push Batching & Token Invalidation (PRD 12.3, 12.5)

1. Load active recipient devices from Shard A `devices` table.
2. Format message:
   ```typescript
   {
     to: device.expoPushToken,
     title: `${team.name}: ${title}`,
     body,
     data: { url: notification.deepLinkUrl, teamId },
     sound: 'default',
   }
   ```
3. Dispatch to Expo Push in batches up to 100 messages via `expo-server-sdk`.
4. Store tickets in `notification_log` and schedule receipt verification job with a 15-minute delay.
5. If receipt or ticket returns error `DeviceNotRegistered`:
   ```typescript
   await primaryDb.device.delete({
     where: { expoPushToken: ticket.token }
   });
   ```
