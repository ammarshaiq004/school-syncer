import { describe, expect, it } from 'vitest';
import { creditEntry, creditToApply } from './credits.js';
import { netOfCredits } from './outstanding.js';

describe('creditEntry', () => {
  it('accepts an advance and a withdrawal within what is held', () => {
    expect(creditEntry(700, 0, '2026-11-01', '2026-11-12')).toBe(700);
    expect(creditEntry(-200, 700, '2026-11-12', '2026-11-12')).toBe(-200);
  });

  it('refuses zero, fractions, the future and overdrawing', () => {
    expect(() => creditEntry(0, 0, '2026-11-01', '2026-11-12')).toThrow();
    expect(() => creditEntry(10.5, 0, '2026-11-01', '2026-11-12')).toThrow();
    expect(() => creditEntry(100, 0, '2026-11-13', '2026-11-12')).toThrow('future');
    expect(() => creditEntry(-800, 700, '2026-11-12', '2026-11-12')).toThrow('Only Rs 700');
  });
});

describe('netOfCredits', () => {
  it('takes credits off what is owed, never below zero', () => {
    expect(netOfCredits({ invoices: 3, amount: 852_360 }, 900)).toEqual({ invoices: 3, amount: 851_460, credits: 900, gross: 852_360 });
    expect(netOfCredits({ invoices: 1, amount: 100 }, 900).amount).toBe(0);
  });
});

describe('creditToApply', () => {
  it('takes credit up to what the voucher bills, and none when there is none or nothing billed', () => {
    expect(creditToApply(700, 1500)).toBe(700);
    expect(creditToApply(2000, 1500)).toBe(1500);
    expect(creditToApply(0, 1500)).toBe(0);
    expect(creditToApply(500, 0)).toBe(0);
    expect(creditToApply(-100, 1500)).toBe(0);
  });
});
