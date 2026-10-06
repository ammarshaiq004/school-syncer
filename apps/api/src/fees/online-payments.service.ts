import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CheckoutStatus, InvoiceStatus, PaymentMethod, Prisma, type OnlinePayment } from '@prisma/client';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lateFine } from './fee-calculator.js';
import { enabledProviders, gatewayConfig, type GatewayConfig } from './gateways/gateway-config.js';
import type { CheckoutAction, GatewayResult } from './gateways/gateway-types.js';
import { easypaisaCheckout, easypaisaInquire, easypaisaResult } from './gateways/easypaisa.js';
import { jazzcashCheckout, jazzcashInquire, jazzcashMockReturn, jazzcashVerify } from './gateways/jazzcash.js';
import {
  ONEBILL,
  onebillConsumerNumber,
  onebillInquiryResponse,
  onebillRupees,
  type OnebillPaymentRequest,
} from './gateways/onebill.js';
import { PaymentsService } from './payments.service.js';

export type OnlineProvider = 'JAZZCASH' | 'EASYPAISA' | 'ONEBILL';
export const ONLINE_PROVIDERS: OnlineProvider[] = ['JAZZCASH', 'EASYPAISA', 'ONEBILL'];

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** "T" + 19 characters: within JazzCash's 20-character pp_TxnRefNo, unique enough to retry on clash. */
const txnRef = () => `T${Date.now().toString(36).toUpperCase()}${Array.from({ length: 11 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`.slice(0, 20);

const studentName = (s: { firstName: string; lastName: string | null }) => [s.firstName, s.lastName].filter(Boolean).join(' ');

type CheckoutRow = OnlinePayment & { payment?: { receiptNo: string; receivedAt: Date } | null };

