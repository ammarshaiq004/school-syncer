import { describe, expect, it } from 'vitest';
import { ageOn, challanCounts, genderCounts, monthsOwed } from './dashboard-rules.js';

describe('challanCounts', () => {
  const rows = [
    // paid in full this month, nothing else owing
    { studentId: 'a', period: '2026-11', total: 1500, paid: 1500 },
    // paid part of this month, arrears untouched on their own voucher
    { studentId: 'b', period: '2026-11', total: 1500, paid: 500 },
    { studentId: 'b', period: '2026-10', total: 9000, paid: 0 },
    // paid this month's but old arrears still owing
    { studentId: 'c', period: '2026-11', total: 1500, paid: 1500 },
    { studentId: 'c', period: '2026-09', total: 3000, paid: 0 },
    // nothing paid
    { studentId: 'd', period: '2026-11', total: 1500, paid: 0 },
    // fully exempt
    { studentId: 'e', period: '2026-11', total: 0, paid: 0 },
    // no voucher this month: left out
    { studentId: 'f', period: '2026-10', total: 1500, paid: 0 },
  ];

  it('counts students by what they owe across this month and open arrears', () => {
    expect(challanCounts(rows, '2026-11')).toEqual({ paid: 2, partial: 2, unpaid: 1, total: 5 });
  });
});

describe('monthsOwed', () => {
  it('measures a year of arrears on one voucher in months, not vouchers', () => {
    expect(monthsOwed(16_500, 1500, 2)).toBe(11);
  });

  it('is never fewer than the months with an open voucher, and copes with a zero fee', () => {
    expect(monthsOwed(400, 1500, 3)).toBe(3);
    expect(monthsOwed(5000, 0, 2)).toBe(2);
    expect(monthsOwed(0, 1500, 2)).toBe(0);
  });
});

describe('genderCounts', () => {
  it('puts other and unrecorded together so the split adds up', () => {
    expect(genderCounts([{ gender: 'MALE', _count: 101 }, { gender: 'FEMALE', _count: 109 }, { gender: 'UNSPECIFIED', _count: 2 }])).toEqual({
      male: 101,
      female: 109,
      other: 2,
    });
  });
});

describe('ageOn', () => {
  it('counts whole years', () => {
    expect(ageOn('2015-11-12', '2026-11-12')).toBe(11);
    expect(ageOn('2015-11-13', '2026-11-12')).toBe(10);
  });
});
