import { AttendanceStatus } from '@prisma/client';
import { calculatePayslip } from './payroll-calculator.js';
import { DEFAULT_RULES, isLate, minutesOf, ruleDeductions, TIME_PATTERN } from './payroll-rules.js';

describe('isLate', () => {
  it('forgives arrivals inside the grace period', () => {
    expect(isLate(AttendanceStatus.PRESENT, '08:10', DEFAULT_RULES)).toBe(false);
    expect(isLate(AttendanceStatus.PRESENT, '08:11', DEFAULT_RULES)).toBe(true);
  });

  it('counts a day marked Late even without an arrival time', () => {
    expect(isLate(AttendanceStatus.LATE, null, DEFAULT_RULES)).toBe(true);
  });

  it('never counts absent, leave or present-without-time days', () => {
    expect(isLate(AttendanceStatus.ABSENT, '10:00', DEFAULT_RULES)).toBe(false);
    expect(isLate(AttendanceStatus.LEAVE, '10:00', DEFAULT_RULES)).toBe(false);
    expect(isLate(AttendanceStatus.PRESENT, null, DEFAULT_RULES)).toBe(false);
  });
});

describe('time helpers', () => {
  it('reads HH:MM', () => {
    expect(minutesOf('08:30')).toBe(510);
    expect(TIME_PATTERN.test('24:00')).toBe(false);
    expect(TIME_PATTERN.test('9:00')).toBe(false);
    expect(TIME_PATTERN.test('13:45')).toBe(true);
  });
});

describe('ruleDeductions', () => {
  const base = { basic: 26000, workingDays: 26, rules: DEFAULT_RULES };

  it('charges a day for every third late', () => {
    expect(ruleDeductions({ ...base, lateDays: 2, shortLeaves: 0 }).lateDeduction).toBe(0);
    expect(ruleDeductions({ ...base, lateDays: 3, shortLeaves: 0 })).toMatchObject({ lateStrikes: 1, lateDeduction: 1000 });
    expect(ruleDeductions({ ...base, lateDays: 7, shortLeaves: 0 }).lateDeduction).toBe(2000);
  });

  it('gives two free short leaves, then half a day each', () => {
    expect(ruleDeductions({ ...base, lateDays: 0, shortLeaves: 2 }).shortLeaveDeduction).toBe(0);
    expect(ruleDeductions({ ...base, lateDays: 0, shortLeaves: 4 })).toMatchObject({
      chargeableShortLeaves: 2,
      shortLeaveDeduction: 1000,
    });
  });

  it('turns lates off when latesPerDeduction is 0', () => {
    const rules = { ...DEFAULT_RULES, latesPerDeduction: 0 };
    expect(ruleDeductions({ ...base, rules, lateDays: 20, shortLeaves: 0 }).lateDeduction).toBe(0);
  });

  it('charges nothing when the month has no working days', () => {
    expect(ruleDeductions({ ...base, workingDays: 0, lateDays: 9, shortLeaves: 9 })).toMatchObject({
      lateDeduction: 0,
      shortLeaveDeduction: 0,
    });
  });
});

describe('calculatePayslip with rules', () => {
  it('takes lates and short leaves off the net and shows them as lines', () => {
    const slip = calculatePayslip({
      basic: 26000,
      items: [],
      unpaidDays: 0,
      workingDays: 26,
      lateDays: 3,
      shortLeaves: 3,
    });
    expect(slip).toMatchObject({ lateDeduction: 1000, shortLeaveDeduction: 500, net: 24500 });
    expect(slip.lines.map((l) => l.name)).toEqual([
      'Basic salary',
      'Late arrivals (3 late, 1 deducted)',
      'Short leaves (3, 1 over the free limit)',
    ]);
  });
});
