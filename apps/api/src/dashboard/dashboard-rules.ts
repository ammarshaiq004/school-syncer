import type { Prisma } from '@prisma/client';

/** Words in a staff designation that mark teaching staff ("Senior Teacher", "Lecturer"). */
export const TEACHING_WORDS = ['teacher', 'lecturer', 'instructor', 'tutor', 'faculty', 'professor', 'mudarris'];

/** User filters matching a staff designation that says they teach. */
export const teachingDesignationWhere = (): Prisma.UserWhereInput[] =>
  TEACHING_WORDS.map((w) => ({ staffProfile: { is: { designation: { contains: w, mode: 'insensitive' as const } } } }));

export interface ChallanCounts {
  paid: number;
  partial: number;
  unpaid: number;
  total: number;
}

/**
 * Where each student stands on this month's challan, counting any older vouchers still open
 * with it (arrears often sit on their own vouchers): paid when nothing is owed, partial when
 * something was paid but money is still owed, unpaid when nothing was paid. Students with no
 * voucher this month are left out.
 */
export function challanCounts(
  rows: { studentId: string; period: string; total: number; paid: number }[],
  period: string,
): ChallanCounts {
  const byStudent = new Map<string, { owed: number; paid: number; thisMonth: boolean }>();
  for (const r of rows) {
    const s = byStudent.get(r.studentId) ?? { owed: 0, paid: 0, thisMonth: false };
    s.owed += Math.max(0, r.total - r.paid);
    s.paid += r.paid;
    s.thisMonth ||= r.period === period;
    byStudent.set(r.studentId, s);
  }
  const out: ChallanCounts = { paid: 0, partial: 0, unpaid: 0, total: 0 };
  for (const s of byStudent.values()) {
    if (!s.thisMonth) continue;
    out.total += 1;
    if (s.owed === 0) out.paid += 1;
    else if (s.paid > 0) out.partial += 1;
    else out.unpaid += 1;
  }
  return out;
}

/**
 * Months of fees a student is behind: the balance in units of their monthly fee, never fewer
 * than the number of different months with an open voucher. (Arrears moved from another system
 * sit on one voucher, so counting vouchers alone would say "2 months" for a year behind.)
 */
export function monthsOwed(balance: number, monthlyFee: number, openMonths: number): number {
  if (balance <= 0) return 0;
  return Math.max(openMonths, monthlyFee > 0 ? Math.ceil(balance / monthlyFee) : 0);
}

/** Boys, girls and everyone else (other or not recorded) among the students counted. */
export function genderCounts(groups: { gender: string; _count: number }[]) {
  const n = (g: string) => groups.find((x) => x.gender === g)?._count ?? 0;
  const male = n('MALE');
  const female = n('FEMALE');
  const total = groups.reduce((s, g) => s + g._count, 0);
  return { male, female, other: total - male - female };
}

/** Whole years between a birth date and a day (both YYYY-MM-DD). */
export function ageOn(dob: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(dob.slice(0, 4));
  return day.slice(5) < dob.slice(5) ? years - 1 : years;
}
