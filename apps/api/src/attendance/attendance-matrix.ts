import type { AttendanceStatus } from '@prisma/client';

/** Every status, in the order the matrix legend shows them. */
export const MATRIX_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const satisfies readonly AttendanceStatus[];

export type StatusCounts = Record<AttendanceStatus, number>;

export interface MatrixDay {
  date: string;
  /** Monday to Saturday, or any day a register was actually taken (e.g. a Sunday make-up day). */
  isSchoolDay: boolean;
  /** The attendance session for that day, when one was taken. */
  sessionId: string | null;
}

export const emptyCounts = (): StatusCounts => ({ PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 });

/** First day of a YYYY-MM month and the first day of the next one, as YYYY-MM-DD. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Every day of the month. Sundays are off unless a register was taken that
 * day; there is no holiday calendar yet, so other days count as school days.
 */
export function monthDays(month: string, sessions: Map<string, string>): MatrixDay[] {
  const { start, end } = monthBounds(month);
  const days: MatrixDay[] = [];
  for (const d = new Date(`${start}T00:00:00.000Z`); d.toISOString().slice(0, 10) < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const sessionId = sessions.get(date) ?? null;
    days.push({ date, isSchoolDay: d.getUTCDay() !== 0 || sessionId !== null, sessionId });
  }
  return days;
}

/**
 * Attendance rate as a percentage with one decimal: present and late days
 * over days marked. Leave counts as a marked day that is not attended. Null
 * when nothing was marked, so "no data" never reads as 0%.
 */
export function attendanceRate(counts: Partial<StatusCounts>): number | null {
  const marked = (counts.PRESENT ?? 0) + (counts.ABSENT ?? 0) + (counts.LATE ?? 0) + (counts.LEAVE ?? 0);
  if (!marked) return null;
  return Math.round((((counts.PRESENT ?? 0) + (counts.LATE ?? 0)) / marked) * 1000) / 10;
}

export interface MatrixStudentInput {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  photoUrl: string | null;
}

export interface MatrixRecordInput {
  studentId: string;
  date: string;
  status: AttendanceStatus;
}

/** Folds the month's records into per-student rows and per-day/month totals. */
export function buildMatrix(students: MatrixStudentInput[], records: MatrixRecordInput[], days: MatrixDay[]) {
  const byStudent = new Map<string, Record<string, AttendanceStatus>>();
  const byDate: Record<string, StatusCounts & { unmarked: number }> = {};
  for (const day of days) {
    if (day.sessionId) byDate[day.date] = { ...emptyCounts(), unmarked: students.length };
  }
  const enrolled = new Set(students.map((s) => s.id));
  const month = emptyCounts();
  for (const r of records) {
    if (!enrolled.has(r.studentId)) continue;
    const row = byStudent.get(r.studentId) ?? {};
    row[r.date] = r.status;
    byStudent.set(r.studentId, row);
    const day = byDate[r.date];
    if (day) {
      day[r.status] += 1;
      day.unmarked -= 1;
    }
    month[r.status] += 1;
  }
  const rows = students.map((s) => {
    const statuses = byStudent.get(s.id) ?? {};
    const counts = emptyCounts();
    for (const status of Object.values(statuses)) counts[status] += 1;
    return { ...s, statuses, counts, rate: attendanceRate(counts) };
  });
  return {
    students: rows,
    totals: {
      students: students.length,
      sessions: days.filter((d) => d.sessionId).length,
      schoolDays: days.filter((d) => d.isSchoolDay).length,
      ...month,
      rate: attendanceRate(month),
      byDate,
    },
  };
}
