import {
  BadRequestException,
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
  InvoiceKind,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { assertSchoolWide, campusScopeFor, FEE_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { studentSearchWhere } from '../common/student-search.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dayStart, localToday } from '../common/dates.js';
import { createAdhocVoucher } from './adhoc-vouchers.js';
import { daysLate, fineDue, fineRule, siblingPercent } from './fee-calculator.js';
import { billedOf, feeOutstanding, OPEN_INVOICE, overdueWhere } from './outstanding.js';
import { PaymentsService } from './payments.service.js';
import { schoolSiblings } from './siblings.js';
import { VoucherRunsService } from './voucher-runs.service.js';

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
const concessionSchema = z
  .object({
    feeHeadId: z.string().min(1),
    type: z.enum(ConcessionType),
    value: z.number().int().min(0).max(10_000_000),
    reason: z.string().trim().max(200).optional(),
    // First and last billing months it covers; left out (or null) = open-ended.
    validFrom: period.nullish(),
    validTo: period.nullish(),
  })
  .refine((c) => c.type !== ConcessionType.PERCENT || c.value <= 100, {
    message: 'A percentage concession is at most 100',
    path: ['value'],
  })
  .refine((c) => !c.validFrom || !c.validTo || c.validFrom <= c.validTo, {
    message: 'The last month must be on or after the first month',
    path: ['validTo'],
  });
const generateSchema = z.object({
  period,
  classId: z.string().optional(),
  sendWhatsApp: z.boolean().default(false),
  // Defaults to the school's fee rule.
  carryForward: z.boolean().optional(),
});
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const adhocSchema = z.object({
  lines: z
    .array(
      z.object({
        feeHeadId: z.string().min(1).optional(),
        description: z.string().trim().max(80).optional(),
        amount: z.number().int().min(1).max(10_000_000),
      }),
    )
    .min(1, 'Add at least one charge')
    .max(10),
  dueDate: isoDay.optional(),
});
const policySchema = z.object({
  lateFeePerDay: z.number().int().min(0).max(100_000).optional(),
  lateFeeMaxDays: z.number().int().min(1).max(366).nullable().optional(),
  lateFeeCap: z.number().int().min(1).max(10_000_000).nullable().optional(),
  siblingSecondPercent: z.number().int().min(0).max(100).optional(),
  siblingThirdPercent: z.number().int().min(0).max(100).optional(),
  siblingFeeHeadIds: z.array(z.string().min(1)).max(50).optional(),
  admissionFeeHeadId: z.string().min(1).nullable().optional(),
  carryForwardArrears: z.boolean().optional(),
});
const invoiceListSchema = z.object({
  period: period.optional(),
  // OVERDUE: open and past the due date.
  status: z.enum({ ...InvoiceStatus, OVERDUE: 'OVERDUE' } as const).optional(),
  kind: z.enum(InvoiceKind).optional(),
  classId: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const paymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(PaymentMethod),
  reference: z.string().trim().max(80).optional(),
  // Sent by the client so a retried or double-clicked save records the payment once.
  // Namespaced so it can never match a gateway's key.
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(80)
    .optional()
    .transform((k) => (k ? `client:${k}` : undefined)),
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

const POLICY_FIELDS = {
  lateFeePerDay: true,
  lateFeeMaxDays: true,
  lateFeeCap: true,
  feeDueDay: true,
  siblingSecondPercent: true,
  siblingThirdPercent: true,
  siblingFeeHeadIds: true,
  admissionFeeHeadId: true,
  carryForwardArrears: true,
} satisfies Prisma.SchoolSelect;

@Controller('fees')
@Permission('fees')
@RequiresFeature('fees')
export class FeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly runs: VoucherRunsService,
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

  // ----- Fee rules (late fine caps, sibling discount, admission fee) -----

  @Get('policy')
  @Roles(...FEE_ROLES)
  policy(@CurrentUser() user: AuthUser) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: POLICY_FIELDS });
  }

  /** School-wide fee rules: only fee staff who cover every campus may change them. */
  @Put('policy')
  @Roles(...FEE_ROLES)
  async setPolicy(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(policySchema)) body: z.infer<typeof policySchema>,
  ) {
    assertSchoolWide(user, 'Fee rules apply to the whole school; ask a school-wide fee manager to change them.', FEE_ROLES);
    const heads = [...new Set([...(body.siblingFeeHeadIds ?? []), ...(body.admissionFeeHeadId ? [body.admissionFeeHeadId] : [])])];
    const found = await this.prisma.feeHead.findMany({ where: { id: { in: heads }, schoolId: user.schoolId } });
    if (found.length !== heads.length) throw new NotFoundException('Fee head not found');
    if (body.admissionFeeHeadId && found.find((h) => h.id === body.admissionFeeHeadId)?.frequency !== FeeFrequency.ONE_TIME) {
      throw new BadRequestException('The admission fee must be a one-time fee head.');
    }
    const before = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: POLICY_FIELDS });
    const after = await this.prisma.school.update({ where: { id: user.schoolId }, data: body, select: POLICY_FIELDS });
    await this.audit.record(user, 'fee_policy.update', 'School', user.schoolId, { before, after });
    return after;
  }

  // ----- Concessions -----

  /**
   * What the student fees screen needs: the student's concessions, their
   * place among siblings and the sibling discount it earns, and the one-time
   * charges their class can be billed.
   */
  @Get('students/:studentId/fee-profile')
  @Roles(...FEE_ROLES)
  async feeProfile(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId, ...inFeeScope(user) },
      select: {
        id: true,
        concessions: { include: { feeHead: { select: { name: true, frequency: true } } }, orderBy: { createdAt: 'asc' } },
        enrollments: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { academicYearId: true, section: { select: { classId: true } } },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: POLICY_FIELDS });
    const enrollment = student.enrollments[0];
    const year = await this.prisma.academicYear.findFirst({ where: { schoolId: user.schoolId, isCurrent: true } });
    const place = year ? (await schoolSiblings(this.prisma, user.schoolId, year.id)).get(studentId) : undefined;
    const others = place ? place.family.filter((id) => id !== studentId) : [];
    const siblings = others.length
      ? await this.prisma.student.findMany({
          where: { id: { in: others } },
          select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true },
        })
      : [];
    const scope = feeScope(user);
    const percent = place
      ? siblingPercent({ rank: place.rank, secondPercent: school.siblingSecondPercent, thirdPercent: school.siblingThirdPercent, feeHeadIds: [] })
      : 0;
    const heads = await this.prisma.feeHead.findMany({
      where: { id: { in: school.siblingFeeHeadIds }, schoolId: user.schoolId },
      select: { id: true, name: true },
    });
    const oneTime = enrollment
      ? await this.prisma.feeStructure.findMany({
          where: {
            classId: enrollment.section.classId,
            academicYearId: enrollment.academicYearId,
            feeHead: { frequency: FeeFrequency.ONE_TIME },
          },
          select: { feeHeadId: true, amount: true, feeHead: { select: { name: true } } },
        })
      : [];
    return {
      concessions: student.concessions,
      sibling: {
        rank: place?.rank ?? 1,
        familySize: place?.size ?? 1,
        percent,
        feeHeads: heads,
        // A sibling at a campus the caller does not cover is counted but not named.
        siblings: others.flatMap((id): { id: string | null; name: string; admissionNo: string | null }[] => {
          const s = siblings.find((x) => x.id === id);
          if (!s) return [];
          return !scope || scope.includes(s.campusId)
            ? [{ id: s.id, name: fullName(s), admissionNo: s.admissionNo }]
            : [{ id: null, name: 'Sibling at another campus', admissionNo: null }];
        }),
      },
      oneTimeCharges: oneTime.map((s) => ({ feeHeadId: s.feeHeadId, name: s.feeHead.name, amount: s.amount })),
      admissionFeeHeadId: school.admissionFeeHeadId,
    };
  }

  /** A one-off voucher for one student: admission or registration fee, a one-time charge. */
  @Post('students/:studentId/vouchers')
  @Roles(...FEE_ROLES)
  async adhocVoucher(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(adhocSchema)) body: z.infer<typeof adhocSchema>,
  ) {
    const student = await this.prisma.student.count({ where: { id: studentId, schoolId: user.schoolId, ...inFeeScope(user) } });
    if (!student) throw new NotFoundException('Student not found');
    const headIds = [...new Set(body.lines.flatMap((l) => (l.feeHeadId ? [l.feeHeadId] : [])))];
    const heads = await this.prisma.feeHead.findMany({ where: { id: { in: headIds }, schoolId: user.schoolId } });
    if (heads.length !== headIds.length) throw new NotFoundException('Fee head not found');
    const lines = body.lines.map((l) => {
      const description = l.description || heads.find((h) => h.id === l.feeHeadId)?.name;
      if (!description) throw new BadRequestException('Say what each charge is for, or pick a fee head.');
      return { feeHeadId: l.feeHeadId ?? null, description, amount: l.amount };
    });
    const today = localToday();
    if (body.dueDate && body.dueDate < today) throw new BadRequestException('The due date cannot be in the past.');
    const invoice = await this.prisma.$transaction((tx) =>
      createAdhocVoucher(tx, { schoolId: user.schoolId, studentId, lines, dueDate: body.dueDate ?? today }),
    );
    await this.audit.record(user, 'invoice.adhoc', 'Invoice', invoice.id, { after: invoice });
    return invoice;
  }

  @Get('students/:studentId/concessions')
  @Roles(...FEE_ROLES)
  async concessions(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    const student = await this.prisma.student.count({ where: { id: studentId, schoolId: user.schoolId, ...inFeeScope(user) } });
    if (!student) throw new NotFoundException('Student not found');
    return this.prisma.concession.findMany({
      where: { studentId },
      include: { feeHead: { select: { name: true, frequency: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

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
    const data = { ...body, validFrom: body.validFrom ?? null, validTo: body.validTo ?? null };
    const before = await this.prisma.concession.findUnique({
      where: { studentId_feeHeadId: { studentId, feeHeadId: body.feeHeadId } },
    });
    const concession = await this.prisma.concession.upsert({
      where: { studentId_feeHeadId: { studentId, feeHeadId: body.feeHeadId } },
      update: data,
      create: { ...data, studentId },
    });
    await this.audit.record(user, 'concession.set', 'Concession', concession.id, { before, after: concession });
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
   * Bills every active student in the current academic year for a month, in
   * batches that each commit whole. Students who already have the month's
   * voucher are skipped, so it is safe to run again to fill any gap.
   */
  @Post('invoices/generate')
  @Roles(...FEE_ROLES)
  generate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>,
  ) {
    return this.runs.generate(user, body);
  }

  /** The latest voucher runs with what each billed, skipped and carried forward. */
  @Get('voucher-runs')
  @Roles(...FEE_ROLES)
  voucherRuns(@CurrentUser() user: AuthUser) {
    return this.runs.runs(user);
  }

  @Get('invoices')
  @Roles(...FEE_ROLES)
  invoices(
    @CurrentUser() user: AuthUser,
    @Query('period') periodFilter?: string,
    @Query('status', new ZodValidationPipe(z.enum(InvoiceStatus).optional())) status?: InvoiceStatus,
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

  /**
   * Vouchers a page at a time, with totals over every voucher the filters
   * match (not just the page): billed, collected and the one shared
   * outstanding figure.
   */
  @Get('invoices/paged')
  @Roles(...FEE_ROLES)
  async invoicePage(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(invoiceListSchema)) q: z.infer<typeof invoiceListSchema>,
  ) {
    const byStudent = studentSearchWhere(q.search);
    const today = localToday();
    const base: Prisma.InvoiceWhereInput = {
      schoolId: user.schoolId,
      student: {
        ...inFeeScope(user),
        ...(q.classId ? { enrollments: { some: { status: 'ACTIVE', section: { classId: q.classId } } } } : {}),
      },
      ...(q.period ? { period: q.period } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.search
        ? { OR: [{ voucherNo: { contains: q.search.toUpperCase() } }, ...(byStudent ? [{ student: byStudent }] : [])] }
        : {}),
    };
    const where: Prisma.InvoiceWhereInput =
      q.status === 'OVERDUE'
        ? { AND: [base, overdueWhere(today)] }
        : q.status
          ? { ...base, status: q.status as InvoiceStatus }
          : base;
    const [total, items, sums, owed] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      }),
      // Voided vouchers bill nothing.
      this.prisma.invoice.aggregate({
        where: { AND: [where, { status: { not: InvoiceStatus.CANCELLED } }] },
        _sum: { total: true, paid: true, arrears: true },
        _count: true,
      }),
      feeOutstanding(this.prisma, where, today),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      summary: {
        vouchers: sums._count,
        billed: billedOf(sums._sum),
        collected: sums._sum.paid ?? 0,
        outstanding: owed.outstanding.amount,
        overdue: owed.overdue,
      },
    };
  }

  /**
   * The school's outstanding fees: every open voucher's balance, the overdue
   * part (what the defaulters list adds up to) and late fines not yet booked.
   * The dashboard and reports use the same calculation.
   */
  @Get('outstanding')
  @Roles(...FEE_ROLES)
  async outstanding(@CurrentUser() user: AuthUser) {
    const today = localToday();
    const where = { schoolId: user.schoolId, student: inFeeScope(user) };
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const [owed, overdue] = await Promise.all([
      feeOutstanding(this.prisma, where, today),
      this.prisma.invoice.findMany({
        where: { ...where, ...overdueWhere(today) },
        select: { dueDate: true, total: true, paid: true, status: true, fineBooked: true, fineWaivedAt: true },
      }),
    ]);
    const rule = fineRule(school);
    return {
      ...owed,
      lateFines: overdue.reduce((s, i) => s + fineDue(i, dayStart(today), rule), 0),
      asOf: today,
    };
  }

  /** Everything a printed voucher needs. */
  @Get('invoices/:id')
  @Roles(...FEE_ROLES)
  async invoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId: user.schoolId, student: inFeeScope(user) },
      include: {
        school: {
          select: { name: true, city: true, phone: true, logoUrl: true, lateFeePerDay: true, lateFeeMaxDays: true, lateFeeCap: true },
        },
        lines: { orderBy: { id: 'asc' } },
        carriedTo: { select: { id: true, voucherNo: true, period: true } },
        carriedFrom: { select: { id: true, voucherNo: true, period: true } },
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
    // Fine built up and not yet booked; what is booked is already a line in the total.
    const fine = fineDue(invoice, dayStart(localToday()), fineRule(invoice.school));
    const owing = invoice.status === InvoiceStatus.UNPAID || invoice.status === InvoiceStatus.PARTIAL;
    return { ...invoice, lateFine: fine, balance: owing ? Math.max(0, invoice.total - invoice.paid) : 0 };
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
    const today = localToday();
    const asOf = dayStart(today);
    const rule = fineRule(school);
    // The same overdue rule as /fees/outstanding and the dashboard.
    const overdue = await this.prisma.invoice.findMany({
      where: { schoolId: user.schoolId, student: inFeeScope(user), ...overdueWhere(today) },
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
      lateFine: fineDue(i, asOf, rule),
      daysOverdue: daysLate(i.dueDate, asOf),
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
        ...OPEN_INVOICE,
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
}
