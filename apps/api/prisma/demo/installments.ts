// Payment plans on a few open demo vouchers: one on track, one with an overdue instalment, one half paid.
import { InvoiceKind, InvoiceStatus, type PrismaClient } from '@prisma/client';
import { addMonths, evenSplit } from '../../src/fees/installments.js';
import { dayStart, localToday } from '../../src/common/dates.js';

export async function seedInstallments(prisma: PrismaClient, slug: string) {
  const school = await prisma.school.findUnique({ where: { slug }, select: { id: true } });
  if (!school || (await prisma.installment.count({ where: { invoice: { schoolId: school.id } } }))) return 0;
  const open = await prisma.invoice.findMany({
    where: { schoolId: school.id, kind: InvoiceKind.MONTHLY, status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] }, total: { gte: 3000 } },
    orderBy: [{ period: 'desc' }, { voucherNo: 'asc' }],
    take: 3,
  });
  const today = localToday();
  // First instalment 3 weeks ago (overdue), due today, and a month ahead.
  const firstDue = [addMonths(today, -1), today, addMonths(today, 1)];
  for (const [n, invoice] of open.entries()) {
    await prisma.installment.createMany({
      data: evenSplit(invoice.total, 3, firstDue[n]).map((p, i) => ({
        invoiceId: invoice.id,
        seq: i + 1,
        dueDate: dayStart(p.dueDate),
        amount: p.amount,
      })),
    });
  }
  return open.length;
}
