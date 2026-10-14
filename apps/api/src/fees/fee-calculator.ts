import { ConcessionType, FeeFrequency, InvoiceLineKind, InvoiceStatus } from '@prisma/client';

export interface StructureRow {
  feeHeadId: string;
  feeHeadName: string;
  frequency: FeeFrequency;
  amount: number;
}

export interface ConcessionRow {
  feeHeadId: string;
  type: ConcessionType;
  value: number;
  /** First and last billing months (YYYY-MM) the concession covers; null = open-ended. */
  validFrom?: string | null;
  validTo?: string | null;
}

/** The school's sibling discount as it applies to one student. */
export interface SiblingRule {
  /** 1 for the eldest-admitted child of a family (pays in full), 2 for the next, and so on. */
  rank: number;
  secondPercent: number;
  thirdPercent: number;
  feeHeadIds: string[];
}

export interface InvoiceLineDraft {
  feeHeadId: string | null;
  description: string;
  amount: number;
  kind?: InvoiceLineKind;
}

/** Whether a concession covers a billing month. */
export function concessionApplies(c: ConcessionRow, period: string): boolean {
  return (!c.validFrom || c.validFrom <= period) && (!c.validTo || period <= c.validTo);
}

/** The sibling discount percent for a child's place in the family (0 for the first). */
export function siblingPercent(rule: SiblingRule): number {
  if (rule.rank <= 1) return 0;
  return Math.min(100, Math.max(0, rule.rank === 2 ? rule.secondPercent : rule.thirdPercent));
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/**
 * Lines for one student's invoice in a billing month. Monthly heads bill every
 * month; annual heads bill only in the academic year's first month. One-time
 * heads (admission fee and the like) are billed separately, not here.
 * Concessions in force that month reduce a head's amount and appear as their
 * own negative line; the sibling discount then comes off what is left, on its
 * own clearly labelled line.
 */
export function invoiceLines(
  structures: StructureRow[],
  concessions: ConcessionRow[],
  isFirstMonthOfYear: boolean,
  period?: string,
  sibling?: SiblingRule,
): InvoiceLineDraft[] {
  const lines: InvoiceLineDraft[] = [];
  const siblingOff = sibling ? siblingPercent(sibling) : 0;
  for (const s of structures) {
    const due =
      s.frequency === FeeFrequency.MONTHLY ||
      (s.frequency === FeeFrequency.ANNUAL && isFirstMonthOfYear);
    if (!due || s.amount <= 0) continue;
    lines.push({ feeHeadId: s.feeHeadId, description: s.feeHeadName, amount: s.amount });

    let remaining = s.amount;
    const c = concessions.find((x) => x.feeHeadId === s.feeHeadId && (!period || concessionApplies(x, period)));
    if (c) {
      const off =
        c.type === ConcessionType.PERCENT
          ? Math.round((s.amount * Math.min(c.value, 100)) / 100)
          : Math.min(c.value, s.amount);
      if (off > 0) {
        lines.push({ feeHeadId: s.feeHeadId, description: `${s.feeHeadName} concession`, amount: -off });
        remaining -= off;
      }
    }
    if (sibling && siblingOff > 0 && remaining > 0 && sibling.feeHeadIds.includes(s.feeHeadId)) {
      const off = Math.min(remaining, Math.round((remaining * siblingOff) / 100));
      if (off > 0) {
        lines.push({
          feeHeadId: s.feeHeadId,
          description: `${s.feeHeadName} sibling discount (${ordinal(sibling.rank)} child, ${siblingOff}%)`,
          amount: -off,
          kind: InvoiceLineKind.SIBLING_DISCOUNT,
        });
      }
    }
  }
  return lines;
}

/** How a school charges for paying late: per day, optionally capped by days and by rupees. */
export interface FineRule {
  perDay: number;
  /** At most this many days are charged; null = no limit. */
  maxDays?: number | null;
  /** At most this many rupees on one voucher; null = no limit. */
  cap?: number | null;
}

/** The fine rule from a school's settings. */
export const fineRule = (school: { lateFeePerDay: number; lateFeeMaxDays?: number | null; lateFeeCap?: number | null }): FineRule => ({
  perDay: school.lateFeePerDay,
  maxDays: school.lateFeeMaxDays ?? null,
  cap: school.lateFeeCap ?? null,
});

/** Late fine for an invoice, in rupees, as of a given day, within the school's caps. */
export function lateFine(dueDate: Date, asOf: Date, rule: FineRule): number {
  const late = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  if (late <= 0 || rule.perDay <= 0) return 0;
  const days = rule.maxDays != null ? Math.min(late, rule.maxDays) : late;
  const fine = days * rule.perDay;
  return rule.cap != null ? Math.min(fine, rule.cap) : fine;
}

export interface FineInvoice {
  dueDate: Date;
  total: number;
  paid: number;
  status: InvoiceStatus;
  /** Fine already on the voucher as LATE_FINE lines (and so already in `total`). */
  fineBooked: number;
  fineWaivedAt: Date | null;
}

/**
 * Late fine built up on a voucher and not yet booked onto it: the fine so far
 * (within the caps) less what earlier bookings already added to its total, so
 * the two are never counted twice. Nothing builds up on a settled, cancelled
 * or carried-forward voucher, or once the fine was waived.
 */
export function fineDue(invoice: FineInvoice, asOf: Date, rule: FineRule): number {
  const open = invoice.status === InvoiceStatus.UNPAID || invoice.status === InvoiceStatus.PARTIAL;
  if (!open || invoice.fineWaivedAt || invoice.total - invoice.paid <= 0) return 0;
  return Math.max(0, lateFine(invoice.dueDate, asOf, rule) - invoice.fineBooked);
}

/** Whole days a voucher is past its due date as of a day (0 when not yet due). */
export const daysLate = (dueDate: Date, asOf: Date) =>
  Math.max(0, Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000));

/**
 * An invoice's status from what it bills and what has been paid against it:
 * settled once the payments cover the total (a nil voucher is settled), part
 * paid while some money is in, otherwise unpaid. Cancelled is set by hand.
 */
export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (paid >= total) return InvoiceStatus.PAID;
  return paid > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID;
}

/** Rupees as the counter reads them, for payment messages: "Rs 12,500". */
const rupees = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/**
 * Why a payment cannot be taken against an invoice, or null when it can. A
 * settled voucher takes nothing more, and nothing above the balance (plus any
 * late fine collected with it) is accepted, so a mistyped amount cannot leave
 * the invoice over-paid.
 */
export function paymentRejection(
  amount: number,
  invoice: { total: number; paid: number },
  fine = 0,
): string | null {
  const balance = Math.max(0, invoice.total - invoice.paid);
  if (balance === 0) {
    return 'This voucher is already paid in full, so no further payment can be recorded.';
  }
  const allowed = balance + Math.max(0, fine);
  if (amount > allowed) {
    return fine > 0
      ? `${rupees(amount)} is more than this voucher's balance of ${rupees(balance)} plus the ${rupees(fine)} late fine. Collect at most ${rupees(allowed)}.`
      : `${rupees(amount)} is more than this voucher's balance of ${rupees(balance)}. Collect at most ${rupees(balance)}.`;
  }
  return null;
}
