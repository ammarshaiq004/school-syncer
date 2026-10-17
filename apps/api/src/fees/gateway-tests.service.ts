import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckoutStatus, Gender, Prisma, StudentStatus, type GatewayTestRun } from '@prisma/client';
import type { PlatformUser } from '../common/auth-user.js';
import { logPlatform, logToSchool } from '../platform/platform-audit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createAdhocVoucher, dueInDays } from './adhoc-vouchers.js';
import { FeeCorrectionsService } from './fee-corrections.service.js';
import { enabledProviders } from './gateways/gateway-config.js';
import { OnlinePaymentsService, type GatewayCallKind, type OnlineProvider } from './online-payments.service.js';

/** Rupees: a test is a token payment, never a real fee. */
export const TEST_AMOUNT = { default: 10, max: 100 };
/** The school's stand-in student that test vouchers are made out to. Status LEFT keeps it out of class lists and counts. */
export const TEST_STUDENT = { admissionNo: 'GATEWAY-TEST', firstName: 'Gateway', lastName: 'Test' };

export type RunStatus = 'WAITING' | 'EXPIRED' | 'PAID' | 'REVIEW' | 'FAILED' | 'REVERSED' | 'CANCELLED';

export interface RunEvent {
  at: string;
  kind: GatewayCallKind;
  verified: boolean;
  status: CheckoutStatus | null;
  code: string | null;
}

const runInclude = {
  school: { select: { id: true, name: true } },
  startedBy: { select: { name: true } },
  checkout: {
    select: {
      id: true,
      status: true,
      txnRef: true,
      consumerNumber: true,
      providerRef: true,
      responseCode: true,
      message: true,
      expiresAt: true,
      payment: { select: { id: true, receiptNo: true, receivedAt: true, reversedAt: true } },
    },
  },
} satisfies Prisma.GatewayTestRunInclude;
type RunRow = Prisma.GatewayTestRunGetPayload<{ include: typeof runInclude }>;

/** Where a run stands, from its checkout and whether it was closed. */
export function runStatus(run: Pick<GatewayTestRun, 'reversedAt' | 'outcome'>, checkout: { status: CheckoutStatus; expiresAt: Date } | null, now = new Date()): RunStatus {
  if (run.reversedAt) return 'REVERSED';
  // Money that arrived after a cancel still shows, so it can be refunded.
  if (checkout?.status === CheckoutStatus.PAID) return 'PAID';
  if (checkout?.status === CheckoutStatus.REVIEW) return 'REVIEW';
  if (run.outcome === 'cancelled' || !checkout) return 'CANCELLED';
  if (checkout.status === CheckoutStatus.FAILED) return 'FAILED';
  return checkout.expiresAt < now ? 'EXPIRED' : 'WAITING';
}

const seconds = (from: Date, to: Date | null | undefined) => (to ? Math.round((to.getTime() - from.getTime()) / 1000) : null);

/**
 * The console's guided small live test (SCHOOL-149): a test voucher of a few
 * rupees for the school's test student, paid by staff through the real
 * gateway, the callbacks watched as they arrive, then the payment reversed
 * through the fee office's own reversal and the voucher voided, so the
 * school's totals are untouched. Every run stays in the history.
 */
