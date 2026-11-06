import { AttendanceStatus } from '@prisma/client';

/** A school's late-arrival and short-leave rules (see the PayrollRules model). */
export interface Rules {
  shiftStart: string;
  graceMinutes: number;
  latesPerDeduction: number;
  lateDeductionPercent: number;
  freeShortLeaves: number;
  shortLeaveDeductionPercent: number;
}

export const DEFAULT_RULES: Rules = {
  shiftStart: '08:00',
  graceMinutes: 10,
  latesPerDeduction: 3,
  lateDeductionPercent: 100,
  freeShortLeaves: 2,
  shortLeaveDeductionPercent: 50,
};

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const minutesOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * A working day counts as late when the day is marked Late, or the staff
 * member is Present with an arrival time past the shift start plus grace.
 * Absent and leave days are never late.
 */
export function isLate(status: AttendanceStatus, checkIn: string | null, rules: Rules): boolean {
  if (status === AttendanceStatus.LATE) return true;
  return (
    status === AttendanceStatus.PRESENT &&
    !!checkIn &&
    minutesOf(checkIn) > minutesOf(rules.shiftStart) + rules.graceMinutes
  );
}

/** What payroll takes off for the month's lates and short leaves, in whole rupees. */
export function ruleDeductions(input: {
  basic: number;
  workingDays: number;
  lateDays: number;
  shortLeaves: number;
  rules: Rules;
}) {
  const daily = input.workingDays ? input.basic / input.workingDays : 0;
  const { rules } = input;
  const strikes = rules.latesPerDeduction > 0 ? Math.floor(input.lateDays / rules.latesPerDeduction) : 0;
  const chargeable = Math.max(0, input.shortLeaves - rules.freeShortLeaves);
  return {
    lateStrikes: strikes,
    chargeableShortLeaves: chargeable,
    lateDeduction: Math.round((daily * strikes * rules.lateDeductionPercent) / 100),
    shortLeaveDeduction: Math.round((daily * chargeable * rules.shortLeaveDeductionPercent) / 100),
  };
}
