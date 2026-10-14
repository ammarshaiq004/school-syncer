import type { AttendanceStatus, InvoiceStatus } from '@prisma/client';

/**
 * Pure rules for the parent invoice and attendance pages (AcademiaOS module C
 * and parent attendance history), unit tested on their own.
 */

export type InvoiceDisplayStatus = 'PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED' | 'CARRIED_FORWARD';

/**
 * The lozenge a parent sees: PAID when settled, OVERDUE when anything is still
 * owed after the due date (a YYYY-MM-DD day, compared with today's local
 * date), PENDING when owed but not yet due. Cancelled stays CANCELLED, and a
 * voucher whose balance moved onto a later one is CARRIED_FORWARD.
 */
export function invoiceDisplayStatus(
  invoice: {
    status: InvoiceStatus;
    dueDate: Date;
    total: number;
    paid: number;
  },
  today: string,
): InvoiceDisplayStatus {
  if (invoice.status === 'CANCELLED') return 'CANCELLED';
  if (invoice.status === 'CARRIED_FORWARD') return 'CARRIED_FORWARD';
  if (invoice.status === 'PAID' || invoice.paid >= invoice.total) return 'PAID';
  return invoice.dueDate.toISOString().slice(0, 10) < today
    ? 'OVERDUE'
    : 'PENDING';
}

export interface InvoiceBreakdown {
  /** Charges before discounts (sum of positive lines). */
  subtotal: number;
  /** Concessions and discounts, as a positive number (sum of negative lines). */
  discounts: number;
  /** Late fee so far (not part of `total`; added to `totalDue`). */
  lateFine: number;
  /** The invoice total as billed (subtotal - discounts). */
  total: number;
  paid: number;
  /** total - paid, never below 0; 0 on a voucher that owes nothing (carried forward). */
  balance: number;
  /** balance + lateFine: what to pay today. 0 once paid. */
  totalDue: number;
}

export function invoiceBreakdown(
  lines: { amount: number }[],
  invoice: { total: number; paid: number },
  lateFine: number,
  /** False for a voucher whose balance is owed elsewhere (carried forward). */
  owing = true,
): InvoiceBreakdown {
  const subtotal = lines
    .filter((l) => l.amount > 0)
    .reduce((s, l) => s + l.amount, 0);
  const discounts = -lines
    .filter((l) => l.amount < 0)
    .reduce((s, l) => s + l.amount, 0);
  const balance = owing ? Math.max(invoice.total - invoice.paid, 0) : 0;
  return {
    subtotal,
    discounts,
    lateFine: balance > 0 ? lateFine : 0,
    total: invoice.total,
    paid: invoice.paid,
    balance,
    totalDue: balance > 0 ? balance + lateFine : 0,
  };
}

export interface AttendanceTally {
  present: number;
  absent: number;
  late: number;
  leave: number;
  /** Days with a record. */
  total: number;
  /** (present + late) / total, as a percent with one decimal; null with no records. */
  rate: number | null;
}

/** Counts statuses; late counts as attended, leave is in the denominator. */
export function attendanceTally(statuses: AttendanceStatus[]): AttendanceTally {
  const n = (s: AttendanceStatus) => statuses.filter((x) => x === s).length;
  const present = n('PRESENT');
  const late = n('LATE');
  const total = statuses.length;
  return {
    present,
    absent: n('ABSENT'),
    late,
    leave: n('LEAVE'),
    total,
    rate: total ? Math.round(((present + late) / total) * 1000) / 10 : null,
  };
}

/** One tally per YYYY-MM month, oldest first, for months that have records. */
export function monthlyTallies(
  days: { date: string; status: AttendanceStatus }[],
): (AttendanceTally & { month: string })[] {
  const byMonth = new Map<string, AttendanceStatus[]>();
  for (const d of days) {
    const m = d.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), d.status]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, statuses]) => ({ month, ...attendanceTally(statuses) }));
}
