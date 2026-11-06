import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { z } from 'zod';
import { campusScopeFor, FEE_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { allocate, evenSplit, planProblem } from './installments.js';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const planSchema = z.union([
  z.object({ count: z.number().int().min(2).max(12), firstDue: isoDay }),
  z.object({ items: z.array(z.object({ dueDate: isoDay, amount: z.number().int() })).min(2).max(12) }),
]);

/** A payment plan for one voucher: a few dated instalments that add up to the voucher. */
@Controller('fees/invoices/:id/installments')
@Permission('fees')
@RequiresFeature('fees')
@Roles(...FEE_ROLES)
export class InstallmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async invoice(user: AuthUser, id: string) {
    const scope = campusScopeFor(user, FEE_ROLES);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId: user.schoolId, ...(scope ? { student: { campusId: { in: scope } } } : {}) },
      select: { id: true, total: true, paid: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const invoice = await this.invoice(user, id);
    const rows = await this.prisma.installment.findMany({ where: { invoiceId: id }, orderBy: { seq: 'asc' } });
    const items = rows.map((r) => ({ id: r.id, seq: r.seq, dueDate: r.dueDate.toISOString().slice(0, 10), amount: r.amount }));
    return {
      total: invoice.total,
      paid: invoice.paid,
      installments: allocate(items, invoice.total, invoice.paid, localToday()).map((a) => ({
        ...a.item,
        amount: a.amount,
        paid: a.paid,
        balance: a.balance,
        status: a.status,
      })),
    };
  }

  /** Makes (or replaces) the plan: an even monthly split, or the exact dates and amounts. */
  @Put()
  async put(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(planSchema)) body: z.infer<typeof planSchema>,
  ) {
    const invoice = await this.invoice(user, id);
    if (invoice.status !== InvoiceStatus.UNPAID && invoice.status !== InvoiceStatus.PARTIAL) {
      throw new ConflictException('Only a voucher that still owes money can have a payment plan');
    }
    const items = 'items' in body ? body.items : evenSplit(invoice.total, body.count, body.firstDue);
    const problem = planProblem(items, invoice.total);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction([
      this.prisma.installment.deleteMany({ where: { invoiceId: id } }),
      this.prisma.installment.createMany({
        data: items.map((i, n) => ({ invoiceId: id, seq: n + 1, dueDate: dayStart(i.dueDate), amount: i.amount })),
      }),
    ]);
    await this.audit.record(user, 'installments.set', 'Invoice', id, { after: items });
    return this.get(user, id);
  }

  @Delete()
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.invoice(user, id);
    const { count } = await this.prisma.installment.deleteMany({ where: { invoiceId: id } });
    if (count) await this.audit.record(user, 'installments.remove', 'Invoice', id, {});
    return { removed: count };
  }
}
