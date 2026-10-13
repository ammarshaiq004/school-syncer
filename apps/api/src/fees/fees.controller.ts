import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ConcessionType,
  FeeFrequency,
  FineStatus,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { campusScopeFor, FEE_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { studentSearchWhere } from '../common/student-search.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dayStart } from '../common/dates.js';
import { monthBounds, riderFee } from '../transport/transport-rules.js';
import { invoiceLines, lateFine, type StructureRow } from './fee-calculator.js';
import { voucherNo } from './invoice-codes.js';
import { PaymentsService } from './payments.service.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

const feeHeadSchema = z.object({
  name: z.string().trim().min(2).max(60),
  frequency: z.enum(FeeFrequency).default(FeeFrequency.MONTHLY),
});
const structureSchema = z.object({
  classId: z.string().min(1),
  feeHeadId: z.string().min(1),
  academicYearId: z.string().min(1),
  amount: z.number().int().min(0).max(10_000_000),
});
const concessionSchema = z.object({
  feeHeadId: z.string().min(1),
  type: z.enum(ConcessionType),
  value: z.number().int().min(0).max(10_000_000),
  reason: z.string().trim().max(200).optional(),
});
const generateSchema = z.object({
  period,
  classId: z.string().optional(),
  sendWhatsApp: z.boolean().default(false),
});
const paymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(PaymentMethod),
  reference: z.string().trim().max(80).optional(),
});

const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

/** Fee staff limited to some campuses bill and see only those campuses' students. */
const feeScope = (user: AuthUser) => campusScopeFor(user, FEE_ROLES);

/** A where-fragment for students (or classes) on the caller's fee campuses. */
const inFeeScope = (user: AuthUser): { campusId?: { in: string[] } } => {
  const scope = feeScope(user);
  return scope ? { campusId: { in: scope } } : {};
};

