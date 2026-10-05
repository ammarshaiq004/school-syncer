import type { SubmissionStatus } from '@prisma/client';

/**
 * Pure assignment rules (SCHOOL-104): when a student may (re)submit, whether
 * the work is late, and how urgent a due date is. Unit tested on their own.
 *
 * Status meanings: SUBMITTED waits for the teacher; GRADED is final; RETURNED
 * means the teacher sent it back for another go, so the student may resubmit
 * (which clears the points and puts it back to SUBMITTED).
 */

export type SubmitBlock = 'graded' | 'closed' | null;

/** Why a student cannot submit now, or null when they can. */
export function submitBlock(
  a: { dueAt: Date; allowLate: boolean },
  existing: { status: SubmissionStatus } | null | undefined,
  now: Date,
): SubmitBlock {
  if (existing?.status === 'GRADED') return 'graded';
  // A teacher who returns work for another go reopens it, even past the due date.
  if (existing?.status === 'RETURNED') return null;
  if (!a.allowLate && now.getTime() > a.dueAt.getTime()) return 'closed';
  return null;
}

export const SUBMIT_BLOCK_MESSAGE: Record<
  Exclude<SubmitBlock, null>,
  string
> = {
  graded: 'This work has been graded and can no longer be changed',
  closed: 'The due date has passed and late work is not accepted',
};

/** Submitted after the due date? */
export function isLate(dueAt: Date, submittedAt: Date): boolean {
  return submittedAt.getTime() > dueAt.getTime();
}

export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

/**
 * How pressing an open assignment is: overdue (past due), today (due within
 * 24 hours), soon (within 3 days) or later.
 */
export function dueUrgency(dueAt: Date, now: Date): Urgency {
  const hours = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return 'overdue';
  if (hours <= 24) return 'today';
  if (hours <= 72) return 'soon';
  return 'later';
}

/** Whole hours until the due date (negative once past). */
export function hoursLeft(dueAt: Date, now: Date): number {
  const ms = dueAt.getTime() - now.getTime();
  return ms >= 0 ? Math.floor(ms / 3_600_000) : -Math.ceil(-ms / 3_600_000);
}

/** Why a grade cannot be saved, or null. */
export function gradeProblem(points: number, maxPoints: number): string | null {
  if (!Number.isInteger(points) || points < 0)
    return 'Points must be a whole number of 0 or more';
  if (points > maxPoints) return `Points cannot be more than ${maxPoints}`;
  return null;
}

/** Sort key for the student list: open work by due date first, then finished work newest first. */
export function studentOrder(
  a: { state: string; dueAt: Date },
  b: { state: string; dueAt: Date },
): number {
  const open = (s: string) => (s === 'pending' || s === 'overdue' ? 0 : 1);
  const diff = open(a.state) - open(b.state);
  if (diff) return diff;
  return open(a.state) === 0
    ? a.dueAt.getTime() - b.dueAt.getTime()
    : b.dueAt.getTime() - a.dueAt.getTime();
}
