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
 * A carried-forward voucher's balance is owed on the voucher it moved to, so
 * money on it is corrected there; voiding that later voucher brings it back.
 */
function assertNotCarried(invoice: { status: InvoiceStatus }) {
  if (invoice.status === InvoiceStatus.CARRIED_FORWARD) {
    throw new BadRequestException(
      "This voucher's balance was carried forward to a later voucher. Make the correction on that voucher, or void it to bring the balance back here.",
    );
  }
}

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
   * Everything a printed payment receipt needs: the school header, who paid
   * for which voucher, the amount, and whether the payment was later reversed.
   * The voucher's balance is as it stands now.
   */
  async receipt(user: AuthUser, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId: user.schoolId, invoice: { student: this.studentScope(user) } },
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
            kind: true,
            status: true,
            total: true,
            paid: true,
            school: { select: { name: true, city: true, phone: true, email: true, logoUrl: true } },
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNo: true,
                enrollments: {
                  where: { status: 'ACTIVE' },
                  take: 1,
                  select: { section: { select: { name: true, class: { select: { name: true } } } } },
                },
                guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const { checkout, invoice, ...rest } = payment;
    const owing = invoice.status === InvoiceStatus.UNPAID || invoice.status === InvoiceStatus.PARTIAL;
    return { ...rest, online: !!checkout, invoice: { ...invoice, balance: owing ? Math.max(0, invoice.total - invoice.paid) : 0 } };
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
      assertNotCarried(invoice);
      const live = await tx.payment.count({ where: { invoiceId, ...LIVE_PAYMENT } });
      if (live) {
        throw new BadRequestException('This voucher has payments on it. Reverse them first, then cancel the voucher.');
      }
      await tx.bookLoan.updateMany({
        where: { invoiceId, fineStatus: FineStatus.BILLED },
        data: { fineStatus: FineStatus.DUE, invoiceId: null },
      });
      // Balances carried onto this voucher are owed on their own vouchers again.
      const carried = await tx.invoice.findMany({ where: { carriedToId: invoiceId } });
      for (const c of carried) {
        await tx.invoice.update({
          where: { id: c.id },
          data: { carriedToId: null, status: invoiceStatus(c.total, c.paid) },
        });
      }
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
      assertNotCarried(await tx.invoice.findUniqueOrThrow({ where: { id: found.invoiceId } }));
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
      assertNotCarried(found);
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

  /**
   * Waives a voucher's late fine: no more fine builds up on it, and any fine
   * already booked onto it and not yet paid comes off as a negative line.
   */
  async waiveFine(user: AuthUser, invoiceId: string, reason: string) {
    const { before, invoice, waived } = await serializable(this.prisma, async (tx) => {
      const found = await tx.invoice.findFirst({
        where: { id: invoiceId, schoolId: user.schoolId, student: this.studentScope(user) },
      });
      if (!found) throw new NotFoundException('Invoice not found');
      if (found.status === InvoiceStatus.CANCELLED) throw new BadRequestException('This voucher was cancelled.');
      assertNotCarried(found);
      if (found.fineWaivedAt) throw new BadRequestException("This voucher's late fine was already waived.");
      // Only the booked fine still owed comes off; fine already paid stays paid.
      const off = Math.max(0, Math.min(found.fineBooked, found.total - found.paid));
      if (off > 0) {
        await tx.invoiceLine.create({
          data: {
            invoiceId,
            description: 'Late fine waived',
            amount: -off,
            kind: InvoiceLineKind.LATE_FINE,
            reason,
            addedById: user.sub,
          },
        });
      }
      const total = found.total - off;
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          total,
          fineBooked: found.fineBooked - off,
          status: invoiceStatus(total, found.paid),
          fineWaivedAt: new Date(),
          fineWaivedById: user.sub,
          fineWaiverReason: reason,
        },
      });
      return { before: found, invoice: updated, waived: off };
    });
    await this.audit.record(user, 'invoice.waive_fine', 'Invoice', invoiceId, {
      before: { total: before.total, fineBooked: before.fineBooked, status: before.status },
      after: { total: invoice.total, fineBooked: invoice.fineBooked, status: invoice.status, waived, reason },
    });
    return { invoice, waived };
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
        status:
          invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.CARRIED_FORWARD
            ? invoice.status
            : invoiceStatus(invoice.total, paid),
      },
    });
  }
}
