import { InvoiceStatus, type Prisma } from '@prisma/client';
import { dayStart, localToday } from '../common/dates.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * A voucher still owing money. Paid, cancelled and carried-forward vouchers
 * owe nothing (a carried balance is owed on the voucher it moved to), and a
 * reversed payment has already been taken off `paid`.
 */
export const OPEN_INVOICE = {
  status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
} satisfies Prisma.InvoiceWhereInput;

/** Open and past its due date as of the school's today (a voucher due today is not late yet). */
export const overdueWhere = (today = localToday()) =>
  ({ ...OPEN_INVOICE, dueDate: { lt: dayStart(today) } }) satisfies Prisma.InvoiceWhereInput;

export interface Owed {
  invoices: number;
  amount: number;
}

/** What is owed once advance credits are taken off; never below zero. */
export interface OwedNet extends Owed {
  /** Advance credits held by the same students. */
  credits: number;
  /** Owed on open vouchers before credits. */
  gross: number;
}

/** Takes advance credits off an owed total. */
export const netOfCredits = (owed: Owed, credits: number): OwedNet => ({
  invoices: owed.invoices,
  amount: Math.max(0, owed.amount - credits),
  credits,
  gross: owed.amount,
});

/**
 * The one "outstanding" calculation the defaulters list, the dashboard, the
 * reports and the fees page all use: the balance (total less live payments)
 * of every open voucher in `where`, and the overdue part of it. Late fines not
 * yet booked are reported separately by the callers that show them.
 */
export async function feeOutstanding(
  prisma: PrismaService | Prisma.TransactionClient,
  where: Prisma.InvoiceWhereInput,
  today = localToday(),
  /** Take the students' advance credits off `outstanding` (for school-wide figures, not filtered lists). */
  withCredits = false,
): Promise<{ outstanding: Owed | OwedNet; overdue: Owed }> {
  const [open, late] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...where, ...OPEN_INVOICE }, _sum: { total: true, paid: true }, _count: true }),
    prisma.invoice.aggregate({ where: { ...where, ...overdueWhere(today) }, _sum: { total: true, paid: true }, _count: true }),
  ]);
  const owed = (a: typeof open): Owed => ({
    invoices: a._count,
    amount: Math.max(0, (a._sum.total ?? 0) - (a._sum.paid ?? 0)),
  });
  if (!withCredits) return { outstanding: owed(open), overdue: owed(late) };
  const credit = await prisma.studentCredit.aggregate({
    where: { schoolId: where.schoolId as string, student: where.student },
    _sum: { amount: true },
  });
  return { outstanding: netOfCredits(owed(open), credit._sum.amount ?? 0), overdue: owed(late) };
}

/** What vouchers billed, leaving out balances carried onto them from earlier vouchers. */
export const billedOf = (sum: { total?: number | null; arrears?: number | null }) => (sum.total ?? 0) - (sum.arrears ?? 0);
