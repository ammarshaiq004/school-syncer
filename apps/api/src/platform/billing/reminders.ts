import { GRACE_DAYS } from '../plans.js';

/** Reminders about an unpaid bill, by days from its due date. */
export const REMINDERS = [
  { kind: 'bill.due_soon', day: -3 },
  { kind: 'bill.due_today', day: 0 },
  { kind: 'bill.overdue', day: 7 },
  // The day before the school goes read-only (GRACE_DAYS after the due date).
  { kind: 'bill.read_only_tomorrow', day: GRACE_DAYS - 1 },
] as const;

export type ReminderKind = (typeof REMINDERS)[number]['kind'];

/** Whole days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The reminder to send today for a bill due on `dueDate`, if any. Only the
 * latest one that is due counts: a server that was down for a few days sends
 * the current reminder, not the ones it missed. Before the first reminder, or
 * once the read-only warning is past, nothing is sent.
 */
export function reminderDue(dueDate: string, today: string): ReminderKind | null {
  const day = daysBetween(dueDate, today);
  let due: ReminderKind | null = null;
  for (const r of REMINDERS) if (day >= r.day) due = r.kind;
  if (day >= GRACE_DAYS) return null;
  return due;
}
