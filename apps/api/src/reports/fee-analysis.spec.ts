import { describe, expect, it } from 'vitest';
import { discountKind, isAdvance, multiMonth, pct } from './fee-analysis.js';

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
