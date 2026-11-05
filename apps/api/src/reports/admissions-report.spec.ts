import { describe, expect, it } from 'vitest';
import { admissionsByMonth, monthsBetween } from './admissions-report.js';

describe('admissions report', () => {
  it('lists the months of a range, across a year end', () => {
    expect(monthsBetween('2026-11-15', '2027-02-03')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-04-01', '2026-04-30')).toEqual(['2026-04']);
  });

  it('counts admissions and withdrawals per month and the net change', () => {
    const rows = admissionsByMonth(
      ['2026-04-02', '2026-04-20', '2026-05-01', '2025-12-01'],
      ['2026-05-10', '2026-05-11', '2026-06-01'],
      '2026-04-01',
      '2026-06-30',
    );
    expect(rows).toEqual([
      { month: '2026-04', admitted: 2, withdrawn: 0, net: 2 },
      { month: '2026-05', admitted: 1, withdrawn: 2, net: -1 },
      { month: '2026-06', admitted: 0, withdrawn: 1, net: -1 },
    ]);
  });
});
