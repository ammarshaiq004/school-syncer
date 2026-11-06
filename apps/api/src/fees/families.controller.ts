import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { campusScopeFor, FEE_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { familyOf, loadFamilies, spreadPayment } from './families.js';
import { OPEN_INVOICE } from './outstanding.js';
import { PaymentsService } from './payments.service.js';

const familyPaymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(PaymentMethod),
  reference: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().trim().min(8).max(60).optional(),
});

/** One combined voucher for all of a family's children, and one payment for it. */
@Controller('fees/families')
@Permission('fees')
@RequiresFeature('fees')
@Roles(...FEE_ROLES)
export class FamiliesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  private async open(user: AuthUser, studentId: string) {
    const scope = campusScopeFor(user, FEE_ROLES);
    const family = familyOf(await loadFamilies(this.prisma, user.schoolId, scope), studentId);
    if (!family) throw new NotFoundException('Student not found');
    const invoices = await this.prisma.invoice.findMany({
      where: { schoolId: user.schoolId, studentId: { in: family.children.map((c) => c.id) }, ...OPEN_INVOICE },
      orderBy: [{ dueDate: 'asc' }, { voucherNo: 'asc' }],
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    return { family, invoices };
  }

  /** The family's open vouchers with their lines and the total owed, for the combined print. */
  @Get(':studentId')
  async voucher(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    const { family, invoices } = await this.open(user, studentId);
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      select: { name: true, city: true, phone: true, logoUrl: true },
    });
    const name = new Map(family.children.map((c) => [c.id, c]));
    const rows = invoices.map((i) => ({
      id: i.id,
      voucherNo: i.voucherNo,
      period: i.period,
      dueDate: i.dueDate.toISOString().slice(0, 10),
      total: i.total,
      paid: i.paid,
      balance: i.total - i.paid,
      student: name.get(i.studentId)!,
      lines: i.lines.map((l) => ({ description: l.description, amount: l.amount })),
    }));
    return { school, family, invoices: rows, balance: rows.reduce((s, r) => s + r.balance, 0) };
  }

  /** Takes one payment for the family and applies it to the open vouchers, earliest due first. */
  @Post(':studentId/payments')
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(familyPaymentSchema)) body: z.infer<typeof familyPaymentSchema>,
  ) {
    const { invoices } = await this.open(user, studentId);
    // A retry finds the vouchers already paid down, so it is answered from what the first try recorded.
    if (body.idempotencyKey) {
      const earlier = await this.prisma.payment.findMany({
        where: { schoolId: user.schoolId, idempotencyKey: { startsWith: `client:${body.idempotencyKey}:` } },
        select: { invoiceId: true, receiptNo: true, amount: true },
      });
      if (earlier.length) return { receipts: earlier, duplicate: true };
    }
    const parts = spreadPayment(
      invoices.map((i) => ({
        id: i.id,
        voucherNo: i.voucherNo,
        dueDate: i.dueDate.toISOString().slice(0, 10),
        balance: i.status === InvoiceStatus.PARTIAL || i.status === InvoiceStatus.UNPAID ? i.total - i.paid : 0,
      })),
      body.amount,
    );
    if (!invoices.length) throw new ConflictException('This family owes nothing');
    if (!parts) throw new BadRequestException('That is more than the family owes');
    const receipts = [];
    for (const part of parts) {
      const { payment } = await this.payments.record(user.schoolId, {
        invoiceId: part.invoiceId,
        amount: part.amount,
        method: body.method,
        reference: body.reference,
        // One key per voucher, so a retry of the whole request counts each part once.
        idempotencyKey: body.idempotencyKey ? `client:${body.idempotencyKey}:${part.invoiceId}` : undefined,
        receivedById: user.sub,
      });
      await this.audit.record(user, 'payment.create', 'Payment', payment.id, { after: payment });
      receipts.push({ invoiceId: part.invoiceId, receiptNo: payment.receiptNo, amount: payment.amount });
    }
    return { receipts, duplicate: false };
  }
}
