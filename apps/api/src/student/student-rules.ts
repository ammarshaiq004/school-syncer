import { Audience, LiveStatus, SubmissionStatus } from '@prisma/client';

/**
 * Pure rules behind the student workspace and the parent learning view. No
 * Prisma client or Nest here, so they are unit tested on their own.
 */

/** ISO weekday of a YYYY-MM-DD day: 1 = Monday ... 7 = Sunday (TimetableSlot.dayOfWeek). */
export function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The YYYY-MM-DD day after another. */
export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM month, or null when the month is malformed. */
export function monthBounds(month: string): { first: string; last: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** Where a student sits, as far as announcements are concerned. */
export interface AudienceTarget {
  campusId: string;
  classId: string | null;
  sectionId: string | null;
}

/**
 * The announcements a student (or a parent, for one child) should see: the
 * whole school, their campus, their class and their section. The same rules
 * the announcements module uses when it picks WhatsApp recipients.
 */
export function announcementAudience(target: AudienceTarget) {
  const or: { audience: Audience; targetId?: string }[] = [
    { audience: Audience.SCHOOL },
    { audience: Audience.CAMPUS, targetId: target.campusId },
  ];
  if (target.classId) or.push({ audience: Audience.CLASS, targetId: target.classId });
  if (target.sectionId) or.push({ audience: Audience.SECTION, targetId: target.sectionId });
  return or;
}

/** True when an announcement with this audience reaches this student. */
export function announcementReaches(
  a: { audience: Audience; targetId: string | null },
  target: AudienceTarget,
): boolean {
  return announcementAudience(target).some(
    (rule) => rule.audience === a.audience && (rule.targetId === undefined || rule.targetId === a.targetId),
  );
}

/** Students may open a live class from this long before it starts. */
export const JOIN_EARLY_MS = 15 * 60_000;

export type LiveState = 'upcoming' | 'live' | 'ended' | 'cancelled';

/**
 * How a live class looks to a student right now. The teacher's start/end wins;
 * a scheduled class whose time has fully passed counts as ended. canJoin covers
 * 15 minutes before the start until the scheduled end (or while the teacher has
 * it live).
 */
export function liveClassState(
  lc: { status: LiveStatus; startsAt: Date; durationMin: number },
  now: Date,
): { state: LiveState; canJoin: boolean; endsAt: Date } {
  const start = lc.startsAt.getTime();
  const endsAt = new Date(start + lc.durationMin * 60_000);
  const t = now.getTime();
  if (lc.status === LiveStatus.CANCELLED) return { state: 'cancelled', canJoin: false, endsAt };
  if (lc.status === LiveStatus.ENDED) return { state: 'ended', canJoin: false, endsAt };
  if (lc.status === LiveStatus.LIVE) return { state: 'live', canJoin: true, endsAt };
  if (t > endsAt.getTime()) return { state: 'ended', canJoin: false, endsAt };
  const canJoin = t >= start - JOIN_EARLY_MS;
  return { state: t >= start ? 'live' : 'upcoming', canJoin, endsAt };
}

export type AssignmentState = 'pending' | 'overdue' | 'missing' | 'submitted' | 'graded' | 'returned';

/**
 * A student's standing on one assignment. overdue = past due but late work is
 * still accepted; missing = past due and closed.
 */
export function assignmentState(
  a: { dueAt: Date; allowLate: boolean },
  submission: { status: SubmissionStatus } | null | undefined,
  now: Date,
): AssignmentState {
  if (submission) {
    if (submission.status === SubmissionStatus.GRADED) return 'graded';
    if (submission.status === SubmissionStatus.RETURNED) return 'returned';
    return 'submitted';
  }
  if (now.getTime() <= a.dueAt.getTime()) return 'pending';
  return a.allowLate ? 'overdue' : 'missing';
}

/** Whole-number completion percentage; 0 when there is nothing to complete. */
export function percent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** Best and latest submitted score of a student's quiz attempts. */
export function quizScores(
  attempts: { submittedAt: Date | null; score: number | null; maxScore: number; needsReview: boolean }[],
) {
  const done = attempts
    .filter((a) => a.submittedAt !== null)
    .sort((a, b) => (a.submittedAt as Date).getTime() - (b.submittedAt as Date).getTime());
  const scored = done.filter((a) => a.score !== null);
  const pct = (a: { score: number | null; maxScore: number }) =>
    a.maxScore > 0 ? Math.round(((a.score ?? 0) / a.maxScore) * 1000) / 10 : 0;
  const best = scored.reduce<(typeof scored)[number] | null>(
    (top, a) => (!top || pct(a) > pct(top) ? a : top),
    null,
  );
  const latest = done.at(-1) ?? null;
  return {
    attempts: attempts.length,
    submitted: done.length,
    inProgress: attempts.some((a) => a.submittedAt === null),
    best: best ? { score: best.score as number, maxScore: best.maxScore, percent: pct(best) } : null,
    latest: latest
      ? {
          score: latest.score,
          maxScore: latest.maxScore,
          percent: latest.score === null ? null : pct(latest),
          submittedAt: latest.submittedAt,
          needsReview: latest.needsReview,
        }
      : null,
  };
}

/** Is a published quiz open for attempts right now? */
export function quizIsOpen(q: { opensAt: Date | null; closesAt: Date | null }, now: Date): boolean {
  if (q.opensAt && q.opensAt.getTime() > now.getTime()) return false;
  if (q.closesAt && q.closesAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Day counts for an attendance summary; late counts as present. */
export function attendanceSummary(statuses: string[]) {
  const count = (s: string) => statuses.filter((x) => x === s).length;
  const present = count('PRESENT');
  const late = count('LATE');
  const absent = count('ABSENT');
  const leave = count('LEAVE');
  const total = statuses.length;
  return { present, late, absent, leave, total, percent: percent(present + late, total) };
}
