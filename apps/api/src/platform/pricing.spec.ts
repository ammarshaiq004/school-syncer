import { describe, expect, it } from 'vitest';
import { addMonths, prorate, settleAdjustments, topUpAmount, yearlyAmount } from './pricing.js';

const plan = { pricePerStudent: 100, minimumMonthly: 5000 };

describe('pricing', () => {
  it('adds months across a year end', () => {
    expect(addMonths('2026-11', 11)).toBe('2027-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', 11)).toBe('2026-12');
  });

  it('charges ten months for a year', () => {
    expect(yearlyAmount(12_000)).toBe(120_000);
  });

  it('bills only the students added after the year was paid', () => {
    expect(topUpAmount(plan, 150, 100)).toBe(5000); // 15,000 - 10,000
    expect(topUpAmount(plan, 80, 100)).toBe(0);
    expect(topUpAmount(plan, 40, 40)).toBe(0);
    expect(topUpAmount(plan, 120, 40, { agreedPricePerStudent: 50, agreedMinimumMonthly: 1000 })).toBe(4000);
  });

  it('prorates a plan change over the days left, today included', () => {
    expect(prorate(10_000, 13_000, 16, 30)).toBe(1_500); // 15 of 30 days
    expect(prorate(13_000, 10_000, 16, 30)).toBe(-1_500);
    expect(prorate(10_000, 10_001, 1, 30)).toBe(1); // 10_001 - 10_000 over a whole month
    expect(prorate(0, 100, 30, 30)).toBe(3); // 100/30 rounded towards zero
    expect(prorate(100, 0, 30, 30)).toBe(-3);
  });

  it('takes credits off a bill but never below nothing', () => {
    expect(settleAdjustments(-2000, 10_000)).toEqual({ applied: -2000, carried: 0 });
    expect(settleAdjustments(-15_000, 10_000)).toEqual({ applied: -10_000, carried: -5000 });
    expect(settleAdjustments(1500, 10_000)).toEqual({ applied: 1500, carried: 0 });
    expect(settleAdjustments(0, 0)).toEqual({ applied: 0, carried: 0 });
  });
});
