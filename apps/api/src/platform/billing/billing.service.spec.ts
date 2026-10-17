import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  PlatformInvoiceStatus,
  PlatformPaymentStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import type { EmailService } from '../../notifications/email.service.js';
import type { NotificationsService } from '../../notifications/notifications.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { SubscriptionService } from '../subscription.service.js';
import { BillingService, nextPeriod, nextReceiptNumber } from './billing.service.js';

const clash = (target: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv1',
  number: 'SS-202610-0001',
  schoolId: 's1',
  period: '2026-10',
  planName: 'Growth',
  students: 200,
  amount: 13_800,
  amountPaid: 0,
  dueDate: new Date('2026-10-10T00:00:00Z'),
  status: PlatformInvoiceStatus.UNPAID,
  paidAt: null as Date | null,
  method: null as string | null,
  reference: null as string | null,
  ...over,
});

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'pay1',
  number: 'SR-202610-0001',
  schoolId: 's1',
  amount: 5_000,
  method: 'Bank transfer',
  reference: 'TRX1',
  receivedOn: new Date('2026-10-05T00:00:00Z'),
  createdAt: new Date('2026-10-05T10:00:00Z'),
  status: PlatformPaymentStatus.RECORDED,
  ...over,
});

function setup() {
  const prisma = {
    platformSettings: { upsert: vi.fn().mockResolvedValue({ salesTaxPercent: null }) },
    subscription: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    student: { groupBy: vi.fn().mockResolvedValue([]) },
    school: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
    user: {
      findMany: vi.fn().mockResolvedValue([
        { phone: '923001234567', email: 'owner@demo.pk' },
        { phone: null, email: null },
      ]),
    },
    platformInvoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    platformPayment: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    platformPaymentAllocation: { deleteMany: vi.fn(), createMany: vi.fn() },
    platformNotice: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const subscriptions = { forget: vi.fn() };
  const notifications = { send: vi.fn() };
  const email = { send: vi.fn() };
  const service = new BillingService(
    prisma as unknown as PrismaService,
    subscriptions as unknown as SubscriptionService,
    notifications as unknown as NotificationsService,
    email as unknown as EmailService,
  );
  return { service, prisma, subscriptions, notifications, email };
}

describe('billing numbers', () => {
  it('moves to the next month, across the year end', () => {
    expect(nextPeriod('2026-10')).toBe('2026-11');
    expect(nextPeriod('2026-12')).toBe('2027-01');
  });

  it('numbers receipts per month', () => {
    expect(nextReceiptNumber('2026-10', null)).toBe('SR-202610-0001');
    expect(nextReceiptNumber('2026-10', 'SR-202610-0009')).toBe('SR-202610-0010');
    expect(nextReceiptNumber('2026-11', 'SR-202610-0009')).toBe('SR-202611-0001');
  });
});

describe('BillingService.issueBills', () => {
  it('does nothing when no school is due a bill', async () => {
    const { service, prisma } = setup();
    expect(await service.issueBills('2026-10')).toEqual({ created: 0, total: 0, invoices: [] });
    expect(prisma.platformInvoice.create).not.toHaveBeenCalled();
  });

  it('bills each school at its student count, retries a taken number and skips one already billed', async () => {
    const { service, prisma, notifications, email } = setup();
    const plan = { name: 'Growth', pricePerStudent: 69, minimumMonthly: 10_000 };
    prisma.subscription.findMany.mockResolvedValue([
      { schoolId: 's1', plan },
      { schoolId: 's2', plan },
    ]);
    prisma.platformSettings.upsert.mockResolvedValue({ salesTaxPercent: 10 });
    prisma.student.groupBy.mockResolvedValue([{ schoolId: 's1', _count: 200 }]);
    const created = invoice({ amount: 15_180 });
    prisma.platformInvoice.create
      .mockRejectedValueOnce(clash('number'))
      .mockResolvedValueOnce(created)
      .mockRejectedValueOnce(clash('schoolId,period'));
    prisma.platformInvoice.findUniqueOrThrow.mockResolvedValue(created);

    const result = await service.issueBills('2026-10');

    expect(result).toMatchObject({ created: 1, total: 15_180 });
    const data = prisma.platformInvoice.create.mock.calls[1][0].data;
    expect(data).toMatchObject({
      schoolId: 's1',
      students: 200,
      amount: 15_180,
      taxAmount: 1_380,
      dueDate: new Date('2026-10-10T00:00:00Z'),
    });
    // s2 has no students: billed at the minimum, but it already had a bill.
    expect(prisma.platformInvoice.create.mock.calls[2][0].data.amount).toBe(11_000);
    expect(prisma.platformNotice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'bill.issued', dedupeKey: 'inv1:bill.issued' }),
    });
    expect(notifications.send).toHaveBeenCalledWith(
      's1',
      [expect.objectContaining({ to: '923001234567', template: 'platform.billing' })],
      { platform: true },
    );
    expect(email.send.mock.calls[0][1]).toEqual([
      expect.objectContaining({ to: 'owner@demo.pk', subject: expect.stringContaining('October 2026 bill') }),
    ]);
  });

  it('stays quiet when asked not to notify and rethrows other errors', async () => {
    const { service, prisma } = setup();
    prisma.subscription.findMany.mockResolvedValue([
      { schoolId: 's1', plan: { name: 'Starter', pricePerStudent: 49, minimumMonthly: 5_000 } },
    ]);
    prisma.platformInvoice.create.mockResolvedValueOnce(invoice());
    await service.issueBills('2026-10', { schoolId: 's1', notify: false });
    expect(prisma.platformNotice.create).not.toHaveBeenCalled();

    prisma.platformInvoice.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.issueBills('2026-10')).rejects.toThrow('db down');
  });

  it('gives up after five numbering clashes', async () => {
    const { service, prisma } = setup();
    prisma.subscription.findMany.mockResolvedValue([
      { schoolId: 's1', plan: { name: 'Starter', pricePerStudent: 49, minimumMonthly: 5_000 } },
    ]);
    prisma.platformInvoice.create.mockRejectedValue(clash('number'));
    await expect(service.issueBills('2026-10')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.platformInvoice.create).toHaveBeenCalledTimes(5);
  });
});

