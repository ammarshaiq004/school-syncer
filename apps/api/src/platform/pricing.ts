import { monthlyAmount, type AgreedPrice } from './plans.js';

/** A yearly bill costs this many months. */
export const YEARLY_MONTHS = 10;
/** And covers this many. */
export const YEAR_LENGTH = 12;

type Rates = { pricePerStudent: number; minimumMonthly: number };

/** "2026-11" plus n months. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** What a year up front costs: ten months at today's monthly figure. */
export const yearlyAmount = (monthly: number) => monthly * YEARLY_MONTHS;

/** Monthly bill for students added after a year was paid: the monthly figure now minus the one already paid for. */
export function topUpAmount(plan: Rates, students: number, covered: number, agreed?: AgreedPrice | null): number {
  return Math.max(0, monthlyAmount(plan, students, agreed) - monthlyAmount(plan, covered, agreed));
}

/**
 * Charge (positive) or credit (negative) for changing plan on `day` of a month
 * with `daysInMonth` days: the monthly difference for the days left, today included.
 * Whole rupees, rounded towards zero so a school is never over-charged.
 */
export function prorate(oldMonthly: number, newMonthly: number, day: number, daysInMonth: number): number {
  const left = daysInMonth - day + 1;
  return Math.trunc(((newMonthly - oldMonthly) * left) / daysInMonth);
}

/**
 * Folds waiting adjustments into a bill of `base` rupees. A credit can take a bill to nothing
 * but not below; what does not fit is `carried` to the next bill.
 */
export function settleAdjustments(pending: number, base: number): { applied: number; carried: number } {
  const applied = Math.max(pending, -base);
  return { applied, carried: pending - applied };
}
