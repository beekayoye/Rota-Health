import { describe, it, expect, vi } from 'vitest';
import { prorate, monthly, PLANS, type PlanName } from './billing/proration.js';

describe('Billing Proration (proration.test.ts)', () => {
  const timeZone = 'UTC';
  const currentPeriodStart = new Date('2026-10-01T00:00:00.000Z');
  const currentPeriodEnd = new Date('2026-10-31T00:00:00.000Z');

  // Helper to construct now date with exact days left (daysElapsed = 30 - daysLeft)
  const dateWithDaysLeft = (daysLeft: number): Date => {
    const daysElapsed = 30 - daysLeft;
    const d = new Date(currentPeriodStart.getTime());
    d.setUTCDate(d.getUTCDate() + daysElapsed);
    return d;
  };

  it('monthly() calculates base and included/extra seats correctly', () => {
    expect(monthly('STARTER', 5)).toBe(2000);
    expect(monthly('TEAM', 15)).toBe(5000);
    expect(monthly('TEAM', 18)).toBe(5900);
    expect(monthly('TEAM', 20)).toBe(6500);
    expect(monthly('BUSINESS', 40)).toBe(12000);
    expect(monthly('BUSINESS', 45)).toBe(13000);
  });

  describe('13 PRD 11.4 test cases with exact cents', () => {
    it('Case 1: Upgrade, mid period (Starter 5 -> Team 15, 20 days left)', () => {
      // Brief example: Starter (2000) to Team (5000) on day 11, 20 days left
      const res = prorate({
        current: { plan: 'STARTER', seats: 5 },
        target: { plan: 'TEAM', seats: 15 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(20),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 20,
        creditCents: 1333,
        costCents: 3333,
        chargeCents: 2000,
        newMonthlyCents: 5000,
      });
    });

    it('Case 2: Add seats (Team 15 -> Team 18, 12 days left)', () => {
      // Interview check: Team 15 seats + 3 seats, 12 days left
      const res = prorate({
        current: { plan: 'TEAM', seats: 15 },
        target: { plan: 'TEAM', seats: 18 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(12),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 12,
        creditCents: 2000,
        costCents: 2360,
        chargeCents: 360,
        newMonthlyCents: 5900,
      });
    });

    it('Case 3: Downgrade (Team 15 -> Starter 5, 20 days left)', () => {
      const res = prorate({
        current: { plan: 'TEAM', seats: 15 },
        target: { plan: 'STARTER', seats: 5 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(20),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'scheduled',
        effectiveAt: currentPeriodEnd,
        newMonthlyCents: 2000,
      });
    });

    it('Case 4: Remove seats (Team 20 -> Team 17, 16 days left)', () => {
      const res = prorate({
        current: { plan: 'TEAM', seats: 20 },
        target: { plan: 'TEAM', seats: 17 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(16),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'scheduled',
        effectiveAt: currentPeriodEnd,
        newMonthlyCents: 5600,
      });
    });

    it('Case 5: Upgrade on first day (Starter 5 -> Team 15, 30 days left)', () => {
      const res = prorate({
        current: { plan: 'STARTER', seats: 5 },
        target: { plan: 'TEAM', seats: 15 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(30),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 30,
        creditCents: 2000,
        costCents: 5000,
        chargeCents: 3000,
        newMonthlyCents: 5000,
      });
    });

    it('Case 6: Upgrade on last day (Starter 5 -> Business 40, 1 day left)', () => {
      const res = prorate({
        current: { plan: 'STARTER', seats: 5 },
        target: { plan: 'BUSINESS', seats: 40 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(1),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 1,
        creditCents: 66,
        costCents: 400,
        chargeCents: 334,
        newMonthlyCents: 12000,
      });
    });

    it('Case 7a: Two changes, first (Starter 5 -> Team 15, 20 days left)', () => {
      const res = prorate({
        current: { plan: 'STARTER', seats: 5 },
        target: { plan: 'TEAM', seats: 15 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(20),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 20,
        creditCents: 1333,
        costCents: 3333,
        chargeCents: 2000,
        newMonthlyCents: 5000,
      });
    });

    it('Case 7b: Two changes, second (Team 15 -> Team 18, 10 days left)', () => {
      const res = prorate({
        current: { plan: 'TEAM', seats: 15 },
        target: { plan: 'TEAM', seats: 18 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(10),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 10,
        creditCents: 1666,
        costCents: 1966,
        chargeCents: 300,
        newMonthlyCents: 5900,
      });
    });

    it('Case 8: Rounding on both sides (Team 20 -> Business 20, 23 days left)', () => {
      const res = prorate({
        current: { plan: 'TEAM', seats: 20 },
        target: { plan: 'BUSINESS', seats: 20 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(23),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 23,
        creditCents: 4983,
        costCents: 9200,
        chargeCents: 4217,
        newMonthlyCents: 12000,
      });
    });

    it('Case 9: Extra seats on Business (Business 40 -> Business 45, 15 days left)', () => {
      const res = prorate({
        current: { plan: 'BUSINESS', seats: 40 },
        target: { plan: 'BUSINESS', seats: 45 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(15),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'charge',
        daysLeft: 15,
        creditCents: 6000,
        costCents: 6500,
        chargeCents: 500,
        newMonthlyCents: 13000,
      });
    });

    it('Case 10: Starter over cap (Starter 5 -> Starter 6, 20 days left)', () => {
      const res = prorate({
        current: { plan: 'STARTER', seats: 5 },
        target: { plan: 'STARTER', seats: 6 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(20),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'error',
        code: 'PLAN_SEAT_CAP',
      });
    });

    it('Case 11: Upgrade, then downgrade in same period (26 days left then 11 days left)', () => {
      const upgradeRes = prorate({
        current: { plan: 'TEAM', seats: 15 },
        target: { plan: 'BUSINESS', seats: 40 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(26),
        timeZone,
      });

      expect(upgradeRes).toEqual({
        kind: 'charge',
        daysLeft: 26,
        creditCents: 4333,
        costCents: 10400,
        chargeCents: 6067,
        newMonthlyCents: 12000,
      });

      const downgradeRes = prorate({
        current: { plan: 'BUSINESS', seats: 40 },
        target: { plan: 'TEAM', seats: 15 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(11),
        timeZone,
      });

      expect(downgradeRes).toEqual({
        kind: 'scheduled',
        effectiveAt: currentPeriodEnd,
        newMonthlyCents: 5000,
      });
    });

    it('Case 12: No change (Team 15 -> Team 15, 20 days left)', () => {
      const res = prorate({
        current: { plan: 'TEAM', seats: 15 },
        target: { plan: 'TEAM', seats: 15 },
        currentPeriodStart,
        currentPeriodEnd,
        now: dateWithDaysLeft(20),
        timeZone,
      });

      expect(res).toEqual({
        kind: 'error',
        code: 'NO_CHANGE',
      });
    });

    it('Case 13: Change at period end, before renewal scan (Starter 5 -> Team 15, 0 days left)', () => {
      const res = prorate({
        current: { plan: 'STARTER', seats: 5 },
        target: { plan: 'TEAM', seats: 15 },
        currentPeriodStart,
        currentPeriodEnd,
        now: currentPeriodEnd, // now >= currentPeriodEnd, daysLeft <= 0
        timeZone,
      });

      expect(res).toEqual({
        kind: 'error',
        code: 'RENEWAL_IN_PROGRESS',
      });
    });
  });

  describe('Integer arithmetic and non-negativity guarantees', () => {
    it('asserts every computed number is an integer and no charge is negative across various days and configurations', () => {
      const plans: Array<{ plan: PlanName; seats: number }> = [
        { plan: 'STARTER', seats: 1 },
        { plan: 'STARTER', seats: 5 },
        { plan: 'TEAM', seats: 15 },
        { plan: 'TEAM', seats: 25 },
        { plan: 'BUSINESS', seats: 40 },
        { plan: 'BUSINESS', seats: 60 },
      ];

      for (let day = 1; day <= 29; day++) {
        for (const current of plans) {
          for (const target of plans) {
            const res = prorate({
              current,
              target,
              currentPeriodStart,
              currentPeriodEnd,
              now: dateWithDaysLeft(day),
              timeZone,
            });

            if (res.kind === 'charge') {
              expect(Number.isInteger(res.daysLeft)).toBe(true);
              expect(Number.isInteger(res.creditCents)).toBe(true);
              expect(Number.isInteger(res.costCents)).toBe(true);
              expect(Number.isInteger(res.chargeCents)).toBe(true);
              expect(Number.isInteger(res.newMonthlyCents)).toBe(true);
              expect(res.chargeCents).toBeGreaterThanOrEqual(0);
            } else if (res.kind === 'scheduled') {
              expect(Number.isInteger(res.newMonthlyCents)).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('Clock isolation', () => {
    it('proves prorate() never reads the system clock by shifting fake timers to a far-off date', () => {
      vi.useFakeTimers();
      try {
        // Set system clock 100 years into the future
        vi.setSystemTime(new Date('2126-06-15T12:00:00Z'));

        const res1 = prorate({
          current: { plan: 'STARTER', seats: 5 },
          target: { plan: 'TEAM', seats: 15 },
          currentPeriodStart,
          currentPeriodEnd,
          now: dateWithDaysLeft(20),
          timeZone,
        });

        expect(res1).toEqual({
          kind: 'charge',
          daysLeft: 20,
          creditCents: 1333,
          costCents: 3333,
          chargeCents: 2000,
          newMonthlyCents: 5000,
        });

        // Set system clock 50 years into the past
        vi.setSystemTime(new Date('1976-01-01T00:00:00Z'));

        const res2 = prorate({
          current: { plan: 'TEAM', seats: 15 },
          target: { plan: 'TEAM', seats: 18 },
          currentPeriodStart,
          currentPeriodEnd,
          now: dateWithDaysLeft(12),
          timeZone,
        });

        expect(res2).toEqual({
          kind: 'charge',
          daysLeft: 12,
          creditCents: 2000,
          costCents: 2360,
          chargeCents: 360,
          newMonthlyCents: 5900,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Randomized property test for upgrades', () => {
    // Note: fast-check is not added to locked tech stack dependencies per AGENTS.md rule 3.
    // Instead we test random upgrade combinations directly using property assertions:
    // chargeCents = costCents - creditCents and chargeCents <= newMonthlyCents.
    it('for random upgrades, chargeCents = costCents - creditCents and chargeCents <= newMonthlyCents', () => {
      const planNames: PlanName[] = ['STARTER', 'TEAM', 'BUSINESS'];

      for (let i = 0; i < 500; i++) {
        // Random days left between 1 and 30
        const daysLeft = Math.floor(Math.random() * 30) + 1;
        const now = dateWithDaysLeft(daysLeft);

        // Pick current
        const currentPlan = planNames[Math.floor(Math.random() * planNames.length)];
        const currentSeats =
          currentPlan === 'STARTER'
            ? Math.floor(Math.random() * 5) + 1
            : currentPlan === 'TEAM'
            ? Math.floor(Math.random() * 30) + 1
            : Math.floor(Math.random() * 50) + 1;

        // Pick target
        const targetPlan = planNames[Math.floor(Math.random() * planNames.length)];
        const targetSeats =
          targetPlan === 'STARTER'
            ? Math.floor(Math.random() * 5) + 1
            : targetPlan === 'TEAM'
            ? Math.floor(Math.random() * 30) + 1
            : Math.floor(Math.random() * 50) + 1;

        const currentMonthly = monthly(currentPlan, currentSeats);
        const targetMonthly = monthly(targetPlan, targetSeats);

        // Filter for upgrades only
        if (targetMonthly > currentMonthly) {
          const res = prorate({
            current: { plan: currentPlan, seats: currentSeats },
            target: { plan: targetPlan, seats: targetSeats },
            currentPeriodStart,
            currentPeriodEnd,
            now,
            timeZone,
          });

          if (res.kind === 'charge') {
            expect(res.chargeCents).toBe(res.costCents - res.creditCents);
            expect(res.chargeCents).toBeLessThanOrEqual(res.newMonthlyCents);
            expect(res.chargeCents).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  });
});
