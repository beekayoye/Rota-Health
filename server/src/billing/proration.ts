import { DateTime } from 'luxon';

export type PlanName = 'STARTER' | 'TEAM' | 'BUSINESS';

export interface PlanConfig {
  name: PlanName;
  displayName: string;
  baseCents: number;
  includedSeats: number;
  extraSeatCents: number;
  seatCap: number | null;
}

export const PLANS: Record<PlanName, PlanConfig> = {
  STARTER: {
    name: 'STARTER',
    displayName: 'Starter',
    baseCents: 2000,
    includedSeats: 5,
    extraSeatCents: 0,
    seatCap: 5,
  },
  TEAM: {
    name: 'TEAM',
    displayName: 'Team',
    baseCents: 5000,
    includedSeats: 15,
    extraSeatCents: 300,
    seatCap: null,
  },
  BUSINESS: {
    name: 'BUSINESS',
    displayName: 'Business',
    baseCents: 12000,
    includedSeats: 40,
    extraSeatCents: 200,
    seatCap: null,
  },
};

/**
 * Calculates monthly price in integer cents:
 * monthly(plan, seats) = base + max(0, seats - included) * extraSeat.
 * (PRD 11.1)
 */
export function monthly(plan: PlanName, seats: number): number {
  const cfg = PLANS[plan];
  if (!cfg) {
    throw new Error(`Unknown plan: ${plan}`);
  }
  const extraSeats = Math.max(0, seats - cfg.includedSeats);
  return cfg.baseCents + extraSeats * cfg.extraSeatCents;
}

export interface ProrateInput {
  current: {
    plan: PlanName;
    seats: number;
  };
  target: {
    plan: PlanName;
    seats: number;
  };
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  now: Date;
  timeZone: string;
}

export type ProrateResult =
  | {
      kind: 'charge';
      daysLeft: number;
      creditCents: number;
      costCents: number;
      chargeCents: number;
      newMonthlyCents: number;
    }
  | {
      kind: 'scheduled';
      effectiveAt: Date;
      newMonthlyCents: number;
    }
  | {
      kind: 'error';
      code: 'NO_CHANGE' | 'PLAN_SEAT_CAP' | 'RENEWAL_IN_PROGRESS';
    };

/**
 * Pure proration calculation function. Never reads the clock or the database.
 * Computes all amounts in integer cents using strictly integer arithmetic.
 * (PRD 11.1 - 11.4)
 */
export function prorate(input: ProrateInput): ProrateResult {
  const { current, target, currentPeriodStart, currentPeriodEnd, now, timeZone } = input;

  // 1. STARTER cap validation: max 5 seats, extra seats not available
  if (target.plan === 'STARTER' && target.seats > (PLANS.STARTER.seatCap ?? 5)) {
    return {
      kind: 'error',
      code: 'PLAN_SEAT_CAP',
    };
  }

  // 2. No change check
  if (current.plan === target.plan && current.seats === target.seats) {
    return {
      kind: 'error',
      code: 'NO_CHANGE',
    };
  }

  // 3. Whole calendar days elapsed from currentPeriodStart to now in clinic's timezone
  const startInZone = DateTime.fromJSDate(currentPeriodStart, { zone: timeZone }).startOf('day');
  const nowInZone = DateTime.fromJSDate(now, { zone: timeZone }).startOf('day');
  const daysElapsed = Math.floor(nowInZone.diff(startInZone, 'days').days);
  const daysLeft = 30 - daysElapsed;

  // 4. Period end check: when now >= currentPeriodEnd or daysLeft <= 0
  if (now.getTime() >= currentPeriodEnd.getTime() || daysLeft <= 0) {
    return {
      kind: 'error',
      code: 'RENEWAL_IN_PROGRESS',
    };
  }

  const oldMonthly = monthly(current.plan, current.seats);
  const newMonthly = monthly(target.plan, target.seats);

  // 5. Upgrade / cost increase: charge today
  if (newMonthly > oldMonthly) {
    // Rounding rule: multiply before dividing, integer floor, subtract
    const creditCents = Math.floor((oldMonthly * daysLeft) / 30);
    const costCents = Math.floor((newMonthly * daysLeft) / 30);
    const chargeCents = costCents - creditCents;

    return {
      kind: 'charge',
      daysLeft,
      creditCents,
      costCents,
      chargeCents,
      newMonthlyCents: newMonthly,
    };
  }

  // 6. Downgrade / cost decrease: scheduled at currentPeriodEnd
  return {
    kind: 'scheduled',
    effectiveAt: currentPeriodEnd,
    newMonthlyCents: newMonthly,
  };
}
