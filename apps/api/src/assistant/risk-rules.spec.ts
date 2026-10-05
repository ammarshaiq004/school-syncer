import { attendancePercent, riskFlags, riskLevel, riskScore, type RiskInput } from './risk-rules.js';

const base = (over: Partial<RiskInput> = {}): RiskInput => ({
  attendance: { present: 20, absent: 0, late: 0, leave: 0 },
  results: [],
  fees: null,
  ...over,
});

describe('risk rules', () => {
  it('does not judge attendance on too few days', () => {
    expect(attendancePercent({ present: 1, absent: 3, late: 0, leave: 0 })).toBeNull();
    expect(riskFlags(base({ attendance: { present: 1, absent: 3, late: 0, leave: 0 } }))).toEqual([]);
  });

  it('counts late as attended and leave as missed', () => {
    expect(attendancePercent({ present: 6, absent: 1, late: 2, leave: 1 })).toBe(80);
  });

  it('flags low attendance as medium, very low as high', () => {
    const medium = riskFlags(base({ attendance: { present: 15, absent: 5, late: 0, leave: 0 } }));
    expect(medium).toEqual([expect.objectContaining({ area: 'attendance', level: 'medium' })]);
    const high = riskFlags(base({ attendance: { present: 10, absent: 10, late: 0, leave: 0 } }));
    expect(high[0]).toMatchObject({ area: 'attendance', level: 'high' });
    expect(high[0].reason).toContain('50%');
  });

  it('flags a failed exam with the subjects', () => {
    const flags = riskFlags(
      base({ results: [{ exam: 'Mid-term', percent: 52, passed: false, failedSubjects: ['Maths', 'Urdu'] }] }),
    );
    expect(flags).toEqual([
      { area: 'results', level: 'high', reason: '52% in Mid-term, failed Maths, Urdu' },
    ]);
  });

  it('flags a sharp drop between the last two exams', () => {
    const flags = riskFlags(
      base({
        results: [
          { exam: 'Final', percent: 61, passed: true, failedSubjects: [] },
          { exam: 'Mid-term', percent: 80, passed: true, failedSubjects: [] },
        ],
      }),
    );
    expect(flags).toEqual([expect.objectContaining({ area: 'results', level: 'medium' })]);
  });

  it('flags only long-overdue fees, and never when fees are hidden', () => {
    expect(riskFlags(base({ fees: { overdueAmount: 3000, oldestOverdueDays: 10 } }))).toEqual([]);
    expect(riskFlags(base({ fees: { overdueAmount: 3000, oldestOverdueDays: 50 } }))[0].level).toBe('medium');
    expect(riskFlags(base({ fees: { overdueAmount: 3000, oldestOverdueDays: 95 } }))[0].level).toBe('high');
    expect(riskFlags(base({ fees: null }))).toEqual([]);
  });

  it('rates two medium areas as high and sorts high first', () => {
    const two = riskFlags(
      base({
        attendance: { present: 15, absent: 5, late: 0, leave: 0 },
        fees: { overdueAmount: 1000, oldestOverdueDays: 50 },
      }),
    );
    expect(riskLevel(two)).toBe('high');
    expect(riskLevel([])).toBeNull();
    const one = riskFlags(base({ fees: { overdueAmount: 1000, oldestOverdueDays: 50 } }));
    expect(riskLevel(one)).toBe('medium');
    expect(riskScore(two)).toBeGreaterThan(riskScore(one));
  });
});
