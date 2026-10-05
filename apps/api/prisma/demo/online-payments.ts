// Online checkout history for a demo school: recent JazzCash, Easypaisa and
// 1Bill receipts become paid checkouts, plus a few that were declined, timed
// out or need the fee office to look at them.
import { CheckoutStatus, InvoiceStatus, PaymentMethod, type PrismaClient } from '@prisma/client';

const ONLINE: PaymentMethod[] = [PaymentMethod.JAZZCASH, PaymentMethod.EASYPAISA, PaymentMethod.ONEBILL];
const HOUR = 3_600_000;
// Shared across schools so references and 1Bill numbers never repeat in one run.
let n = 0;

export async function seedOnlinePayments(prisma: PrismaClient, slug: string) {
  const school = await prisma.school.findUnique({ where: { slug }, select: { id: true } });
  if (!school || (await prisma.onlinePayment.count({ where: { schoolId: school.id } }))) return 0;
  const schoolId = school.id;
  const since = new Date(Date.now() - 45 * 24 * HOUR);
  const ref = (p: PaymentMethod) => `T${p.slice(0, 2)}${Date.now().toString(36).toUpperCase()}${String(n++).padStart(4, '0')}`;
  const consumer = () => `00000${String(4_000_000_000 + n * 7919).padStart(10, '0')}`;

  const paid = await prisma.payment.findMany({
    where: { schoolId, method: { in: ONLINE }, receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    take: 40,
  });
  for (const p of paid) {
    await prisma.onlinePayment.create({
      data: {
        schoolId,
        invoiceId: p.invoiceId,
        provider: p.method,
        amount: p.amount,
        status: CheckoutStatus.PAID,
        txnRef: ref(p.method),
        consumerNumber: p.method === PaymentMethod.ONEBILL ? consumer() : null,
        providerRef: p.reference,
        responseCode: p.method === PaymentMethod.JAZZCASH ? '000' : p.method === PaymentMethod.EASYPAISA ? 'PAID' : '00',
        paymentId: p.id,
        createdAt: new Date(p.receivedAt.getTime() - 3 * 60_000),
        expiresAt: new Date(p.receivedAt.getTime() + HOUR),
      },
    });
  }

  // Some vouchers still open: a declined wallet, one that timed out, one held for review.
  const open = await prisma.invoice.findMany({
    where: { schoolId, status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] } },
    orderBy: { period: 'desc' },
    take: 3,
  });
  const extras: [PaymentMethod, CheckoutStatus, string | null][] = [
    [PaymentMethod.EASYPAISA, CheckoutStatus.FAILED, 'Transaction declined by the customer'],
    [PaymentMethod.JAZZCASH, CheckoutStatus.PENDING, null],
    [PaymentMethod.JAZZCASH, CheckoutStatus.REVIEW, 'The gateway reported Rs 500 more than the checkout. Check the gateway statement before applying it.'],
  ];
  for (const [i, inv] of open.entries()) {
    const [provider, status, message] = extras[i];
    const createdAt = new Date(Date.now() - (i + 1) * 26 * HOUR);
    await prisma.onlinePayment.create({
      data: {
        schoolId,
        invoiceId: inv.id,
        provider,
        amount: inv.total - inv.paid,
        status,
        txnRef: ref(provider),
        providerRef: status === CheckoutStatus.REVIEW ? `TX${String(8_100_000_000 + i)}` : null,
        message,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + HOUR),
      },
    });
  }
  return paid.length + open.length;
}