/**
 * Online fee checkouts: a parent starts one against a voucher, the gateway
 * confirms it, and only then is a Payment recorded (receipt, WhatsApp
 * message, cash book), through the same PaymentsService the fee counter uses.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);
  readonly config: GatewayConfig = gatewayConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  options() {
    const enabled = enabledProviders(this.config);
    return { mode: this.config.mode, providers: ONLINE_PROVIDERS.filter((p) => enabled[p]) };
  }

  /** Starts a checkout for the full amount due today on one of the parent's vouchers. */
  async start(user: AuthUser, invoiceId: string, provider: OnlineProvider, contact: { mobile?: string } = {}) {
    if (!enabledProviders(this.config)[provider]) {
      throw new BadRequestException('This payment method is not set up for your school yet.');
    }
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        schoolId: user.schoolId,
        student: { guardians: { some: { guardian: { userId: user.sub } } } },
      },
      include: { school: { select: { lateFeePerDay: true, name: true } }, student: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('This voucher was cancelled.');
    const balance = Math.max(0, invoice.total - invoice.paid);
    if (balance === 0) throw new BadRequestException('This voucher is already paid in full.');
    // The same fine PaymentsService allows when the payment is recorded.
    const amount = balance + lateFine(invoice.dueDate, new Date(), invoice.school.lateFeePerDay);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (provider === 'ONEBILL' ? this.config.onebillDays * 86_400_000 : this.config.checkoutMinutes * 60_000),
    );
    let checkout: OnlinePayment | undefined;
    for (let attempt = 0; !checkout; attempt++) {
      try {
        checkout = await this.prisma.onlinePayment.create({
          data: {
            schoolId: user.schoolId,
            invoiceId: invoice.id,
            provider: provider as PaymentMethod,
            amount,
            txnRef: txnRef(),
            consumerNumber:
              provider === 'ONEBILL' ? onebillConsumerNumber(this.config.onebill.billerPrefix, () => randomInt(10) / 10) : null,
            createdById: user.sub,
            expiresAt,
          },
        });
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!clash || attempt >= 4) throw error;
      }
    }

    let action: CheckoutAction;
    if (provider === 'ONEBILL') action = { kind: 'onebill', consumerNumber: checkout.consumerNumber! };
    else if (this.config.mode === 'mock') action = { kind: 'mock' };
    else if (provider === 'JAZZCASH') {
      action = jazzcashCheckout(this.config, {
        txnRef: checkout.txnRef,
        amount,
        billReference: invoice.voucherNo,
        description: `School fee ${invoice.voucherNo}`,
        createdAt: now,
        expiresAt,
      });
    } else {
      action = easypaisaCheckout(this.config, { txnRef: checkout.txnRef, amount, expiresAt, mobile: contact.mobile });
    }
    return { checkout: this.view(checkout), action };
  }

  /** One of the parent's own checkouts, with its receipt once paid. */
  async get(user: AuthUser, id: string) {
    const c = await this.prisma.onlinePayment.findFirst({
      where: {
        id,
        schoolId: user.schoolId,
        invoice: { student: { guardians: { some: { guardian: { userId: user.sub } } } } },
      },
      include: {
        payment: { select: { receiptNo: true, receivedAt: true, reference: true } },
        school: { select: { name: true, city: true, phone: true } },
        invoice: {
          select: { id: true, voucherNo: true, period: true, total: true, paid: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } },
        },
      },
    });
    if (!c) throw new NotFoundException('Payment not found');
    return {
      ...this.view(c),
      school: c.school,
      invoice: {
        id: c.invoice.id,
        voucherNo: c.invoice.voucherNo,
        period: c.invoice.period,
        balance: Math.max(0, c.invoice.total - c.invoice.paid),
      },
      student: { name: studentName(c.invoice.student), admissionNo: c.invoice.student.admissionNo },
      receipt: c.payment
        ? { receiptNo: c.payment.receiptNo, receivedAt: c.payment.receivedAt.toISOString(), reference: c.payment.reference }
        : null,
    };
  }

  /** The school's online checkouts, newest first, for the fee office. */
  async list(schoolId: string, filter: { status?: CheckoutStatus; provider?: OnlineProvider; take?: number }) {
    const rows = await this.prisma.onlinePayment.findMany({
      where: { schoolId, ...(filter.status ? { status: filter.status } : {}), ...(filter.provider ? { provider: filter.provider } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.take ?? 100, 1), 500),
      include: {
        payment: { select: { receiptNo: true, receivedAt: true } },
        invoice: { select: { voucherNo: true, period: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } } },
      },
    });
    const all = await this.prisma.onlinePayment.groupBy({
      by: ['status'],
      where: { schoolId },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const summary = Object.fromEntries(
      Object.values(CheckoutStatus).map((s) => {
        const g = all.find((x) => x.status === s);
        return [s, { count: g?._count._all ?? 0, amount: g?._sum.amount ?? 0 }];
      }),
    );
    return {
      mode: this.config.mode,
      summary,
      items: rows.map((r) => ({
        ...this.view(r),
        voucherNo: r.invoice.voucherNo,
        period: r.invoice.period,
        student: { id: r.invoice.student.id, name: studentName(r.invoice.student), admissionNo: r.invoice.student.admissionNo },
      })),
    };
  }

  // ----- Gateway results -----

  /**
   * Applies a verified gateway result to its checkout. Repeats are harmless:
   * a paid checkout stays paid with the one Payment it already has.
   */
  async apply(provider: OnlineProvider, result: GatewayResult): Promise<OnlinePayment | null> {
    const checkout = await this.prisma.onlinePayment.findFirst({ where: { txnRef: result.txnRef, provider } });
    if (!checkout) {
      this.logger.warn(`${provider} result for unknown checkout ${result.txnRef}`);
      return null;
    }
    if (checkout.status === CheckoutStatus.PAID || checkout.status === CheckoutStatus.REVIEW) return checkout;
    const details = { responseCode: result.responseCode ?? null, message: result.message?.slice(0, 300) ?? null };

    if (result.outcome !== 'PAID') {
      // A failure only ends a checkout that is still open; a later "paid" can still win.
      return this.prisma.onlinePayment.update({
        where: { id: checkout.id },
        data: {
          ...details,
          ...(result.outcome === 'FAILED' && checkout.status === CheckoutStatus.PENDING ? { status: CheckoutStatus.FAILED } : {}),
        },
      });
    }

    const providerRef = result.providerRef ?? checkout.txnRef;
    if (result.amount !== undefined && result.amount !== checkout.amount) {
      return this.prisma.onlinePayment.update({
        where: { id: checkout.id },
        data: {
          ...details,
          providerRef,
          status: CheckoutStatus.REVIEW,
          message: `The gateway reported Rs ${result.amount} against a checkout of Rs ${checkout.amount}. Check the gateway statement before applying it.`,
        },
      });
    }

    try {
      const { payment } = await this.payments.record(checkout.schoolId, {
        invoiceId: checkout.invoiceId,
        amount: checkout.amount,
        method: provider as PaymentMethod,
        reference: providerRef,
      });
      return await this.prisma.onlinePayment.update({
        where: { id: checkout.id },
        data: { ...details, providerRef, status: CheckoutStatus.PAID, paymentId: payment.id },
      });
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      // Money was taken but the voucher would not accept it (e.g. paid at the counter meanwhile).
      return this.prisma.onlinePayment.update({
        where: { id: checkout.id },
        data: { ...details, providerRef, status: CheckoutStatus.REVIEW, message: error.message },
      });
    }
  }

  /** JazzCash return post. Null when the post is not a genuine JazzCash response. */
  async jazzcashReturn(body: Record<string, unknown>) {
    const result = jazzcashVerify(this.config, body);
    if (!result) return null;
    return this.apply('JAZZCASH', result);
  }

  /**
   * Asks the gateway what happened to an open checkout and applies the answer.
   * Returns null when it could not be asked (mock mode, 1Bill, or the call
   * failed), so the caller knows nothing new was learned.
   */
  async refresh(checkout: OnlinePayment): Promise<OnlinePayment | null> {
    if (this.config.mode === 'mock' || this.config.mode === 'off') return null;
    const ask =
      checkout.provider === PaymentMethod.JAZZCASH
        ? jazzcashInquire
        : checkout.provider === PaymentMethod.EASYPAISA
          ? easypaisaInquire
          : null;
    if (!ask) return null;
    const result = await ask(this.config, checkout.txnRef).catch((error: Error) => {
      this.logger.warn(`${checkout.provider} inquiry for ${checkout.txnRef} failed: ${error.message}`);
      return null;
    });
    if (!result) return null;
    return this.apply(checkout.provider as OnlineProvider, result);
  }

  /** Asks Easypaisa what happened to an order, then applies the answer. */
  async easypaisaCheck(orderRef: string) {
    const checkout = await this.prisma.onlinePayment.findFirst({ where: { txnRef: orderRef, provider: PaymentMethod.EASYPAISA } });
    if (!checkout) return null;
    // Mock mode has no Easypaisa to ask; its checkout page settles orders itself.
    return (await this.refresh(checkout)) ?? checkout;
  }

  // ----- 1Bill (1LINK calls these) -----

  async onebillInquiry(consumerNumber: string | undefined) {
    if (!consumerNumber || !/^\d{5,24}$/.test(consumerNumber)) return onebillInquiryResponse(null, ONEBILL.INVALID_DATA);
    const c = await this.prisma.onlinePayment.findUnique({
      where: { consumerNumber },
      include: { payment: true, invoice: { select: { period: true, status: true, student: { select: { firstName: true, lastName: true } } } } },
    });
    if (!c) return onebillInquiryResponse(null);
    const blocked = c.status === CheckoutStatus.FAILED || c.invoice.status === InvoiceStatus.CANCELLED || (c.status === CheckoutStatus.PENDING && c.expiresAt < new Date());
    return onebillInquiryResponse({
      consumerNumber,
      studentName: studentName(c.invoice.student),
      amount: c.amount,
      status: c.status === CheckoutStatus.PAID ? 'P' : blocked ? 'B' : 'U',
      dueDate: c.expiresAt,
      billingMonth: c.invoice.period,
      paidOn: c.payment?.receivedAt,
      amountPaid: c.payment?.amount,
      authId: c.providerRef,
    });
  }

  async onebillPayment(req: OnebillPaymentRequest) {
    const reply = (code: string, id = '') => ({ response_Code: code, Identification_parameter: id, reserved: '' });
    const amount = onebillRupees(req.transaction_amount);
    if (!req.consumer_number || !req.tran_auth_id || amount === null) return reply(ONEBILL.INVALID_DATA);
    const c = await this.prisma.onlinePayment.findUnique({
      where: { consumerNumber: req.consumer_number },
      include: { invoice: { select: { status: true } } },
    });
    if (!c) return reply(ONEBILL.NOT_FOUND);
    if (c.status === CheckoutStatus.PAID) {
      // 1LINK retrying the same payment gets the same answer; anything else is a duplicate.
      if (c.providerRef !== req.tran_auth_id) return reply(ONEBILL.BLOCKED);
      const p = await this.prisma.payment.findUnique({ where: { id: c.paymentId ?? '' } });
      return reply(ONEBILL.OK, p?.receiptNo ?? '');
    }
    if (c.status !== CheckoutStatus.PENDING || c.expiresAt < new Date() || c.invoice.status === InvoiceStatus.CANCELLED) {
      return reply(ONEBILL.BLOCKED);
    }
    if (amount !== c.amount) return reply(ONEBILL.INVALID_DATA);

    const after = await this.apply('ONEBILL', {
      txnRef: c.txnRef,
      outcome: 'PAID',
      amount,
      providerRef: req.tran_auth_id,
      responseCode: ONEBILL.OK,
      message: req.bank_mnemonic ? `Paid through ${req.bank_mnemonic}` : undefined,
    });
    if (after?.status !== CheckoutStatus.PAID) {
      // Unlike a wallet, 1LINK has not settled yet: refusing here means the bank never takes the money.
      await this.prisma.onlinePayment.update({ where: { id: c.id }, data: { status: CheckoutStatus.FAILED } });
      return reply(ONEBILL.BLOCKED);
    }
    const p = await this.prisma.payment.findUnique({ where: { id: after.paymentId! } });
    return reply(ONEBILL.OK, p?.receiptNo ?? '');
  }

  // ----- Mock mode -----

  /**
   * Mock mode only: plays the gateway's part for one of the parent's checkouts,
   * producing the same response the real gateway would (signed, for JazzCash)
   * and putting it through the same verification.
   */
  async mockComplete(user: AuthUser, id: string, approve: boolean) {
    if (this.config.mode !== 'mock') throw new ForbiddenException('Payments are not in mock mode.');
    const c = await this.get(user, id);
    if (c.status !== CheckoutStatus.PENDING) return c;
    const at = new Date();
    if (c.provider === 'JAZZCASH') {
      await this.jazzcashReturn(jazzcashMockReturn(this.config, { txnRef: c.txnRef, amount: c.amount, approve, at }));
    } else if (c.provider === 'EASYPAISA') {
      const result = easypaisaResult(this.config, c.txnRef, {
        responseCode: '0000',
        orderId: c.txnRef,
        storeId: this.config.easypaisa.storeId,
        transactionId: approve ? `MOCK${at.getTime().toString().slice(-8)}` : undefined,
        transactionStatus: approve ? 'PAID' : 'FAILED',
        transactionAmount: c.amount,
        responseDesc: approve ? 'Transaction paid' : 'Transaction declined by the customer',
      });
      if (result) await this.apply('EASYPAISA', result);
    } else if (approve) {
      // What 1LINK does when a parent pays the consumer number from a banking app.
      await this.onebillInquiry(c.consumerNumber!);
      await this.onebillPayment({
        consumer_number: c.consumerNumber!,
        tran_auth_id: `${at.getTime()}`.slice(-6),
        transaction_amount: String(c.amount * 100).padStart(12, '0'),
        tran_date: '',
        tran_time: '',
        bank_mnemonic: 'MOCKBANK',
      });
    } else {
      await this.apply('ONEBILL', { txnRef: c.txnRef, outcome: 'FAILED', message: 'Cancelled in the sandbox.' });
    }
    return this.get(user, id);
  }

  view(c: CheckoutRow) {
    return {
      id: c.id,
      invoiceId: c.invoiceId,
      provider: c.provider as OnlineProvider,
      amount: c.amount,
      status: c.status,
      /** An open checkout past its time; the gateway will no longer take it. */
      expired: c.status === CheckoutStatus.PENDING && c.expiresAt < new Date(),
      txnRef: c.txnRef,
      consumerNumber: c.consumerNumber,
      providerRef: c.providerRef,
      message: c.message,
      receiptNo: c.payment?.receiptNo ?? null,
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
    };
  }
}
