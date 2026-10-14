import { InvoiceLineKind, type Invoice, type Prisma } from '@prisma/client';
import { daysLate, fineDue, invoiceStatus, type FineRule } from './fee-calculator.js';

/**
 * Books the late fine built up on a voucher as a LATE_FINE line, so it is part
 * of what the voucher owes and cannot vanish when only the balance is paid.
 * Runs inside the caller's transaction: when taking a payment and when a run
 * carries the balance forward. Returns the voucher as it now stands.
 */
export async function bookLateFine(
  tx: Prisma.TransactionClient,
  invoice: Invoice,
  asOf: Date,
  rule: FineRule,
): Promise<{ invoice: Invoice; booked: number }> {
  const fine = fineDue(invoice, asOf, rule);
  if (fine <= 0) return { invoice, booked: 0 };
  const days = daysLate(invoice.dueDate, asOf);
  await tx.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      description: `Late fine (${days} ${days === 1 ? 'day' : 'days'} late)`,
      amount: fine,
      kind: InvoiceLineKind.LATE_FINE,
    },
  });
  const total = invoice.total + fine;
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: { total, fineBooked: invoice.fineBooked + fine, status: invoiceStatus(total, invoice.paid) },
  });
  return { invoice: updated, booked: fine };
}