@Controller('fees')
@Permission('fees')
@RequiresFeature('fees')
export class FeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----- Fee heads and structures -----

  @Get('heads')
  @Roles(...STAFF_ROLES)
  heads(@CurrentUser() user: AuthUser) {
    return this.prisma.feeHead.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } });
  }

  @Post('heads')
  @Roles(...FEE_ROLES)
  async createHead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(feeHeadSchema)) body: z.infer<typeof feeHeadSchema>,
  ) {
    const head = await this.prisma.feeHead.create({ data: { ...body, schoolId: user.schoolId } });
    await this.audit.record(user, 'fee_head.create', 'FeeHead', head.id, { after: head });
    return head;
  }

  @Get('structures')
  @Roles(...STAFF_ROLES)
  structures(@CurrentUser() user: AuthUser, @Query('academicYearId') academicYearId?: string) {
    return this.prisma.feeStructure.findMany({
      where: { schoolId: user.schoolId, ...(academicYearId ? { academicYearId } : {}) },
      include: { feeHead: true, class: { select: { name: true } } },
    });
  }

  /** Sets what a class pays for a fee head in a year (creates or updates). */
  @Put('structures')
  @Roles(...FEE_ROLES)
  async setStructure(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(structureSchema)) body: z.infer<typeof structureSchema>,
  ) {
    const owned = await Promise.all([
      this.prisma.class.count({ where: { id: body.classId, schoolId: user.schoolId, ...inFeeScope(user) } }),
      this.prisma.feeHead.count({ where: { id: body.feeHeadId, schoolId: user.schoolId } }),
      this.prisma.academicYear.count({ where: { id: body.academicYearId, schoolId: user.schoolId } }),
    ]);
    if (owned.includes(0)) throw new NotFoundException('Class, fee head or year not found');
    const structure = await this.prisma.feeStructure.upsert({
      where: {
        classId_feeHeadId_academicYearId: {
          classId: body.classId,
          feeHeadId: body.feeHeadId,
          academicYearId: body.academicYearId,
        },
      },
      update: { amount: body.amount },
      create: { ...body, schoolId: user.schoolId },
    });
    await this.audit.record(user, 'fee_structure.set', 'FeeStructure', structure.id, { after: structure });
    return structure;
  }

  // ----- Concessions -----

  @Put('students/:studentId/concessions')
  @Roles(...FEE_ROLES)
  async setConcession(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(concessionSchema)) body: z.infer<typeof concessionSchema>,
  ) {
    const owned = await Promise.all([
      this.prisma.student.count({ where: { id: studentId, schoolId: user.schoolId, ...inFeeScope(user) } }),
      this.prisma.feeHead.count({ where: { id: body.feeHeadId, schoolId: user.schoolId } }),
    ]);
    if (owned.includes(0)) throw new NotFoundException('Student or fee head not found');
    const concession = await this.prisma.concession.upsert({
      where: { studentId_feeHeadId: { studentId, feeHeadId: body.feeHeadId } },
      update: body,
      create: { ...body, studentId },
    });
    await this.audit.record(user, 'concession.set', 'Concession', concession.id, { after: concession });
    return concession;
  }

  @Delete('students/:studentId/concessions/:feeHeadId')
  @Roles(...FEE_ROLES)
  async removeConcession(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Param('feeHeadId') feeHeadId: string,
  ) {
    const before = await this.prisma.concession.findFirst({
      where: { studentId, feeHeadId, student: { schoolId: user.schoolId, ...inFeeScope(user) } },
    });
    if (!before) throw new NotFoundException('Concession not found');
    await this.prisma.concession.delete({ where: { id: before.id } });
    await this.audit.record(user, 'concession.delete', 'Concession', before.id, { before });
    return { deleted: true };
  }

  // ----- Invoices -----

  /**
   * Bills every active student in the current academic year for a month.
   * Students who already have an invoice for that month are skipped, so it
   * is safe to run again after adding students.
   */
  @Post('invoices/generate')
  @Roles(...FEE_ROLES)
  async generate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>,
  ) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const year = await this.prisma.academicYear.findFirst({
      where: { schoolId: user.schoolId, isCurrent: true },
    });
    if (!year) throw new NotFoundException('Set a current academic year first');

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId: user.schoolId,
        academicYearId: year.id,
        status: 'ACTIVE',
        student: { status: 'ACTIVE', invoices: { none: { period: body.period } }, ...inFeeScope(user) },
        ...(body.classId ? { section: { classId: body.classId } } : {}),
      },
      include: {
        student: { include: { concessions: true } },
        section: { select: { classId: true } },
      },
    });
    const structures = await this.prisma.feeStructure.findMany({
      where: { schoolId: user.schoolId, academicYearId: year.id },
      include: { feeHead: true },
    });

    const riders = await this.transportRiders(user.schoolId, enrollments.map((e) => e.studentId), body.period);
    // Library fines not paid at the desk go on the voucher.
    const fines = await this.prisma.bookLoan.findMany({
      where: { schoolId: user.schoolId, studentId: { in: enrollments.map((e) => e.studentId) }, fineStatus: FineStatus.DUE },
      include: { copy: { select: { book: { select: { title: true } } } } },
    });

    const firstMonth = year.startsOn.toISOString().slice(0, 7) === body.period;
    const [y, m] = body.period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dueDate = new Date(Date.UTC(y, m - 1, Math.min(school.feeDueDay, lastDay)));

    const created: { id: string; studentId: string; total: number; voucherNo: string; name: string }[] = [];
    for (const e of enrollments) {
      const lines = invoiceLines(
        structures
          .filter((s) => s.classId === e.section.classId)
          .map((s) => ({
            feeHeadId: s.feeHeadId,
            feeHeadName: s.feeHead.name,
            frequency: s.feeHead.frequency,
            amount: s.amount,
          }))
          .concat(riders.get(e.studentId) ?? []),
        e.student.concessions,
        firstMonth,
      );
      const studentFines = fines.filter((f) => f.studentId === e.studentId);
      for (const f of studentFines) {
        lines.push({ feeHeadId: null, description: `Library fine: ${f.copy.book.title}${f.lost ? ' (lost)' : ''}`, amount: f.fine });
      }
      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      if (!lines.length) continue;
      try {
        const invoice = await this.prisma.invoice.create({
          data: {
            schoolId: user.schoolId,
            studentId: e.studentId,
            voucherNo: voucherNo(body.period),
            period: body.period,
            dueDate,
            total,
            status: total <= 0 ? InvoiceStatus.PAID : InvoiceStatus.UNPAID,
            lines: { create: lines },
          },
        });
        if (studentFines.length) {
          await this.prisma.bookLoan.updateMany({
            where: { id: { in: studentFines.map((f) => f.id) }, fineStatus: FineStatus.DUE },
            data: { fineStatus: FineStatus.BILLED, invoiceId: invoice.id },
          });
        }
        created.push({
          id: invoice.id,
          studentId: e.studentId,
          total,
          voucherNo: invoice.voucherNo,
          name: fullName(e.student),
        });
      } catch (error) {
        // Another run created this student's invoice first; skip it.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }

    let messages = 0;
    if (body.sendWhatsApp && created.length) {
      const phones = await guardianPhones(this.prisma, created.map((c) => c.studentId));
      messages = await this.notifications.send(
        user.schoolId,
        created
          .filter((c) => c.total > 0)
          .flatMap((c) =>
            (phones.get(c.studentId) ?? []).map((to) => ({
              to,
              template: 'fees.voucher' as const,
              params: {
                studentName: c.name,
                period: body.period,
                amount: c.total.toLocaleString('en-PK'),
                dueDate: dueDate.toISOString().slice(0, 10),
                voucherNo: c.voucherNo,
                schoolName: school.name,
              },
            })),
          ),
      );
    }
    await this.audit.record(user, 'invoices.generate', 'Invoice', null, {
      after: { period: body.period, created: created.length },
    });
    return {
      created: created.length,
      skipped: enrollments.length - created.length,
      totalBilled: created.reduce((s, c) => s + c.total, 0),
      messages,
    };
  }

  @Get('invoices')
  @Roles(...FEE_ROLES)
  invoices(
    @CurrentUser() user: AuthUser,
    @Query('period') periodFilter?: string,
    @Query('status') status?: InvoiceStatus,
    @Query('studentId') studentId?: string,
    @Query('search') search?: string,
  ) {
    // Every word of the search must match the student, so "Musa Sheikh" finds his vouchers.
    const byStudent = studentSearchWhere(search);
    return this.prisma.invoice.findMany({
      where: {
        schoolId: user.schoolId,
        student: inFeeScope(user),
        ...(periodFilter ? { period: periodFilter } : {}),
        ...(status ? { status } : {}),
        ...(studentId ? { studentId } : {}),
        ...(search
          ? {
              OR: [
                { voucherNo: { contains: search.toUpperCase() } },
                ...(byStudent ? [{ student: byStudent }] : []),
              ],
            }
          : {}),
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      },
    });
  }

  /** Everything a printed voucher needs. */
  @Get('invoices/:id')
  @Roles(...FEE_ROLES)
  async invoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId: user.schoolId, student: inFeeScope(user) },
      include: {
        school: { select: { name: true, city: true, phone: true, logoUrl: true, lateFeePerDay: true } },
        lines: true,
        payments: { orderBy: { receivedAt: 'asc' } },
        student: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: { section: { select: { name: true, class: { select: { name: true } } } } },
            },
            guardians: { where: { isPrimary: true }, include: { guardian: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const fine =
      invoice.status === 'PAID' ? 0 : lateFine(invoice.dueDate, new Date(), invoice.school.lateFeePerDay);
    return { ...invoice, lateFine: fine, balance: invoice.total - invoice.paid };
  }

  /** Records a counter or bank payment. */
  @Post('invoices/:id/payments')
  @Roles(...FEE_ROLES)
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(paymentSchema)) body: z.infer<typeof paymentSchema>,
  ) {
    const owned = await this.prisma.invoice.count({
      where: { id, schoolId: user.schoolId, student: inFeeScope(user) },
    });
    if (!owned) throw new NotFoundException('Invoice not found');
    const result = await this.payments.record(user.schoolId, {
      invoiceId: id,
      ...body,
      receivedById: user.sub,
    });
    await this.audit.record(user, 'payment.create', 'Payment', result.payment.id, { after: result.payment });
    return result;
  }

  /** Unpaid or part-paid invoices past their due date, with the late fine so far. */
  @Get('defaulters')
  @Roles(...FEE_ROLES)
  async defaulters(@CurrentUser() user: AuthUser) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const now = new Date();
    const overdue = await this.prisma.invoice.findMany({
      where: {
        schoolId: user.schoolId,
        student: inFeeScope(user),
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
        dueDate: { lt: now },
      },
      orderBy: { dueDate: 'asc' },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true, phone: true } } } },
          },
        },
      },
    });
    return overdue.map((i) => ({
      invoiceId: i.id,
      voucherNo: i.voucherNo,
      period: i.period,
      student: i.student,
      balance: i.total - i.paid,
      lateFine: lateFine(i.dueDate, now, school.lateFeePerDay),
      daysOverdue: Math.floor((now.getTime() - i.dueDate.getTime()) / 86_400_000),
    }));
  }

  /** WhatsApp reminder to the guardians of every unpaid invoice for a month. */
  @Post('reminders')
  @Roles(...FEE_ROLES)
  async remind(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(z.object({ period }))) body: { period: string },
  ) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const unpaid = await this.prisma.invoice.findMany({
      where: {
        schoolId: user.schoolId,
        student: inFeeScope(user),
        period: body.period,
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
      },
      include: { student: { select: { firstName: true, lastName: true } } },
    });
    const phones = await guardianPhones(this.prisma, unpaid.map((i) => i.studentId));
    const sent = await this.notifications.send(
      user.schoolId,
      unpaid.flatMap((i) =>
        (phones.get(i.studentId) ?? []).map((to) => ({
          to,
          template: 'fees.reminder' as const,
          params: {
            studentName: fullName(i.student),
            period: i.period,
            amount: (i.total - i.paid).toLocaleString('en-PK'),
            schoolName: school.name,
          },
        })),
      ),
    );
    return { invoices: unpaid.length, messages: sent };
  }

  /**
   * A Transport line for each student who rode a school van during the
   * month, at their stop's fee. Concessions on the Transport head apply.
   */
  private async transportRiders(schoolId: string, studentIds: string[], period: string) {
    const { first, last } = monthBounds(period);
    const rides = await this.prisma.transportAssignment.findMany({
      where: {
        schoolId,
        studentId: { in: studentIds },
        startsOn: { lte: dayStart(last) },
        OR: [{ endsOn: null }, { endsOn: { gte: dayStart(first) } }],
      },
      include: { route: true, stop: true },
      orderBy: { startsOn: 'desc' },
    });
    const rows = new Map<string, StructureRow[]>();
    if (!rides.length) return rows;
    const head = await this.prisma.feeHead.upsert({
      where: { schoolId_name: { schoolId, name: 'Transport' } },
      create: { schoolId, name: 'Transport', frequency: FeeFrequency.MONTHLY },
      update: {},
    });
    // A student who changed routes mid-month pays the latest route's fee once.
    for (const r of rides) {
      if (rows.has(r.studentId)) continue;
      rows.set(r.studentId, [
        { feeHeadId: head.id, feeHeadName: 'Transport', frequency: FeeFrequency.MONTHLY, amount: riderFee(r.route, r.stop) },
      ]);
    }
    return rows;
  }

}
