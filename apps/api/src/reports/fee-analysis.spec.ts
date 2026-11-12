import { describe, expect, it } from 'vitest';
import { discountKind, isAdvance, monthlyFeeSummary, multiMonth, pct, type SummaryInvoice } from './fee-analysis.js';

describe('discountKind', () => {
  it('names each kind of negative line and ignores the rest', () => {
    expect(discountKind({ kind: 'FEE', amount: -200 })).toBe('Concession');
    expect(discountKind({ kind: 'SIBLING_DISCOUNT', amount: -50 })).toBe('Sibling discount');
    expect(discountKind({ kind: 'ADJUSTMENT', amount: -10 })).toBe('Fee office discount');
    expect(discountKind({ kind: 'LATE_FINE', amount: -30 })).toBe('Late fine waived');
    expect(discountKind({ kind: 'FEE', amount: 500 })).toBeNull();
    expect(discountKind({ kind: 'ARREARS', amount: -5 })).toBeNull();
  });
});

describe('isAdvance', () => {
  it('is true only for a voucher of a later month than the payment', () => {
    expect(isAdvance('2026-12', '2026-11')).toBe(true);
    expect(isAdvance('2026-11', '2026-11')).toBe(false);
    expect(isAdvance('2026-10', '2026-11')).toBe(false);
  });
});

describe('multiMonth', () => {
  const open = [
    { studentId: 'a', period: '2026-10', balance: 1000 },
    { studentId: 'a', period: '2026-09', balance: 1000 },
    { studentId: 'b', period: '2026-10', balance: 5000 },
    { studentId: 'c', period: '2026-08', balance: 300 },
    { studentId: 'c', period: '2026-09', balance: 300 },
    { studentId: 'c', period: '2026-10', balance: 300 },
  ];
  it('keeps students owing at least the minimum months, biggest debt first', () => {
    const rows = multiMonth(open, 2);
    expect(rows.map((r) => r.studentId)).toEqual(['a', 'c']);
    expect(rows[0]).toMatchObject({ periods: ['2026-09', '2026-10'], balance: 2000 });
  });
});

describe('pct', () => {
  it('rounds to a tenth and survives an empty whole', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBe(0);
  });
});

describe('monthlyFeeSummary', () => {
  const inv = (period: string, status: SummaryInvoice['status'], total: number, paid: number, arrears = 0): SummaryInvoice => ({ period, status, total, paid, arrears });

  it('adds up each month, newest first, without voided vouchers or carried-in arrears', () => {
    const rows = monthlyFeeSummary([
      inv('2026-10', 'PAID', 5000, 5000),
      inv('2026-10', 'PARTIAL', 5000, 2000),
      inv('2026-10', 'CANCELLED', 5000, 0),
      inv('2026-10', 'CARRIED_FORWARD', 5000, 1000),
      inv('2026-11', 'UNPAID', 7000, 0, 2000),
    ]);
    expect(rows.map((r) => r.period)).toEqual(['2026-11', '2026-10']);
    expect(rows[1]).toEqual({ period: '2026-10', vouchers: 3, billed: 15000, collected: 8000, outstanding: 3000, carried: 4000, collectedPct: 72.7 });
    expect(rows[0]).toMatchObject({ billed: 5000, outstanding: 7000, collectedPct: 0 });
  });

  it('is empty with no vouchers', () => {
    expect(monthlyFeeSummary([])).toEqual([]);
  });
});
