import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { receiptNo } from './invoice-codes.js';

export interface PaymentInput {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  receivedById?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Records a payment against an invoice and updates its balance. A gateway
   * reference that was already recorded returns the earlier payment instead
   * of counting it twice.
   */
  async record(schoolId: string, input: PaymentInput) {
    if (input.reference) {
      const existing = await this.prisma.payment.findUnique({
        where: { method_reference: { method: input.method, reference: input.reference } },
      });
      if (existing) return { payment: existing, duplicate: true };
    }

    let payment;
    try {
      payment = await this.prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, schoolId } });
        if (!invoice) throw new BadRequestException('Invoice not found');
        if (invoice.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException('This invoice was cancelled');
        }
        const paid = invoice.paid + input.amount;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paid,
            status: paid >= invoice.total ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
          },
        });
        return tx.payment.create({
          data: {
            schoolId,
            invoiceId: invoice.id,
            amount: input.amount,
            method: input.method,
            reference: input.reference,
            receiptNo: receiptNo(),
            receivedById: input.receivedById,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // The same gateway callback arrived twice at once; the other one won.
      if (
        input.reference &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.payment.findUniqueOrThrow({
          where: { method_reference: { method: input.method, reference: input.reference } },
        });
        return { payment: existing, duplicate: true };
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
}
