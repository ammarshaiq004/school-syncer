import { daysBefore, localDate } from '../common/dates.js';

export interface GuardianLogin {
  id: string;
  name: string;
  phone: string;
  userId: string | null;
  lastLoginAt: Date | null;
  students: { name: string; className: string }[];
}

export type LoginStatus = 'NO_ACCOUNT' | 'NEVER' | 'INACTIVE' | 'ACTIVE';

/** Days without opening the app before a parent counts as inactive. */
export const INACTIVE_AFTER_DAYS = 30;

/**
 * How many families use the parent portal and app: who has no login yet, who
 * has one but never signed in, who has gone quiet, and who is active. Last
 * seen is the later of the last sign-in and the last day the API saw them.
 * `activity` is one row per parent user per day (UserActivityDay).
 */
export function parentLoginStats(guardians: GuardianLogin[], activity: { userId: string; date: string }[], today: string) {
  const lastSeenDay = new Map<string, string>();
  const perDay = new Map<string, Set<string>>();
  for (const a of activity) {
    if (a.date > (lastSeenDay.get(a.userId) ?? '')) lastSeenDay.set(a.userId, a.date);
    if (!perDay.has(a.date)) perDay.set(a.date, new Set());
    perDay.get(a.date)!.add(a.userId);
  }
  const since30 = daysBefore(today, INACTIVE_AFTER_DAYS - 1);
  const since7 = daysBefore(today, 6);

  const totals = { families: guardians.length, noAccount: 0, never: 0, inactive: 0, active: 0, active7: 0 };
  const byClass = new Map<string, { families: number; withLogin: number; active: number }>();
  const families = guardians.map((g) => {
    const login = g.lastLoginAt ? localDate(g.lastLoginAt) : '';
    const lastSeen = [login, g.userId ? (lastSeenDay.get(g.userId) ?? '') : ''].sort().at(-1) || null;
    let status: LoginStatus;
    if (!g.userId) status = 'NO_ACCOUNT';
    else if (!lastSeen) status = 'NEVER';
    else status = lastSeen >= since30 ? 'ACTIVE' : 'INACTIVE';
    if (status === 'NO_ACCOUNT') totals.noAccount++;
    else if (status === 'NEVER') totals.never++;
    else if (status === 'INACTIVE') totals.inactive++;
    else totals.active++;
    if (lastSeen && lastSeen >= since7) totals.active7++;
    for (const className of new Set(g.students.map((s) => s.className))) {
      const c = byClass.get(className) ?? { families: 0, withLogin: 0, active: 0 };
      c.families++;
      if (g.userId) c.withLogin++;
      if (status === 'ACTIVE') c.active++;
      byClass.set(className, c);
    }
    return { id: g.id, name: g.name, phone: g.phone, students: g.students, status, lastSeen };
  });

  const daily = Array.from({ length: INACTIVE_AFTER_DAYS }, (_, i) => {
    const date = daysBefore(today, INACTIVE_AFTER_DAYS - 1 - i);
    return { date, parents: perDay.get(date)?.size ?? 0 };
  });
  const order: Record<LoginStatus, number> = { NO_ACCOUNT: 0, NEVER: 1, INACTIVE: 2, ACTIVE: 3 };
  return {
    totals,
    daily,
    byClass: [...byClass].map(([className, v]) => ({ className, ...v })).sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true })),
    // Families who need a nudge first: no login, then never signed in, then gone quiet.
    families: families.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)),
  };
}
