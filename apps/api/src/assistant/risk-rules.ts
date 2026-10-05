/**
 * At-risk rules (SCHOOL-107): pure functions that turn a student's recent
 * attendance, results and fees into flags a teacher can act on. No AI is
 * involved, so the list is the same with or without an API key.
 */

export type RiskLevel = 'high' | 'medium';
export type RiskArea = 'attendance' | 'results' | 'fees';

export interface RiskFlag {
  area: RiskArea;
  level: RiskLevel;
  /** One plain sentence, e.g. "Attended 58% of days in the last 30 days". */
  reason: string;
}

export interface RiskInput {
  attendance: { present: number; absent: number; late: number; leave: number };
  /** Latest published exam first; up to two are used. */
  results: { exam: string; percent: number; passed: boolean; failedSubjects: string[] }[];
  /** Null when the viewer may not see fees. */
  fees: { overdueAmount: number; oldestOverdueDays: number } | null;
}

export const RISK_THRESHOLDS = {
  /** Fewer marked days than this and the attendance rate is not judged. */
  minMarkedDays: 5,
  attendanceMedium: 80,
  attendanceHigh: 65,
  resultLow: 40,
  /** A drop of this many percentage points between the last two exams. */
  resultDrop: 15,
  feesMediumDays: 45,
  feesHighDays: 90,
} as const;

const T = RISK_THRESHOLDS;

/** Present and late over all marked days, 0-100 with one decimal, or null when too few days were marked. */
export function attendancePercent(a: RiskInput['attendance']): number | null {
  const marked = a.present + a.absent + a.late + a.leave;
  if (marked < T.minMarkedDays) return null;
  return Math.round(((a.present + a.late) / marked) * 1000) / 10;
}

export function riskFlags(input: RiskInput): RiskFlag[] {
  const flags: RiskFlag[] = [];

  const rate = attendancePercent(input.attendance);
  if (rate !== null && rate < T.attendanceMedium) {
    flags.push({
      area: 'attendance',
      level: rate < T.attendanceHigh ? 'high' : 'medium',
      reason: `Attended ${rate}% of marked days in the last 30 days (${input.attendance.absent} absent)`,
    });
  }

  const [latest, previous] = input.results;
  if (latest) {
    if (!latest.passed || latest.percent < T.resultLow) {
      const subjects = latest.failedSubjects.length
        ? `, failed ${latest.failedSubjects.slice(0, 3).join(', ')}`
        : '';
      flags.push({
        area: 'results',
        level: 'high',
        reason: `${round(latest.percent)}% in ${latest.exam}${subjects}`,
      });
    } else if (previous && previous.percent - latest.percent >= T.resultDrop) {
      flags.push({
        area: 'results',
        level: 'medium',
        reason: `Dropped from ${round(previous.percent)}% (${previous.exam}) to ${round(latest.percent)}% (${latest.exam})`,
      });
    }
  }

  if (input.fees && input.fees.overdueAmount > 0 && input.fees.oldestOverdueDays >= T.feesMediumDays) {
    flags.push({
      area: 'fees',
      level: input.fees.oldestOverdueDays >= T.feesHighDays ? 'high' : 'medium',
      reason: `Rs ${input.fees.overdueAmount.toLocaleString('en-PK')} overdue for ${input.fees.oldestOverdueDays} days`,
    });
  }
  return flags;
}

/** High when any flag is high or two areas are flagged; medium otherwise; null with no flags. */
export function riskLevel(flags: RiskFlag[]): RiskLevel | null {
  if (!flags.length) return null;
  if (flags.some((f) => f.level === 'high') || new Set(flags.map((f) => f.area)).size >= 2) return 'high';
  return 'medium';
}

/** Sort key: high before medium, then more flags first. */
export function riskScore(flags: RiskFlag[]): number {
  return flags.reduce((sum, f) => sum + (f.level === 'high' ? 3 : 1), 0) + (riskLevel(flags) === 'high' ? 100 : 0);
}

const round = (n: number) => Math.round(n * 10) / 10;
