import { ConcessionType, FeeFrequency } from '@prisma/client';

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