describe('BillingService bills and payments', () => {
  it('voids only unpaid bills', async () => {
    const { service, prisma } = setup();
    prisma.platformInvoice.findUnique.mockResolvedValueOnce(null);
    await expect(service.voidInvoice('x', 'mistake')).rejects.toBeInstanceOf(NotFoundException);
    prisma.platformInvoice.findUnique.mockResolvedValueOnce(invoice({ status: PlatformInvoiceStatus.PAID }));
    await expect(service.voidInvoice('inv1', 'mistake')).rejects.toBeInstanceOf(ConflictException);

    prisma.platformInvoice.findUnique.mockResolvedValueOnce(invoice());
    prisma.platformInvoice.findUniqueOrThrow.mockResolvedValueOnce(invoice({ status: PlatformInvoiceStatus.VOID }));
    const voided = await service.voidInvoice('inv1', 'mistake');
    expect(voided.status).toBe(PlatformInvoiceStatus.VOID);
    expect(prisma.platformInvoice.update).toHaveBeenCalledWith({
      where: { id: 'inv1' },
      data: { status: PlatformInvoiceStatus.VOID, voidReason: 'mistake' },
    });
  });

  it('records a payment with the next receipt number, retrying a clash, and tells the owner', async () => {
    const { service, prisma } = setup();
    const p = payment();
    prisma.platformPayment.findFirst.mockResolvedValue({ number: 'SR-202610-0004' });
    prisma.platformPayment.create.mockRejectedValueOnce(clash('number')).mockResolvedValueOnce(p);
    prisma.platformPayment.findUniqueOrThrow.mockResolvedValue(p);
    prisma.platformInvoice.findMany.mockResolvedValue([invoice({ amountPaid: 5_000 })]);
    prisma.platformPayment.findMany.mockResolvedValue([p]);

    const result = await service.recordPayment(
      's1',
      { amount: 5_000, method: 'Bank transfer', reference: '', receivedOn: new Date('2026-10-05T08:00:00Z') },
      'Hira',
    );

    expect(result).toBe(p);
    expect(prisma.platformPayment.create.mock.calls[1][0].data).toMatchObject({
      number: 'SR-202610-0005',
      reference: null,
      note: null,
      recordedBy: 'Hira',
    });
    expect(prisma.platformNotice.create.mock.calls[0][0].data).toMatchObject({
      kind: 'payment.received',
      body: expect.stringContaining('Rs 8,800 is still due.'),
    });
  });

  it('refuses a payment for a school that does not exist', async () => {
    const { service, prisma } = setup();
    prisma.school.findUnique.mockResolvedValue(null);
    await expect(service.recordPayment('nope', { amount: 1, method: 'Cash' }, null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('pays what is still owed on a bill', async () => {
    const { service, prisma } = setup();
    prisma.platformInvoice.findUnique.mockResolvedValueOnce(null);
    await expect(service.payInvoice('x', { method: 'Cash' }, null)).rejects.toBeInstanceOf(NotFoundException);
    prisma.platformInvoice.findUnique.mockResolvedValueOnce(invoice({ status: PlatformInvoiceStatus.PAID }));
    await expect(service.payInvoice('inv1', { method: 'Cash' }, null)).rejects.toThrow('already paid');

    const p = payment({ amount: 8_800 });
    prisma.platformInvoice.findUnique.mockResolvedValueOnce(invoice({ amountPaid: 5_000 }));
    prisma.platformPayment.create.mockResolvedValue(p);
    prisma.platformPayment.findUniqueOrThrow.mockResolvedValue(p);
    prisma.platformInvoice.findUniqueOrThrow.mockResolvedValue(invoice({ status: PlatformInvoiceStatus.PAID }));
    const result = await service.payInvoice('inv1', { method: 'Cash' }, null);
    expect(prisma.platformPayment.create.mock.calls[0][0].data.amount).toBe(8_800);
    expect(result.invoice.status).toBe(PlatformInvoiceStatus.PAID);
  });

  it('voids a payment once', async () => {
    const { service, prisma } = setup();
    prisma.platformPayment.findUnique.mockResolvedValueOnce(null);
    await expect(service.voidPayment('x', 'bounced')).rejects.toBeInstanceOf(NotFoundException);
    prisma.platformPayment.findUnique.mockResolvedValueOnce(payment({ status: PlatformPaymentStatus.VOID }));
    await expect(service.voidPayment('pay1', 'bounced')).rejects.toBeInstanceOf(ConflictException);

    prisma.platformPayment.findUnique.mockResolvedValueOnce(payment());
    prisma.platformPayment.findUniqueOrThrow.mockResolvedValueOnce(payment({ status: PlatformPaymentStatus.VOID }));
    await service.voidPayment('pay1', 'bounced');
    expect(prisma.platformPayment.update.mock.calls[0][0].data).toMatchObject({
      status: PlatformPaymentStatus.VOID,
      voidReason: 'bounced',
    });
  });
});

describe('BillingService.rebuild', () => {
  it('re-applies payments, settles bills and marks the school past due', async () => {
    const { service, prisma, subscriptions } = setup();
    const sept = invoice({ id: 'sep', number: 'SS-202609-0001', period: '2026-09', dueDate: new Date('2026-09-10T00:00:00Z') });
    const oct = invoice({ amountPaid: 100 });
    prisma.platformInvoice.findMany.mockResolvedValue([sept, oct]);
    prisma.platformPayment.findMany.mockResolvedValue([payment({ amount: 15_000 })]);
    prisma.platformInvoice.count.mockResolvedValue(1);

    await service.rebuild('s1', '2026-10-20');

    expect(prisma.platformPaymentAllocation.createMany).toHaveBeenCalledWith({
      data: [
        { paymentId: 'pay1', invoiceId: 'sep', amount: 13_800 },
        { paymentId: 'pay1', invoiceId: 'inv1', amount: 1_200 },
      ],
    });
    expect(prisma.platformInvoice.update).toHaveBeenCalledWith({
      where: { id: 'sep' },
      data: expect.objectContaining({ status: PlatformInvoiceStatus.PAID, amountPaid: 13_800, method: 'Bank transfer' }),
    });
    expect(prisma.platformInvoice.update).toHaveBeenCalledWith({
      where: { id: 'inv1' },
      data: expect.objectContaining({ status: PlatformInvoiceStatus.UNPAID, amountPaid: 1_200, paidAt: null }),
    });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { schoolId: 's1', status: SubscriptionStatus.ACTIVE },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
    expect(subscriptions.forget).toHaveBeenCalledWith('s1');
  });

  it('leaves unchanged bills alone and clears past due once nothing is overdue', async () => {
    const { service, prisma } = setup();
    prisma.platformInvoice.findMany.mockResolvedValue([invoice()]);
    await service.rebuild('s1', '2026-10-01');
    expect(prisma.platformPaymentAllocation.createMany).not.toHaveBeenCalled();
    expect(prisma.platformInvoice.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { schoolId: 's1', status: SubscriptionStatus.PAST_DUE },
      data: { status: SubscriptionStatus.ACTIVE },
    });
  });
});

describe('BillingService.statement', () => {
  it('runs a balance over bills and payments, newest first, ignoring void ones', async () => {
    const { service, prisma } = setup();
    prisma.platformInvoice.findMany.mockResolvedValue([
      invoice({ amountPaid: 13_800, status: PlatformInvoiceStatus.PAID }),
      invoice({ id: 'v', number: 'SS-202610-0002', status: PlatformInvoiceStatus.VOID }),
    ]);
    prisma.platformPayment.findMany.mockResolvedValue([
      payment({ amount: 15_000 }),
      payment({ id: 'p2', number: 'SR-202610-0002', reference: null, status: PlatformPaymentStatus.VOID }),
    ]);

    const s = await service.statement('s1');

    expect(s).toMatchObject({ outstanding: 0, credit: 1_200, balance: -1_200 });
    expect(s.entries.map((e) => [e.number, e.balance])).toEqual([
      ['SR-202610-0002', -1_200],
      ['SR-202610-0001', -1_200],
      ['SS-202610-0002', 13_800],
      ['SS-202610-0001', 13_800],
    ]);
    expect(s.entries[0]).toMatchObject({ void: true, description: 'Payment by Bank transfer' });
  });
});

describe('BillingService nightly run', () => {
  it('bills, syncs statuses and sends the reminders due today', async () => {
    const { service, prisma } = setup();
    prisma.subscription.findMany
      .mockResolvedValueOnce([]) // nothing to bill
      .mockResolvedValueOnce([{ schoolId: 's1' }]) // to past due
      .mockResolvedValueOnce([{ schoolId: 's2' }]); // back to active
    prisma.platformInvoice.findMany.mockResolvedValue([
      invoice(), // due 10 Oct: 7 days overdue on the 17th
      invoice({ id: 'b', dueDate: new Date('2026-10-20T00:00:00Z') }), // 3 days to go
      invoice({ id: 'c', dueDate: new Date('2026-10-17T00:00:00Z') }), // due today
      invoice({ id: 'd', dueDate: new Date('2026-10-03T00:00:00Z') }), // read-only tomorrow
      invoice({ id: 'e', dueDate: new Date('2026-10-15T00:00:00Z') }), // latest due: the due-day one
      invoice({ id: 'f', dueDate: new Date('2026-10-30T00:00:00Z') }), // nothing yet
    ]);
    prisma.platformNotice.create.mockResolvedValueOnce({}).mockRejectedValueOnce(clash('dedupeKey'));

    const result = await service.runDaily(new Date('2026-10-17T03:00:00Z'));

    expect(result).toEqual({ today: '2026-10-17', billed: 0, pastDue: 1, cleared: 1, reminders: 4 });
    const kinds = prisma.platformNotice.create.mock.calls.map((c) => c[0].data.kind);
    // The second was already sent (dedupe key taken), so it does not count.
    expect(kinds).toEqual(['bill.overdue', 'bill.due_soon', 'bill.due_today', 'bill.read_only_tomorrow', 'bill.due_today']);
    expect(prisma.platformNotice.create.mock.calls[3][0].data.severity).toBe('URGENT');
  });

  it('keeps the notice when messages cannot be queued', async () => {
    const { service, notifications } = setup();
    notifications.send.mockRejectedValue(new Error('queue down'));
    const sent = await service.notify('s1', {
      kind: 'bill.due_today',
      severity: 'WARNING',
      title: 'Bill due today',
      body: 'Pay',
      dedupeKey: 'inv1:bill.due_today',
    });
    expect(sent).toBe(true);
  });

  it('rethrows unexpected errors saving a notice', async () => {
    const { service, prisma } = setup();
    prisma.platformNotice.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.notify('s1', { kind: 'x', severity: 'INFO', title: 't', body: 'b', dedupeKey: 'k' }),
    ).rejects.toThrow('db down');
  });
});
