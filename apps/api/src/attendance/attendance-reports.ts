import type { AttendanceStatus } from '@prisma/client';
import { daysBefore, dayStart } from '../common/dates.js';
import { attendanceRate, emptyCounts, type StatusCounts } from './attendance-matrix.js';

/** Longest span a report covers, so one request stays small. */
export const MAX_REPORT_DAYS = 92;

/** True when `from` to `to` (YYYY-MM-DD) is a forward range of at most MAX_REPORT_DAYS days. */
export function validRange(from: string, to: string): boolean {
  if (from > to) return false;
  return daysBefore(to, MAX_REPORT_DAYS - 1) <= from && !Number.isNaN(dayStart(from).getTime());
}

export interface DayCounts extends StatusCounts {
  date: string;
  rate: number | null;
}

/** One row per day that has marks, oldest first: how many of each status and the attendance rate. */
export function datewiseCounts(rows: { date: string; status: AttendanceStatus }[]): DayCounts[] {
  const byDate = new Map<string, StatusCounts>();
  for (const r of rows) {
    const c = byDate.get(r.date) ?? emptyCounts();
    c[r.status] += 1;
    byDate.set(r.date, c);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, c]) => ({ date, ...c, rate: attendanceRate(c) }));
}

export interface AbsenceRank extends StatusCounts {
  userId: string;
  name: string;
  /** Days with any mark. */
  marked: number;
}

/** Staff ranked by days absent (ties: more late days, then name). Those never absent or late are left out. */
export function rankAbsences(
  rows: { userId: string; name: string; status: AttendanceStatus }[],
  limit: number,
): AbsenceRank[] {
  const byUser = new Map<string, AbsenceRank>();
  for (const r of rows) {
    const rank = byUser.get(r.userId) ?? { userId: r.userId, name: r.name, marked: 0, ...emptyCounts() };
    rank[r.status] += 1;
    rank.marked += 1;
    byUser.set(r.userId, rank);
  }
  return [...byUser.values()]
    .filter((r) => r.ABSENT > 0 || r.LATE > 0)
    .sort((a, b) => b.ABSENT - a.ABSENT || b.LATE - a.LATE || a.name.localeCompare(b.name))
    .slice(0, limit);
}
