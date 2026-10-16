import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PlatformInvoiceStatus,
  PlatformNoticeSeverity,
  PlatformPaymentStatus,
  Prisma,
  Role,
  StudentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { dayStart, localDate } from '../../common/dates.js';
import { EmailService } from '../../notifications/email.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { monthlyAmount, nextInvoiceNumber } from '../plans.js';
import { SubscriptionService } from '../subscription.service.js';
import { allocate, withTax } from './ledger.js';
import { reminderDue, type ReminderKind } from './reminders.js';

/** Bills fall due on this day of their month. */
export const DUE_DAY = 10;

export interface PaymentInput {
  amount: number;
  method: string;
  reference?: string | null;
  receivedOn?: Date;
  note?: string | null;
}

export interface NoticeInput {
  kind: string;
  severity: PlatformNoticeSeverity;
  title: string;
  body: string;
  dedupeKey: string;
  invoiceId?: string;
  paymentId?: string;
}

type Tx = Prisma.TransactionClient;

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-11" after "2026-10". */
export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Receipt numbers run per month like bill numbers: "SR-202610-0003". */
export function nextReceiptNumber(period: string, last: string | null): string {
  return nextInvoiceNumber(period, last?.replace(/^SR-/, 'SS-') ?? null).replace(/^SS-/, 'SR-');
}

