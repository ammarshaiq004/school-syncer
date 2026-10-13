import { ConcessionType, FeeFrequency, InvoiceStatus } from '@prisma/client';

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
}

export interface InvoiceLineDraft {
  feeHeadId: string | null;
  description: string;
  amount: number;
}

/**
 * Lines for one student's invoice in a billing month. Monthly heads bill every
 * month; annual heads bill only in the academic year's first month. One-time
 * heads (admission fee and the like) are billed separately, not here.
 * Concessions reduce a head's amount and appear as their own negative line.
 */
export function invoiceLines(
  structures: StructureRow[],
  concessions: ConcessionRow[],
  isFirstMonthOfYear: boolean,
): InvoiceLineDraft[] {
  const lines: InvoiceLineDraft[] = [];
  for (const s of structures) {
    const due =
      s.frequency === FeeFrequency.MONTHLY ||
      (s.frequency === FeeFrequency.ANNUAL && isFirstMonthOfYear);
    if (!due || s.amount <= 0) continue;
    lines.push({ feeHeadId: s.feeHeadId, description: s.feeHeadName, amount: s.amount });

    const c = concessions.find((x) => x.feeHeadId === s.feeHeadId);
    if (!c) continue;
    const off =
      c.type === ConcessionType.PERCENT
        ? Math.round((s.amount * Math.min(c.value, 100)) / 100)
        : Math.min(c.value, s.amount);
    if (off > 0) {
      lines.push({ feeHeadId: s.feeHeadId, description: `${s.feeHeadName} concession`, amount: -off });
    }
  }
  return lines;
}

/** Late fine for an invoice, in rupees, as of a given day. */
export function lateFine(dueDate: Date, asOf: Date, perDay: number): number {
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  return days > 0 ? days * perDay : 0;
}

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
