import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FineStatus, InvoiceLineKind, InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { campusScope } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { serializable } from '../common/serializable.js';
import { studentSearchWhere } from '../common/student-search.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { invoiceStatus } from './fee-calculator.js';

export interface AdjustmentInput {
  /** Rupees: negative for a discount, positive for an extra charge. */
  amount: number;
  reason: string;
  description?: string;
}

export interface PaymentFilter {
  from?: Date;
  to?: Date;
  method?: PaymentMethod;
  reversed?: boolean;
  search?: string;
}

/** Only payments that still count: a reversed payment stays on record but is not money received. */
export const LIVE_PAYMENT = { reversedAt: null } satisfies Prisma.PaymentWhereInput;

/**
 * Corrections to fee money (SCHOOL-137): voiding a voucher, reversing a
 * payment and adjusting what a voucher bills. Nothing is deleted; every
 * correction needs a reason and is written to the audit log.
 */
@Injectable()
export class FeeCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Limits a query to the user's school and, for campus staff, their campuses' students. */
  private studentScope(user: AuthUser): Prisma.StudentWhereInput {
    const scope = campusScope(user);
    return scope ? { campusId: { in: scope } } : {};
  }

  /** Every receipt, counter and online, newest first, with reversed ones marked. */
  async payments(user: AuthUser, filter: PaymentFilter) {
    const byStudent = studentSearchWhere(filter.search);
    const search = filter.search?.trim();
    const rows = await this.prisma.payment.findMany({
      where: {
        schoolId: user.schoolId,
        invoice: { student: this.studentScope(user) },
        ...(filter.from || filter.to ? { receivedAt: { gte: filter.from, lt: filter.to } } : {}),
        ...(filter.method ? { method: filter.method } : {}),
        ...(filter.reversed === undefined ? {} : { reversedAt: filter.reversed ? { not: null } : null }),
        ...(search
          ? {
              OR: [
                { receiptNo: { contains: search.toUpperCase() } },
                { reference: { contains: search, mode: 'insensitive' as const } },
                { invoice: { voucherNo: { contains: search.toUpperCase() } } },
                ...(byStudent ? [{ invoice: { student: byStudent } }] : []),
              ],
            }
          : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        receiptNo: true,
        receivedAt: true,
        reversedAt: true,
        reversalReason: true,
        receivedBy: { select: { name: true } },
        checkout: { select: { id: true } },
        invoice: {
          select: {
            id: true,
            voucherNo: true,
            period: true,
            student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
          },
        },
      },
    });
    return rows.map(({ checkout, ...p }) => ({ ...p, online: !!checkout }));
  }

  /**
   * Voids a voucher that has no money on it. Library fines billed on it go
   * back to owed, so the next voucher (or the library desk) collects them.
   */
  async cancelInvoice(user: AuthUser, invoiceId: string, reason: string) {
    const { before, after } = await serializable(this.prisma, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, schoolId: user.schoolId, student: this.studentScope(user) },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('This voucher is already cancelled.');
      const live = await tx.payment.count({ where: { invoiceId, ...LIVE_PAYMENT } });
      if (live) {
        throw new BadRequestException('This voucher has payments on it. Reverse them first, then cancel the voucher.');
      }
      await tx.bookLoan.updateMany({
        where: { invoiceId, fineStatus: FineStatus.BILLED },
        data: { fineStatus: FineStatus.DUE, invoiceId: null },
      });
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: user.sub,
          cancelReason: reason,
        },
      });
      return { before: invoice, after: updated };
    });
    await this.audit.record(user, 'invoice.cancel', 'Invoice', invoiceId, { before, after });
    return after;
  }

  /**
   * Reverses a counter or online payment: it stays on record with its receipt
   * number, stops counting, and the voucher's paid amount and status are
   * worked out again from the payments still standing.
   */
  async reversePayment(user: AuthUser, paymentId: string, reason: string) {
    const { before, payment, invoice } = await serializable(this.prisma, async (tx) => {
      const found = await tx.payment.findFirst({
        where: { id: paymentId, schoolId: user.schoolId, invoice: { student: this.studentScope(user) } },
      });
      if (!found) throw new NotFoundException('Payment not found');
      if (found.reversedAt) throw new BadRequestException('This payment was already reversed.');
      const reversed = await tx.payment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), reversedById: user.sub, reversalReason: reason },
      });
      return { before: found, payment: reversed, invoice: await this.settle(tx, found.invoiceId) };
    });
    await this.audit.record(user, 'payment.reverse', 'Payment', paymentId, {
      before,
      after: { ...payment, invoice: { id: invoice.id, paid: invoice.paid, status: invoice.status } },
    });
    return { payment, invoice };
  }

  /** Adds a discount or extra charge line to a voucher and updates its total. */
  async adjustInvoice(user: AuthUser, invoiceId: string, input: AdjustmentInput) {
    const { before, line, invoice } = await serializable(this.prisma, async (tx) => {
      const found = await tx.invoice.findFirst({
        where: { id: invoiceId, schoolId: user.schoolId, student: this.studentScope(user) },
      });
      if (!found) throw new NotFoundException('Invoice not found');
      if (found.status === InvoiceStatus.CANCELLED) throw new BadRequestException('This voucher was cancelled.');
      const total = found.total + input.amount;
      if (total < 0) throw new BadRequestException('A discount cannot be more than the voucher total.');
      if (total < found.paid) {
        throw new BadRequestException(
          'This discount would take the voucher below what was already paid. Reverse the payment first.',
        );
      }
      const added = await tx.invoiceLine.create({
        data: {
          invoiceId,
          description: input.description || (input.amount < 0 ? 'Discount' : 'Additional charge'),
          amount: input.amount,
          kind: InvoiceLineKind.ADJUSTMENT,
          reason: input.reason,
          addedById: user.sub,
        },
      });
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { total, status: invoiceStatus(total, found.paid) },
      });
      return { before: found, line: added, invoice: updated };
    });
    await this.audit.record(user, 'invoice.adjust', 'Invoice', invoiceId, {
      before: { total: before.total, status: before.status },
      after: { total: invoice.total, status: invoice.status, line },
    });
    return { line, invoice };
  }

  /** Works out a voucher's paid amount and status again from the payments still standing. */
  private async settle(tx: Prisma.TransactionClient, invoiceId: string) {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const sum = await tx.payment.aggregate({ where: { invoiceId, ...LIVE_PAYMENT }, _sum: { amount: true } });
    const paid = sum._sum.amount ?? 0;
    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paid,
        status: invoice.status === InvoiceStatus.CANCELLED ? InvoiceStatus.CANCELLED : invoiceStatus(invoice.total, paid),
      },
    });
  }
}
