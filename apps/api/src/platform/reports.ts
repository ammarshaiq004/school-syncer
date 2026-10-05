import { SubscriptionStatus } from '@prisma/client';
import { localDate } from '../common/dates.js';

/**
 * The last `n` calendar months as "YYYY-MM", oldest first, ending with the
 * current month in the school timezone (Asia/Karachi), like invoice periods.
 */
export function monthKeys(now: Date, n = 12): string[] {
  const [y, m1] = localDate(now).split('-').map(Number);
  const m = m1 - 1;
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(y, m - (n - 1 - i), 1)).toISOString().slice(0, 7),
  );
}

/** Sums values into the given months (school timezone); rows outside them are ignored. */
export function byMonth(
  keys: string[],
  rows: { at: Date; value?: number }[],
): { month: string; value: number }[] {
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = localDate(r.at).slice(0, 7);
    if (totals.has(k)) totals.set(k, totals.get(k)! + (r.value ?? 1));
  }
  return keys.map((month) => ({ month, value: totals.get(month)! }));
}

/**
 * Of the schools whose trial is over, the share now paying. Schools still in
 * a running trial are left out; an expired trial, a closed or suspended school
 * counts as lost. Schools created straight onto a paid plan count as converted,
 * since history of the original status is not kept.
 */
export function trialConversion(
  subs: { status: SubscriptionStatus; trialEndsAt: Date | null }[],
  now: Date,
) {
  let converted = 0;
  let lost = 0;
  let inTrial = 0;
  for (const s of subs) {
    if (s.status === SubscriptionStatus.TRIAL) {
      if (s.trialEndsAt && s.trialEndsAt < now) lost += 1;
      else inTrial += 1;
    } else if (
      s.status === SubscriptionStatus.ACTIVE ||
      s.status === SubscriptionStatus.PAST_DUE
    ) {
      converted += 1;
    } else {
      lost += 1;
    }
  }
  const decided = converted + lost;
  return {
    converted,
    lost,
    inTrial,
    rate: decided ? Math.round((converted / decided) * 1000) / 10 : null,
  };
}

/**
 * Schools whose latest bill was for fewer students than the one before,
 * from bills ordered by period. Returns schoolId -> [previous, latest].
 */
export function fallingStudents(
  bills: { schoolId: string; period: string; students: number }[],
): Map<string, [number, number]> {
  const last2 = new Map<string, { period: string; students: number }[]>();
  for (const b of [...bills].sort((a, b) => a.period.localeCompare(b.period))) {
    const list = last2.get(b.schoolId) ?? [];
    list.push(b);
    if (list.length > 2) list.shift();
    last2.set(b.schoolId, list);
  }
  const out = new Map<string, [number, number]>();
  for (const [schoolId, [prev, latest]] of last2) {
    if (latest && latest.students < prev.students)
      out.set(schoolId, [prev.students, latest.students]);
  }
  return out;
}

const DAY = 86_400_000;

/**
 * The churn-risk entry for a school on TRIAL: an expired trial (the school is
 * read-only and should be called first), a trial ending within `withinDays`,
 * or null when the trial is further off or has no end date.
 */
export function trialRisk(
  trialEndsAt: Date | null,
  now: Date,
  withinDays = 7,
): { reason: 'trial_ended' | 'trial_ending'; detail: string } | null {
  if (!trialEndsAt) return null;
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  if (trialEndsAt < now) {
    const days = Math.floor((+now - +trialEndsAt) / DAY);
    return {
      reason: 'trial_ended',
      detail: days
        ? `Trial ended ${plural(days)} ago, read-only`
        : 'Trial ended today, read-only',
    };
  }
  if (+trialEndsAt - +now <= withinDays * DAY) {
    const days = Math.ceil((+trialEndsAt - +now) / DAY);
    return { reason: 'trial_ending', detail: `Trial ends in ${plural(days)}` };
  }
  return null;
}
