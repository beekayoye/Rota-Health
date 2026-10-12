import { DateTime } from 'luxon';

export interface QuietHoursSettings {
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timeZone?: string;
  notifyShifts?: boolean;
  notifySwaps?: boolean;
  notifyBilling?: boolean;
}

export interface NotificationSpec {
  group: 'shifts' | 'swaps' | 'billing';
  urgent: boolean;
  mandatory?: boolean;
}

export type DeliveryAction =
  | { action: 'SEND_NOW' }
  | { action: 'SKIP'; reason: 'pref_off' }
  | { action: 'DELAY'; releaseAt: Date };

/**
 * Pure quiet hours and notification delivery decision algorithm (PRD 12.2).
 * Luxon is used for all timezone math. Never uses floating or manual offsets.
 */
export function decideDelivery(
  settings: QuietHoursSettings | null | undefined,
  notification: NotificationSpec,
  now: DateTime = DateTime.utc(),
): DeliveryAction {
  const s = {
    quietHoursStart: settings?.quietHoursStart ?? null,
    quietHoursEnd: settings?.quietHoursEnd ?? null,
    timeZone: settings?.timeZone || 'Africa/Lagos',
    notifyShifts: settings?.notifyShifts ?? true,
    notifySwaps: settings?.notifySwaps ?? true,
    notifyBilling: settings?.notifyBilling ?? true,
  };

  const groupEnabled =
    notification.group === 'shifts'
      ? s.notifyShifts
      : notification.group === 'swaps'
      ? s.notifySwaps
      : s.notifyBilling;

  // 1. User preferences check
  if (!groupEnabled && !notification.mandatory) {
    return { action: 'SKIP', reason: 'pref_off' };
  }

  // 2. Urgent bypass
  if (notification.urgent) {
    return { action: 'SEND_NOW' };
  }

  // 3. No quiet hours set
  if (!s.quietHoursStart || !s.quietHoursEnd) {
    return { action: 'SEND_NOW' };
  }

  // 4. Local time in user's timezone
  const local = now.setZone(s.timeZone);
  const [startH, startM] = s.quietHoursStart.split(':').map(Number);
  const [endH, endM] = s.quietHoursEnd.split(':').map(Number);

  const start = local.set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
  const end = local.set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

  let inQuiet = false;
  let releaseAt: DateTime;

  if (start <= end) {
    // Same-day window, e.g. 13:00 to 15:00
    inQuiet = local >= start && local < end;
    releaseAt = end;
  } else {
    // Crosses midnight, e.g. 22:00 to 06:00
    if (local >= start) {
      inQuiet = true;
      releaseAt = end.plus({ days: 1 });
    } else if (local < end) {
      inQuiet = true;
      releaseAt = end;
    } else {
      inQuiet = false;
      releaseAt = end;
    }
  }

  if (!inQuiet) {
    return { action: 'SEND_NOW' };
  }

  return {
    action: 'DELAY',
    releaseAt: releaseAt.toUTC().toJSDate(),
  };
}
