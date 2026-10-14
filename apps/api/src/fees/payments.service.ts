import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, Prisma, type Payment } from '@prisma/client';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dayStart, localToday } from '../common/dates.js';
import { fineRule, invoiceStatus, paymentRejection } from './fee-calculator.js';
import { bookLateFine } from './fine-booking.js';
import { receiptNo } from './invoice-codes.js';

export interface PaymentInput {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  /** Shown on the receipt; free text at the counter ("cash", a slip number), never used to de-duplicate. */
  reference?: string;
  /**
   * Makes the payment count once per school: a gateway transaction id, an
   * online checkout's reference, or a key the client sends with a retry.
   */
  idempotencyKey?: string;
  receivedById?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Records a payment against an invoice and updates its balance. A payment
   * whose idempotency key this school already recorded returns the earlier
   * payment instead of counting it twice; only this school's payments are
   * ever matched.
   */
  async record(schoolId: string, input: PaymentInput) {
    if (input.idempotencyKey) {
      const existing = await this.byKey(schoolId, input.idempotencyKey);
      if (existing) return this.repeat(existing, input);
    }

    let payment;
    try {
      payment = await this.retrying(() => this.prisma.$transaction(
      async (tx) => {
        const found = await tx.invoice.findFirst({
          where: { id: input.invoiceId, schoolId },
          include: { carriedTo: { select: { voucherNo: true } } },
        });
        if (!found) throw new BadRequestException('Invoice not found');
        if (found.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException('This invoice was cancelled');
        }
        if (found.status === InvoiceStatus.CARRIED_FORWARD) {
          throw new BadRequestException(
            `This voucher's balance was carried forward to voucher ${found.carriedTo?.voucherNo ?? 'a later voucher'}. Take the payment there.`,
          );
        }
        // The late fine built up so far goes onto the voucher before the money
        // is applied, so paying only the balance leaves the fine owing.
        const school = await tx.school.findUniqueOrThrow({
          where: { id: schoolId },
          select: { lateFeePerDay: true, lateFeeMaxDays: true, lateFeeCap: true },
        });
        const { invoice } = await bookLateFine(tx, found, dayStart(localToday()), fineRule(school));
        // A voucher never takes more than it owes.
        const rejection = paymentRejection(input.amount, invoice);
        if (rejection) throw new BadRequestException(rejection);
        const paid = invoice.paid + input.amount;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paid, status: invoiceStatus(invoice.total, paid) },
        });
        return tx.payment.create({
          data: {
            schoolId,
            invoiceId: invoice.id,
            amount: input.amount,
            method: input.method,
            reference: input.reference,
            idempotencyKey: input.idempotencyKey,
            receiptNo: receiptNo(),
            receivedById: input.receivedById,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ));
    } catch (error) {
      // The same gateway callback arrived twice at once; the other one won.
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.byKey(schoolId, input.idempotencyKey);
        if (existing) return this.repeat(existing, input);
      }
      throw error;
    }

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: payment.invoiceId },
      include: { student: true, school: true },
    });
    const phones = await guardianPhones(this.prisma, [invoice.studentId]);
    await this.notifications.send(
      schoolId,
      (phones.get(invoice.studentId) ?? []).map((to) => ({
        to,
        template: 'fees.paid' as const,
        params: {
          amount: payment.amount.toLocaleString('en-PK'),
          studentName: [invoice.student.firstName, invoice.student.lastName].filter(Boolean).join(' '),
          receiptNo: payment.receiptNo,
          schoolName: invoice.school.name,
        },
      })),
    );
    return { payment, duplicate: false };
  }

  /**
   * Postgres may abort a serializable transaction (P2034) when other payments
   * are written at the same moment; nothing was saved, so it is tried again.
   */
  private async retrying<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!conflict || attempt >= attempts) throw error;
      }
    }
  }

  private byKey(schoolId: string, idempotencyKey: string) {
    return this.prisma.payment.findUnique({ where: { schoolId_idempotencyKey: { schoolId, idempotencyKey } } });
  }

  /** A repeat of a recorded payment is answered with it; the same key for different money is refused. */
  private repeat(existing: Payment, input: PaymentInput) {
    if (existing.invoiceId !== input.invoiceId || existing.amount !== input.amount) {
      throw new ConflictException('This payment reference was already used for a different payment.');
    }
    return { payment: existing, duplicate: true };
  }
}
