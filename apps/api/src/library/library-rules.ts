import { daysBefore } from '../common/dates.js';

/** The day a book is due back: issued day plus the school's loan period. */
export function dueDate(issuedOn: string, loanDays: number): string {
  return daysBefore(issuedOn, -loanDays);
}

/** Whole days between two YYYY-MM-DD days; zero or less when on time. */
export function daysLate(dueOn: string, on: string): number {
  return Math.round(
    (Date.parse(`${on}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Late fine in rupees for a book returned (or still out) on a given day. */
export function lateFine(dueOn: string, on: string, perDay: number): number {
  return Math.max(0, daysLate(dueOn, on)) * perDay;
}

/**
 * The next accession numbers after the highest numeric one in use. Schools
 * that stamp their own codes ("REF-12") keep them; new copies continue the
 * plain numbers.
 */
export function nextAccessionNumbers(
  existing: string[],
  count: number,
): string[] {
  const highest = existing.reduce(
    (max, a) => (/^\d+$/.test(a) ? Math.max(max, Number(a)) : max),
    0,
  );
  return Array.from({ length: count }, (_, i) => String(highest + i + 1));
}
