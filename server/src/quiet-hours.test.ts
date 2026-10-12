import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { decideDelivery, QuietHoursSettings, NotificationSpec } from './workers/quiet-hours.js';

describe('Quiet Hours Delivery Decision (PRD 12.2)', () => {
  const defaultMidnightSettings: QuietHoursSettings = {
    quietHoursStart: '22:00',
    quietHoursEnd: '06:00',
    timeZone: 'Africa/Lagos',
    notifyShifts: true,
    notifySwaps: true,
    notifyBilling: true,
  };

  const sameDaySettings: QuietHoursSettings = {
    quietHoursStart: '13:00',
    quietHoursEnd: '15:00',
    timeZone: 'Africa/Lagos',
    notifyShifts: true,
    notifySwaps: true,
    notifyBilling: true,
  };

  const normalNotification: NotificationSpec = {
    group: 'shifts',
    urgent: false,
    mandatory: false,
  };

  it('1. Delays notification during midnight-crossing window before midnight (23:00 local)', () => {
    // Lagos is UTC+1. Local 23:00 is UTC 22:00.
    const now = DateTime.fromISO('2026-10-15T22:00:00.000Z');
    const decision = decideDelivery(defaultMidnightSettings, normalNotification, now);

    expect(decision.action).toBe('DELAY');
    if (decision.action === 'DELAY') {
      // Should release next day at 06:00 Lagos (05:00 UTC)
      expect(DateTime.fromJSDate(decision.releaseAt).toUTC().toISO()).toBe(
        '2026-10-16T05:00:00.000Z',
      );
    }
  });

  it('2. Delays notification during midnight-crossing window after midnight (04:00 local)', () => {
    // Lagos UTC+1. Local 04:00 is UTC 03:00.
    const now = DateTime.fromISO('2026-10-16T03:00:00.000Z');
    const decision = decideDelivery(defaultMidnightSettings, normalNotification, now);

    expect(decision.action).toBe('DELAY');
    if (decision.action === 'DELAY') {
      // Should release same day at 06:00 Lagos (05:00 UTC)
      expect(DateTime.fromJSDate(decision.releaseAt).toUTC().toISO()).toBe(
        '2026-10-16T05:00:00.000Z',
      );
    }
  });

  it('3. Sends immediately outside midnight-crossing window (14:00 local)', () => {
    // Lagos UTC+1. Local 14:00 is UTC 13:00.
    const now = DateTime.fromISO('2026-10-15T13:00:00.000Z');
    const decision = decideDelivery(defaultMidnightSettings, normalNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('4. Sends immediately just before quiet hours window starts (21:59 local)', () => {
    // Lagos UTC+1. Local 21:59 is UTC 20:59.
    const now = DateTime.fromISO('2026-10-15T20:59:00.000Z');
    const decision = decideDelivery(defaultMidnightSettings, normalNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('5. Delays notification during same-day window (14:00 local with 13:00-15:00 window)', () => {
    // Lagos UTC+1. Local 14:00 is UTC 13:00.
    const now = DateTime.fromISO('2026-10-15T13:00:00.000Z');
    const decision = decideDelivery(sameDaySettings, normalNotification, now);

    expect(decision.action).toBe('DELAY');
    if (decision.action === 'DELAY') {
      // Should release same day at 15:00 Lagos (14:00 UTC)
      expect(DateTime.fromJSDate(decision.releaseAt).toUTC().toISO()).toBe(
        '2026-10-15T14:00:00.000Z',
      );
    }
  });

  it('6. Sends immediately outside same-day window before start (11:00 local)', () => {
    const now = DateTime.fromISO('2026-10-15T10:00:00.000Z');
    const decision = decideDelivery(sameDaySettings, normalNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('7. Sends immediately outside same-day window after end (16:00 local)', () => {
    const now = DateTime.fromISO('2026-10-15T15:00:00.000Z');
    const decision = decideDelivery(sameDaySettings, normalNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('8. Sends immediately when no quiet hours are configured (null / null)', () => {
    const noQuietHoursSettings: QuietHoursSettings = {
      quietHoursStart: null,
      quietHoursEnd: null,
      timeZone: 'Africa/Lagos',
      notifyShifts: true,
    };
    // Middle of the night (02:00 local)
    const now = DateTime.fromISO('2026-10-15T01:00:00.000Z');
    const decision = decideDelivery(noQuietHoursSettings, normalNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('9. Urgent notification bypasses quiet hours window', () => {
    // Inside midnight quiet hours (01:00 local)
    const now = DateTime.fromISO('2026-10-16T00:00:00.000Z');
    const urgentNotification: NotificationSpec = {
      group: 'shifts',
      urgent: true,
      mandatory: false,
    };
    const decision = decideDelivery(defaultMidnightSettings, urgentNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('10. Skips notification when user preference group is disabled', () => {
    const disabledSettings: QuietHoursSettings = {
      ...defaultMidnightSettings,
      notifyShifts: false,
    };
    const now = DateTime.fromISO('2026-10-15T13:00:00.000Z'); // middle of day
    const decision = decideDelivery(disabledSettings, normalNotification, now);

    expect(decision.action).toBe('SKIP');
    if (decision.action === 'SKIP') {
      expect(decision.reason).toBe('pref_off');
    }
  });

  it('11. Mandatory notification bypasses group disabled preference', () => {
    const disabledSettings: QuietHoursSettings = {
      ...defaultMidnightSettings,
      notifyBilling: false,
    };
    const mandatoryNotification: NotificationSpec = {
      group: 'billing',
      urgent: false,
      mandatory: true,
    };
    const now = DateTime.fromISO('2026-10-15T13:00:00.000Z'); // middle of day
    const decision = decideDelivery(disabledSettings, mandatoryNotification, now);

    expect(decision.action).toBe('SEND_NOW');
  });

  it('12. Accurately evaluates differing timezones: Africa/Lagos vs Europe/London', () => {
    // At UTC 21:30:
    // In Europe/London (winter, UTC+0): Local time is 21:30 -> BEFORE 22:00 quiet hours -> SEND_NOW
    // In Africa/Lagos (UTC+1): Local time is 22:30 -> INSIDE 22:00 quiet hours -> DELAY
    const now = DateTime.fromISO('2026-12-15T21:30:00.000Z');

    const londonSettings: QuietHoursSettings = {
      ...defaultMidnightSettings,
      timeZone: 'Europe/London',
    };
    const lagosSettings: QuietHoursSettings = {
      ...defaultMidnightSettings,
      timeZone: 'Africa/Lagos',
    };

    const londonDecision = decideDelivery(londonSettings, normalNotification, now);
    const lagosDecision = decideDelivery(lagosSettings, normalNotification, now);

    expect(londonDecision.action).toBe('SEND_NOW');
    expect(lagosDecision.action).toBe('DELAY');
  });
});
