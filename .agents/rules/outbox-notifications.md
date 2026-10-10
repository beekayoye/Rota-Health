# Outbox, Notifications, and Async Job Rules

These rules govern side effects, push notifications, quiet hours delivery, and queue worker execution.

## 1. Transactional Outbox Pattern (PRD 12.3)
- API request handlers must never call queues, Expo Push, Resend email, or external APIs directly.
- All side effects must be written as rows in the `outbox_events` table inside the exact same database transaction that persists the state change.
- Outbox event types:
  - `notify`: Push notifications.
  - `email`: Transactional emails (invites, magic links, password resets, billing alerts).
  - `cache.invalidate`: Redis cache key invalidations following committed mutations.
  - `billing.refund`: Automated payment refund requests.
- The `outbox-relay` background worker scans for unsent rows every 2 seconds on each shard using `SELECT ... FOR UPDATE SKIP LOCKED` (max 200 rows per batch).
- Enqueued jobs must use deterministic BullMQ `jobId = outbox.id` so crash recovery relays do not generate duplicate worker jobs.

## 2. Quiet Hours Algorithm (PRD 12.2)
- Recipient delivery preferences and quiet hours must be read from the primary database at the moment the push job executes (`loadSettings(user.id)`). Never cache notification settings.
- Push delivery decision (`decideDelivery`):
  - If notification group is disabled and notification is not mandatory: skip delivery (`SKIP("pref_off")`). Mandatory group includes billing payment failures (PRD 12.1).
  - If notification is urgent: send immediately (`SEND_NOW`).
  - If user has no quiet hours configured: send immediately (`SEND_NOW`).
  - Convert current timestamp to the recipient's local time zone using Luxon with IANA time zone identifiers.
  - Evaluate quiet window:
    - Same-day window (e.g., 13:00 to 15:00): in quiet if `start <= local < end`.
    - Midnight-crossing window (e.g., 22:00 to 06:00): in quiet if `local >= start` or `local < end`.
  - If within quiet hours: delay delivery until the quiet window concludes (`DELAY` with `until = releaseAt converted to UTC`).
- When a delayed quiet-hours job fires, it must re-evaluate `decideDelivery` fresh. If the underlying shift or swap was deleted or modified during the hold, the job must finish as `skipped_stale` (PRD 12.2).

## 3. Push Delivery and Deep Links (PRD 12.1, 12.6)
- Urgent push classifications (delivered even during quiet hours):
  - `shift.published`, `shift.updated`, or `shift.deleted` if the shift starts within 12 hours.
  - `swap.requested`, `swap.accepted`, or `swap.decided` if the earlier shift starts within 12 hours.
- Non-urgent pushes (always held during quiet hours):
  - Shifts or swaps starting more than 12 hours away.
  - Billing notifications (`billing.payment_succeeded`, `billing.payment_failed`, `billing.grace_reminder`, `billing.restricted`).
- All push payloads must include deep link URLs formatted with the custom scheme: `rotahealth://...` (e.g., `rotahealth://shifts/:shiftId`, `rotahealth://swaps/:swapId`, `rotahealth://billing`).

## 4. Token Invalidation and Cleanup (PRD 12.5)
- When Expo Push returns a receipt or ticket error with `details.error === "DeviceNotRegistered"`, the worker must immediately delete that token from the `devices` table.
- When a user logs out, their associated device tokens must be deleted from `devices`.
- Logging in from a device (`PUT /me/devices/:deviceId`) must atomically overwrite any previous user association for that push token.