/**
 * SchoolSyncer's own billing: monthly bills, payments applied to the oldest
 * bill first, credit, past-due status and the messages owners get about it.
 * Every change to a school's bills or payments ends in rebuild(), which
 * recomputes what each bill has been paid from the payments themselves.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  settings() {
    return this.prisma.platformSettings.upsert({ where: { id: 'default' }, create: {}, update: {} });
  }

  // ----- Bills -----

  /**
   * Bills every paying school for a month at its active student count right
   * now (on the 1st when the nightly run does it). Trials, suspended and
   * closed schools are skipped, as are schools already billed for the month
   * and schools whose billing starts later, so it is safe to run again.
   */
  async issueBills(period: string, opts: { schoolId?: string; notify?: boolean } = {}) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        ...(opts.schoolId ? { schoolId: opts.schoolId } : {}),
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        OR: [{ billedFrom: null }, { billedFrom: { lte: period } }],
        school: { platformInvoices: { none: { period } } },
      },
      include: { plan: true },
    });
    if (!subs.length) return { created: 0, total: 0, invoices: [] };
    const settings = await this.settings();
    const counts = await this.prisma.student.groupBy({
      by: ['schoolId'],
      where: { status: StudentStatus.ACTIVE, schoolId: { in: subs.map((s) => s.schoolId) } },
      _count: true,
    });
    const students = new Map(counts.map((r) => [r.schoolId, r._count]));
    const [y, m] = period.split('-').map(Number);
    const dueDate = new Date(Date.UTC(y, m - 1, DUE_DAY));
    const created = [];
    for (const s of subs) {
      const count = students.get(s.schoolId) ?? 0;
      const charge = withTax(monthlyAmount(s.plan, count), settings.salesTaxPercent);
      const invoice = await this.createInvoice({
        schoolId: s.schoolId,
        period,
        planName: s.plan.name,
        students: count,
        dueDate,
        ...charge,
      });
      if (!invoice) continue;
      created.push(invoice);
      await this.rebuild(s.schoolId);
      if (opts.notify !== false) await this.billIssued(invoice.id);
    }
    return { created: created.length, total: created.reduce((sum, i) => sum + i.amount, 0), invoices: created };
  }

  /** Creates one bill with the next number; null if the school already has one for the month. */
  private async createInvoice(data: Omit<Prisma.PlatformInvoiceUncheckedCreateInput, 'number'>) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await this.prisma.platformInvoice.findFirst({
        where: { number: { startsWith: `SS-${data.period.replace('-', '')}-` } },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      try {
        return await this.prisma.platformInvoice.create({
          data: { ...data, number: nextInvoiceNumber(data.period, last?.number ?? null) },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        const target = String(error.meta?.target ?? '');
        // Billed for the month by another run: nothing to do.
        if (target.includes('schoolId') || target.includes('period')) return null;
        // Another run took the number: try the next one.
      }
    }
    throw new ConflictException('Could not number the bill; please try again');
  }

  /** Writes off an unpaid (or part-paid) bill; anything paid towards it becomes credit. */
  async voidInvoice(id: string, reason: string) {
    const invoice = await this.prisma.platformInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Bill not found');
    if (invoice.status !== PlatformInvoiceStatus.UNPAID) throw new ConflictException('Only unpaid bills can be voided');
    await this.prisma.platformInvoice.update({
      where: { id },
      data: { status: PlatformInvoiceStatus.VOID, voidReason: reason },
    });
    await this.rebuild(invoice.schoolId);
    return this.prisma.platformInvoice.findUniqueOrThrow({ where: { id } });
  }

  // ----- Payments -----

  async recordPayment(schoolId: string, input: PaymentInput, recordedBy: string | null) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundException('School not found');
    const receivedOn = dayStart(localDate(input.receivedOn ?? new Date()));
    const period = receivedOn.toISOString().slice(0, 7);
    let payment;
    for (let attempt = 0; !payment; attempt++) {
      const last = await this.prisma.platformPayment.findFirst({
        where: { number: { startsWith: `SR-${period.replace('-', '')}-` } },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      try {
        payment = await this.prisma.platformPayment.create({
          data: {
            number: nextReceiptNumber(period, last?.number ?? null),
            schoolId,
            amount: input.amount,
            method: input.method,
            reference: input.reference || null,
            receivedOn,
            note: input.note || null,
            recordedBy,
          },
        });
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!clash || attempt >= 4) throw error;
      }
    }
    await this.rebuild(schoolId);
    await this.paymentReceived(payment.id);
    return payment;
  }

  /** Records a payment for whatever is still owed on one bill. */
  async payInvoice(id: string, input: Omit<PaymentInput, 'amount'>, recordedBy: string | null) {
    const invoice = await this.prisma.platformInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Bill not found');
    if (invoice.status !== PlatformInvoiceStatus.UNPAID)
      throw new ConflictException(`This bill is already ${invoice.status.toLowerCase()}`);
    const amount = invoice.amount - invoice.amountPaid;
    const payment = await this.recordPayment(invoice.schoolId, { ...input, amount }, recordedBy);
    return { payment, invoice: await this.prisma.platformInvoice.findUniqueOrThrow({ where: { id } }) };
  }

  async voidPayment(id: string, reason: string) {
    const payment = await this.prisma.platformPayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PlatformPaymentStatus.VOID) throw new ConflictException('This payment is already void');
    await this.prisma.platformPayment.update({
      where: { id },
      data: { status: PlatformPaymentStatus.VOID, voidReason: reason, voidedAt: new Date() },
    });
    await this.rebuild(payment.schoolId);
    return this.prisma.platformPayment.findUniqueOrThrow({ where: { id } });
  }

  // ----- Ledger -----

  /**
   * Re-applies all of a school's payments to its bills and brings each bill's
   * paid amount, status and the school's past-due status up to date. Runs
   * under a per-school lock so two changes at once cannot interleave.
   */
  async rebuild(schoolId: string, today = localDate(new Date())) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-billing:${schoolId}`}))`;
      // A voided bill keeps nothing that was paid towards it: that money is re-applied.
      await tx.platformInvoice.updateMany({
        where: { schoolId, status: PlatformInvoiceStatus.VOID, amountPaid: { not: 0 } },
        data: { amountPaid: 0, paidAt: null, method: null, reference: null },
      });
      const [invoices, payments] = await Promise.all([
        tx.platformInvoice.findMany({ where: { schoolId, status: { not: PlatformInvoiceStatus.VOID } } }),
        tx.platformPayment.findMany({ where: { schoolId, status: PlatformPaymentStatus.RECORDED } }),
      ]);
      const ledger = allocate(invoices, payments);
      await tx.platformPaymentAllocation.deleteMany({ where: { payment: { schoolId } } });
      await tx.platformPaymentAllocation.deleteMany({ where: { invoice: { schoolId } } });
      if (ledger.allocations.length) await tx.platformPaymentAllocation.createMany({ data: ledger.allocations });
      for (const inv of invoices) {
        const s = ledger.invoices.get(inv.id)!;
        const paid = s.amountPaid >= inv.amount;
        const data = {
          amountPaid: s.amountPaid,
          status: paid ? PlatformInvoiceStatus.PAID : PlatformInvoiceStatus.UNPAID,
          paidAt: paid ? (s.settledBy?.receivedOn ?? inv.paidAt ?? new Date()) : null,
          method: paid ? (s.settledBy?.method ?? inv.method) : null,
          reference: paid ? (s.settledBy?.reference ?? inv.reference) : null,
        };
        if (
          data.amountPaid !== inv.amountPaid ||
          data.status !== inv.status ||
          +(data.paidAt ?? 0) !== +(inv.paidAt ?? 0) ||
          data.method !== inv.method ||
          data.reference !== inv.reference
        ) {
          await tx.platformInvoice.update({ where: { id: inv.id }, data });
        }
      }
      await this.syncStatus(tx, schoolId, today);
    });
    this.subscriptions.forget(schoolId);
  }

  /** PAST_DUE while any bill is unpaid after its due date; back to ACTIVE once none is. */
  private async syncStatus(tx: Tx, schoolId: string, today: string) {
    const overdue = await tx.platformInvoice.count({
      where: { schoolId, status: PlatformInvoiceStatus.UNPAID, dueDate: { lt: dayStart(today) } },
    });
    await tx.subscription.updateMany({
      where: { schoolId, status: overdue ? SubscriptionStatus.ACTIVE : SubscriptionStatus.PAST_DUE },
      data: { status: overdue ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE },
    });
  }

  /** Bills, payments and the running balance, oldest first. Positive balance = owed. */
  async statement(schoolId: string) {
    const [invoices, payments] = await Promise.all([
      this.prisma.platformInvoice.findMany({
        where: { schoolId },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        include: { allocations: { include: { payment: { select: { number: true } } } } },
      }),
      this.prisma.platformPayment.findMany({
        where: { schoolId },
        orderBy: [{ receivedOn: 'asc' }, { createdAt: 'asc' }],
        include: { allocations: { include: { invoice: { select: { number: true } } } } },
      }),
    ]);
    type Entry = { date: Date; kind: 'bill' | 'payment'; id: string; number: string; description: string; charge: number; credit: number; balance: number; void: boolean };
    const entries: Entry[] = [
      ...invoices.map((i) => ({
        date: new Date(Date.UTC(+i.period.slice(0, 4), +i.period.slice(5) - 1, 1)),
        kind: 'bill' as const,
        id: i.id,
        number: i.number,
        description: `${monthName(i.period)} bill, ${i.students} students on ${i.planName}`,
        charge: i.status === PlatformInvoiceStatus.VOID ? 0 : i.amount,
        credit: 0,
        balance: 0,
        void: i.status === PlatformInvoiceStatus.VOID,
      })),
      ...payments.map((p) => ({
        date: p.receivedOn,
        kind: 'payment' as const,
        id: p.id,
        number: p.number,
        description: `Payment by ${p.method}${p.reference ? ` (${p.reference})` : ''}`,
        charge: 0,
        credit: p.status === PlatformPaymentStatus.VOID ? 0 : p.amount,
        balance: 0,
        void: p.status === PlatformPaymentStatus.VOID,
      })),
    ].sort((a, b) => +a.date - +b.date || (a.kind === b.kind ? a.number.localeCompare(b.number) : a.kind === 'bill' ? -1 : 1));
    let balance = 0;
    for (const e of entries) {
      balance += e.charge - e.credit;
      e.balance = balance;
    }
    const live = invoices.filter((i) => i.status !== PlatformInvoiceStatus.VOID);
    const outstanding = live.reduce((sum, i) => sum + i.amount - i.amountPaid, 0);
    return {
      outstanding,
      credit: Math.max(0, -balance),
      balance,
      invoices,
      payments,
      entries: entries.reverse(),
    };
  }

  // ----- Nightly run -----

  /**
   * The nightly job: issues this month's bills (on the 1st, or the first run
   * after it), marks schools with overdue bills past due (and clears those
   * that paid) and sends the day's bill reminders.
   */
  async runDaily(now = new Date()) {
    const today = localDate(now);
    const bills = await this.issueBills(today.slice(0, 7));
    const status = await this.syncAllStatuses(today);
    const reminders = await this.sendReminders(today);
    return { today, billed: bills.created, ...status, reminders };
  }

  async syncAllStatuses(today: string) {
    const due = dayStart(today);
    const toPastDue = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        school: { platformInvoices: { some: { status: PlatformInvoiceStatus.UNPAID, dueDate: { lt: due } } } },
      },
      select: { schoolId: true },
    });
    const toActive = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        school: { platformInvoices: { none: { status: PlatformInvoiceStatus.UNPAID, dueDate: { lt: due } } } },
      },
      select: { schoolId: true },
    });
    for (const { schoolId } of [...toPastDue, ...toActive]) {
      await this.prisma.$transaction((tx) => this.syncStatus(tx, schoolId, today));
      this.subscriptions.forget(schoolId);
    }
    return { pastDue: toPastDue.length, cleared: toActive.length };
  }

  async sendReminders(today: string) {
    const unpaid = await this.prisma.platformInvoice.findMany({
      where: {
        status: PlatformInvoiceStatus.UNPAID,
        school: { subscription: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } } },
      },
    });
    let sent = 0;
    for (const inv of unpaid) {
      const kind = reminderDue(inv.dueDate.toISOString().slice(0, 10), today);
      if (kind && (await this.notify(inv.schoolId, this.reminderNotice(kind, inv)))) sent += 1;
    }
    return sent;
  }

  private reminderNotice(
    kind: ReminderKind,
    inv: { id: string; number: string; period: string; amount: number; amountPaid: number; dueDate: Date },
  ): NoticeInput {
    const owed = rs(inv.amount - inv.amountPaid);
    const what = `${monthName(inv.period)} bill ${inv.number}`;
    const notices: Record<ReminderKind, Omit<NoticeInput, 'kind' | 'dedupeKey' | 'invoiceId'>> = {
      'bill.due_soon': {
        severity: PlatformNoticeSeverity.INFO,
        title: `Bill due on ${day(inv.dueDate)}`,
        body: `Your ${what} for ${owed} is due on ${day(inv.dueDate)}.`,
      },
      'bill.due_today': {
        severity: PlatformNoticeSeverity.WARNING,
        title: 'Bill due today',
        body: `Your ${what} for ${owed} is due today.`,
      },
      'bill.overdue': {
        severity: PlatformNoticeSeverity.WARNING,
        title: 'Bill overdue',
        body: `Your ${what} for ${owed} was due on ${day(inv.dueDate)} and is still unpaid. Please pay it to avoid interruption.`,
      },
      'bill.read_only_tomorrow': {
        severity: PlatformNoticeSeverity.URGENT,
        title: 'SchoolSyncer becomes read-only tomorrow',
        body: `Your ${what} for ${owed} is still unpaid. From tomorrow your staff can view records but not change them until it is paid.`,
      },
    };
    return { kind, dedupeKey: `${inv.id}:${kind}`, invoiceId: inv.id, ...notices[kind] };
  }

  private async billIssued(invoiceId: string) {
    const inv = await this.prisma.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const owed = inv.amount - inv.amountPaid;
    await this.notify(inv.schoolId, {
      kind: 'bill.issued',
      severity: PlatformNoticeSeverity.INFO,
      dedupeKey: `${inv.id}:bill.issued`,
      invoiceId: inv.id,
      title: `${monthName(inv.period)} bill ${inv.number}`,
      body:
        owed > 0
          ? `Your SchoolSyncer bill for ${monthName(inv.period)} is ${rs(inv.amount)} for ${inv.students} active students on ${inv.planName}${inv.amountPaid ? `, of which ${rs(inv.amountPaid)} is covered by your credit` : ''}. Please pay ${rs(owed)} by ${day(inv.dueDate)}.`
          : `Your SchoolSyncer bill for ${monthName(inv.period)} is ${rs(inv.amount)} for ${inv.students} active students on ${inv.planName}. It is fully covered by your credit.`,
    });
  }

  private async paymentReceived(paymentId: string) {
    const p = await this.prisma.platformPayment.findUniqueOrThrow({ where: { id: paymentId } });
    const { outstanding, credit } = await this.statement(p.schoolId);
    const left = outstanding > 0 ? `${rs(outstanding)} is still due.` : credit > 0 ? `You have ${rs(credit)} in credit for your next bill.` : 'All bills are paid.';
    await this.notify(p.schoolId, {
      kind: 'payment.received',
      severity: PlatformNoticeSeverity.INFO,
      dedupeKey: `${p.id}:payment.received`,
      paymentId: p.id,
      title: `Payment received, receipt ${p.number}`,
      body: `We received ${rs(p.amount)} by ${p.method} on ${day(p.receivedOn)}. Thank you. ${left}`,
    });
  }

  // ----- Messages to owners -----

  /**
   * Shows a notice on the school's Plan and billing page and sends it to
   * every active owner by SMS (or WhatsApp) and email. Returns false when the
   * same notice (dedupeKey) was already sent.
   */
  async notify(schoolId: string, notice: NoticeInput): Promise<boolean> {
    try {
      await this.prisma.platformNotice.create({ data: { schoolId, ...notice } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    const owners = await this.prisma.user.findMany({
      where: { schoolId, isActive: true, roles: { some: { role: Role.OWNER } } },
      select: { phone: true, email: true },
    });
    try {
      await this.notifications.send(
        schoolId,
        owners.filter((o) => o.phone).map((o) => ({ to: o.phone!, template: 'platform.billing', params: { title: notice.title, body: notice.body } })),
        { platform: true },
      );
      await this.email.send(
        schoolId,
        owners
          .filter((o) => o.email)
          .map((o) => ({
            to: o.email!,
            subject: `SchoolSyncer: ${notice.title}`,
            text: `${notice.body}\n\nSee your bills and receipts under Plan and billing in SchoolSyncer.\n\nSchoolSyncer`,
            template: 'platform.billing',
          })),
      );
    } catch (error) {
      // The notice is saved and shows in the app; a delivery problem must not undo the billing change.
      this.logger.error(`Could not queue "${notice.kind}" messages for school ${schoolId}: ${(error as Error).message}`);
    }
    return true;
  }
}
