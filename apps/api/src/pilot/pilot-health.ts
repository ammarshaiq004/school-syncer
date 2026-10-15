import type { Role } from '@prisma/client';
import { nextDay } from '../common/date-range.js';

/** Sums for the console's pilot health page (SCHOOL-150). */

/** Every YYYY-MM-DD day from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) days.push(d);
  return days;
}

/** People who used the app each day, in total and by role (someone with two roles counts under both). */
export function dailyActive(rows: { date: string; roles: Role[] }[], days: string[]) {
  const byDay = new Map(days.map((d) => [d, { date: d, total: 0, byRole: {} as Partial<Record<Role, number>> }]));
  const roles = new Set<Role>();
  for (const r of rows) {
    const day = byDay.get(r.date);
    if (!day) continue;
    day.total += 1;
    for (const role of r.roles) {
      roles.add(role);
      day.byRole[role] = (day.byRole[role] ?? 0) + 1;
    }
  }
  const series = [...byDay.values()];
  const active = series.filter((d) => d.total > 0);
  return {
    roles: [...roles].sort(),
    days: series,
    /** Average over the days anyone used it. */
    averagePerActiveDay: active.length ? Math.round((active.reduce((s, d) => s + d.total, 0) / active.length) * 10) / 10 : 0,
  };
}

/**
 * Days each section's register was taken. A school day is any day some
 * section was marked, so `missed` counts the school days a section was not.
 */
export function attendanceCoverage(
  sections: { id: string; name: string; sort: number }[],
  sessions: { sectionId: string; date: string }[],
) {
  const schoolDays = [...new Set(sessions.map((s) => s.date))].sort();
  const marked = new Map<string, Set<string>>();
  for (const s of sessions) {
    const set = marked.get(s.sectionId) ?? new Set<string>();
    set.add(s.date);
    marked.set(s.sectionId, set);
  }
  return {
    schoolDays: schoolDays.length,
    sections: [...sections]
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((s) => {
        const days = [...(marked.get(s.id) ?? [])].sort();
        return {
          sectionId: s.id,
          name: s.name,
          days: days.length,
          missed: schoolDays.length - days.length,
          lastMarked: days.at(-1) ?? null,
        };
      }),
  };
}

/** The latest of several timestamps, ignoring missing ones. */
export function latest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}
