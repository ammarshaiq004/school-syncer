import { SubscriptionStatus } from '@prisma/client';
import { daysBefore, localDate } from '../common/dates.js';

export type HealthLabel = 'healthy' | 'watch' | 'at_risk' | 'new' | 'no_data';

export interface HealthSnapshot {
  day: string;
  students: number;
  attendanceSessions: number;
  staffActive7d: number;
}

export interface Health {
  /** 0 to 100; null while a school is new or has no snapshots yet. */
  score: number | null;
  label: HealthLabel;
  /** What cost the school points, in words for support staff. */
  reasons: string[];
}

/** A school set up this recently is not judged yet. */
export const NEW_SCHOOL_DAYS = 14;
/** Snapshots older than this are not needed to score a school. */
export const HEALTH_WINDOW_DAYS = 35;

const PAYMENT_POINTS: Record<SubscriptionStatus, number> = {
  ACTIVE: 25,
  TRIAL: 15,
  PAST_DUE: 5,
  SUSPENDED: 0,
  CANCELLED: 0,
};

/**
 * How well a school is doing, out of 100, from its nightly snapshots:
 * staff signing in (30), class registers taken in the last 7 days (30),
 * its payment record (25) and whether its student count is holding (15).
 * 70 and up is healthy, 40 and up needs watching, below that is at risk.
 * `snapshots` may be in any order.
 */
export function schoolHealth(input: {
  status: SubscriptionStatus;
  createdAt: Date;
  now: Date;
  snapshots: HealthSnapshot[];
}): Health {
  const today = localDate(input.now);
  if (localDate(input.createdAt) > daysBefore(today, NEW_SCHOOL_DAYS)) return { score: null, label: 'new', reasons: [] };
  const snaps = [...input.snapshots].sort((a, b) => a.day.localeCompare(b.day));
  const latest = snaps.at(-1);
  if (!latest) return { score: null, label: 'no_data', reasons: [] };

  const reasons: string[] = [];
  const signIns = latest.staffActive7d > 0 ? 30 : 0;
  if (!signIns) reasons.push('No staff sign-in in the last 7 days');

  const weekStart = daysBefore(today, 6);
  const registerDays = snaps.filter((s) => s.day >= weekStart && s.attendanceSessions > 0).length;
  const registers = Math.min(30, registerDays * 6);
  if (registers < 30) reasons.push(registerDays ? `Attendance taken on ${registerDays} of the last 7 days` : 'No attendance taken in the last 7 days');

  const payment = PAYMENT_POINTS[input.status];
  if (input.status === SubscriptionStatus.PAST_DUE) reasons.push('Bill overdue');
  if (input.status === SubscriptionStatus.SUSPENDED) reasons.push('Suspended');

  // The student count against the oldest snapshot, once there are two weeks of history.
  const first = snaps[0];
  let trend = 10;
  if (latest.day >= daysBefore(first.day, -NEW_SCHOOL_DAYS)) {
    const drop = first.students ? (first.students - latest.students) / first.students : 0;
    trend = drop <= 0 ? 15 : drop <= 0.1 ? 8 : 0;
    if (drop > 0) reasons.push(`Students fell from ${first.students} to ${latest.students}`);
  }

  const score = signIns + registers + payment + trend;
  return { score, label: score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'at_risk', reasons };
}