@Injectable()
export class GatewayTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly online: OnlinePaymentsService,
    private readonly corrections: FeeCorrectionsService,
  ) {}

  async start(admin: PlatformUser, input: { schoolId: string; provider: OnlineProvider; amount: number }) {
    const mode = this.online.config.mode;
    if (mode === 'off') throw new BadRequestException('Online payments are switched off on this server (PAYMENTS_MODE=off).');
    const school = await this.prisma.school.findUnique({ where: { id: input.schoolId }, select: { id: true, name: true } });
    if (!school) throw new NotFoundException('School not found');
    const { config, sources } = await this.online.configFor(school.id);
    if (!enabledProviders(config)[input.provider] || !sources[input.provider]) {
      throw new BadRequestException('This gateway is not set up for this school: it has no account of its own and the server has none either.');
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const student = await this.testStudent(tx, school.id);
      return createAdhocVoucher(tx, {
        schoolId: school.id,
        studentId: student.id,
        lines: [{ feeHeadId: null, description: 'Gateway test payment (reversed after the test)', amount: input.amount }],
        dueDate: dueInDays(1),
      });
    });
    const { checkout, action } = await this.online.openCheckout(config, school.id, invoice, input.provider, input.amount);
    const run = await this.prisma.gatewayTestRun.create({
      data: {
        schoolId: school.id,
        provider: input.provider,
        mode,
        account: sources[input.provider]!,
        amount: input.amount,
        invoiceId: invoice.id,
        checkoutId: checkout.id,
        startedById: admin.sub,
      },
    });
    const details = { runId: run.id, provider: input.provider, mode, amount: input.amount, voucherNo: invoice.voucherNo };
    await logPlatform(this.prisma, admin, 'payments.test.start', school.id, details);
    await logToSchool(this.prisma, admin, school.id, 'payments.test.start', 'GatewayTestRun', run.id, { after: details });
    return { run: await this.get(run.id), action };
  }

  /** The school's test student, created on first use. */
  private async testStudent(tx: Prisma.TransactionClient, schoolId: string) {
    const existing = await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo: TEST_STUDENT.admissionNo } } });
    if (existing) return existing;
    const campus = await tx.campus.findFirst({ where: { schoolId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!campus) throw new BadRequestException('This school has no campus yet, so a test voucher cannot be made.');
    return tx.student.create({
      data: {
        schoolId,
        campusId: campus.id,
        admissionNo: TEST_STUDENT.admissionNo,
        firstName: TEST_STUDENT.firstName,
        lastName: TEST_STUDENT.lastName,
        gender: Gender.OTHER,
        status: StudentStatus.LEFT,
      },
    });
  }

  async list(filter: { schoolId?: string } = {}) {
    const rows = await this.prisma.gatewayTestRun.findMany({
      where: filter.schoolId ? { schoolId: filter.schoolId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: runInclude,
    });
    return rows.map((r) => this.view(r));
  }

  async get(id: string) {
    const run = await this.prisma.gatewayTestRun.findUnique({ where: { id }, include: runInclude });
    if (!run) throw new NotFoundException('Test run not found');
    return this.view(run);
  }

  /** Asks the gateway about the checkout now (Status Inquiry, Inquire Transaction), for a callback that has not come. */
  async refresh(id: string) {
    const run = await this.open(id);
    if (run.checkout?.status === CheckoutStatus.PENDING) {
      const checkout = await this.prisma.onlinePayment.findUniqueOrThrow({ where: { id: run.checkout.id } });
      const after = await this.online.refresh(checkout);
      if (!after) {
        throw new BadRequestException(
          run.provider === 'ONEBILL'
            ? '1Bill has no status inquiry: the payment shows when 1LINK calls bill payment.'
            : this.online.config.mode === 'mock'
              ? 'Mock mode has no gateway to ask. Use Simulate instead.'
              : 'The gateway could not be asked just now. Try again in a minute.',
        );
      }
      await this.online.noteCall(checkout.id, 'status-inquiry', true, after.status, after.responseCode);
    }
    return this.get(id);
  }

  /** Mock mode: plays the gateway's part, through the same handlers a real callback uses. */
  async simulate(id: string, approve: boolean) {
    const run = await this.open(id);
    if (this.online.config.mode !== 'mock') throw new BadRequestException('Simulating a payment only works in mock mode.');
    if (run.checkout?.status !== CheckoutStatus.PENDING) throw new BadRequestException('This test checkout is no longer open.');
    const checkout = await this.prisma.onlinePayment.findUniqueOrThrow({ where: { id: run.checkout.id } });
    await this.online.mockSettle(checkout, approve);
    return this.get(id);
  }

  /** Reverses the test payment with the fee office's reversal, then voids the test voucher. */
  async reverse(admin: PlatformUser, id: string) {
    const run = await this.prisma.gatewayTestRun.findUnique({ where: { id }, include: runInclude });
    if (!run) throw new NotFoundException('Test run not found');
    if (run.reversedAt) throw new BadRequestException('This test payment was already reversed.');
    const payment = run.checkout?.payment;
    if (!payment) throw new BadRequestException('Nothing was paid on this test yet. Cancel it instead.');
    const reason = `Gateway test ${run.provider} reversed from the console by ${admin.name}`;
    const reversal = payment.reversedAt ? null : await this.corrections.reverse({ id: payment.id, schoolId: run.schoolId }, null, reason);
    const voided = await this.voidVoucher(run, reason);
    await this.prisma.gatewayTestRun.update({
      where: { id },
      data: { reversedAt: new Date(), finishedAt: new Date(), outcome: 'reversed' },
    });
    const details = { runId: id, provider: run.provider, amount: run.amount, receiptNo: payment.receiptNo };
    await logPlatform(this.prisma, admin, 'payments.test.reverse', run.schoolId, details);
    if (reversal) {
      // The school's own log shows the reversal as the fee office's would.
      await logToSchool(this.prisma, admin, run.schoolId, 'payment.reverse', 'Payment', payment.id, {
        before: reversal.before,
        after: { ...reversal.payment, invoice: { id: reversal.invoice.id, paid: reversal.invoice.paid, status: reversal.invoice.status } },
      });
    }
    if (voided) await logToSchool(this.prisma, admin, run.schoolId, 'invoice.cancel', 'Invoice', run.invoiceId, voided);
    return this.get(id);
  }

  /** Closes a test nobody paid: the checkout stops being payable and the voucher is voided. */
  async cancel(admin: PlatformUser, id: string) {
    const run = await this.open(id);
    if (run.checkout?.payment && !run.checkout.payment.reversedAt) {
      throw new BadRequestException('This test was paid. Reverse it instead.');
    }
    if (run.checkout?.status === CheckoutStatus.PENDING) {
      await this.prisma.onlinePayment.updateMany({
        where: { id: run.checkout.id, status: CheckoutStatus.PENDING },
        data: { status: CheckoutStatus.FAILED, message: 'Gateway test cancelled from the console.' },
      });
    }
    const voided = await this.voidVoucher(run, `Gateway test ${run.provider} cancelled from the console by ${admin.name}`);
    await this.prisma.gatewayTestRun.update({ where: { id }, data: { finishedAt: new Date(), outcome: 'cancelled' } });
    await logPlatform(this.prisma, admin, 'payments.test.cancel', run.schoolId, { runId: id, provider: run.provider });
    if (voided) await logToSchool(this.prisma, admin, run.schoolId, 'invoice.cancel', 'Invoice', run.invoiceId, voided);
    return this.get(id);
  }

  /** A run that is still open (not reversed or cancelled). */
  private async open(id: string) {
    const run = await this.prisma.gatewayTestRun.findUnique({ where: { id }, include: runInclude });
    if (!run) throw new NotFoundException('Test run not found');
    if (run.finishedAt) throw new BadRequestException('This test run is closed.');
    return run;
  }

  private async voidVoucher(run: Pick<GatewayTestRun, 'invoiceId' | 'schoolId'>, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: run.invoiceId }, select: { status: true } });
    if (!invoice || invoice.status === 'CANCELLED') return null;
    return this.corrections.cancel({ id: run.invoiceId, schoolId: run.schoolId }, null, reason);
  }

  view(r: RunRow) {
    const c = r.checkout;
    const paidAt = c?.payment?.receivedAt ?? null;
    return {
      id: r.id,
      school: r.school,
      provider: r.provider as OnlineProvider,
      mode: r.mode,
      account: r.account,
      amount: r.amount,
      status: runStatus(r, c),
      outcome: r.outcome,
      startedBy: r.startedBy?.name ?? null,
      checkout: c
        ? {
            id: c.id,
            status: c.status,
            txnRef: c.txnRef,
            consumerNumber: c.consumerNumber,
            providerRef: c.providerRef,
            responseCode: c.responseCode,
            message: c.message,
            expiresAt: c.expiresAt.toISOString(),
          }
        : null,
      receipt: c?.payment ? { receiptNo: c.payment.receiptNo, receivedAt: c.payment.receivedAt.toISOString(), reversed: !!c.payment.reversedAt } : null,
      callbackSeen: !!r.callbackAt,
      events: (Array.isArray(r.events) ? r.events : []) as unknown as RunEvent[],
      timings: {
        startedAt: r.createdAt.toISOString(),
        callbackAt: r.callbackAt?.toISOString() ?? null,
        paidAt: paidAt?.toISOString() ?? null,
        reversedAt: r.reversedAt?.toISOString() ?? null,
        finishedAt: r.finishedAt?.toISOString() ?? null,
        /** Seconds from starting to the first gateway callback, and to the receipt. */
        toCallback: seconds(r.createdAt, r.callbackAt),
        toPaid: seconds(r.createdAt, paidAt),
      },
    };
  }
}
