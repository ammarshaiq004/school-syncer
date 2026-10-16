import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  PlatformInvoiceStatus,
  PlatformRole,
  Prisma,
  Role,
  StudentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { z } from 'zod';
import type { AuthUser, PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { dayStart, localDate } from '../common/dates.js';
import { phoneSearchDigits } from '../notifications/phone.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';
import {
  accessFor,
  effectiveFeatures,
  FEATURES,
  isFeature,
  monthlyAmount,
} from './plans.js';
import { BillingService, nextPeriod } from './billing/billing.service.js';
import { SubscriptionService } from './subscription.service.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

const subscriptionSchema = z.object({
  planCode: z.string().optional(),
  status: z.enum(SubscriptionStatus).optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const planSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  pricePerStudent: z.number().int().min(0).max(100_000).optional(),
  minimumMonthly: z.number().int().min(0).max(10_000_000).optional(),
  maxStudents: z.number().int().min(1).nullable().optional(),
  maxCampuses: z.number().int().min(1).nullable().optional(),
  maxStorageMb: z.number().int().min(1).max(10_000_000).nullable().optional(),
  features: z.array(z.string().refine(isFeature, 'Unknown feature')).optional(),
  isPublic: z.boolean().optional(),
});

/** A written reason for a recorded action (support session, voiding a bill). */
const supportSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

const SUPPORT_SESSION_MS = 60 * 60_000;

/** The console flags schools this many days past a bill's due date. */
export const OVERDUE_FLAG_DAYS = 30;

const paySchema = z.object({
  method: z.string().trim().min(2).max(30),
  reference: z.string().trim().max(60).optional(),
  paidAt: z.coerce.date().optional(),
});

const paymentSchema = z.object({
  amount: z.number().int().min(1).max(100_000_000),
  method: z.string().trim().min(2).max(30),
  reference: z.string().trim().max(60).optional(),
  receivedOn: z.coerce.date().optional(),
  note: z.string().trim().max(300).optional(),
});

const settingsSchema = z.object({
  businessName: z.string().trim().min(2).max(100).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  ntn: z.string().trim().max(30).nullable().optional(),
  strn: z.string().trim().max(30).nullable().optional(),
  salesTaxPercent: z.number().int().min(1).max(50).nullable().optional(),
  paymentInstructions: z.string().trim().max(1000).nullable().optional(),
});

/** The SchoolSyncer console: every school, its plan, usage and bills. */
@Controller('platform')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly subscriptions: SubscriptionService,
    private readonly billing: BillingService,
  ) {}

  // ----- Overview -----

  @Get('overview')
  async overview() {
    const now = new Date();
    const [subs, students, unpaid, recent] = await Promise.all([
      this.prisma.subscription.findMany({
        include: {
          plan: true,
          school: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.studentCounts(),
      this.prisma.platformInvoice.aggregate({
        where: { status: PlatformInvoiceStatus.UNPAID },
        _sum: { amount: true, amountPaid: true },
        _count: true,
      }),
      this.prisma.school.findMany({
        where: {
          createdAt: { gte: new Date(now.getTime() - 180 * 86_400_000) },
        },
        select: { createdAt: true },
      }),
    ]);
    const byStatus = Object.fromEntries(
      Object.values(SubscriptionStatus).map((s) => [s, 0]),
    ) as Record<SubscriptionStatus, number>;
    let mrr = 0;
    for (const s of subs) {
      byStatus[s.status] += 1;
      if (
        s.status === SubscriptionStatus.ACTIVE ||
        s.status === SubscriptionStatus.PAST_DUE
      ) {
        mrr += monthlyAmount(s.plan, students.get(s.schoolId) ?? 0);
      }
    }
    const soon = new Date(now.getTime() + 7 * 86_400_000);
    const signups = new Map<string, number>();
    for (const r of recent) {
      const m = r.createdAt.toISOString().slice(0, 7);
      signups.set(m, (signups.get(m) ?? 0) + 1);
    }
    return {
      schools: subs.length,
      byStatus,
      students: [...students.values()].reduce((a, b) => a + b, 0),
      mrr,
      unpaid: {
        amount: (unpaid._sum.amount ?? 0) - (unpaid._sum.amountPaid ?? 0),
        count: unpaid._count,
      },
      trialsEnding: subs
        .filter(
          (s) =>
            s.status === SubscriptionStatus.TRIAL &&
            s.trialEndsAt &&
            s.trialEndsAt <= soon,
        )
        .map((s) => ({
          schoolId: s.schoolId,
          name: s.school.name,
          trialEndsAt: s.trialEndsAt,
          expired: s.trialEndsAt! < now,
        }))
        .sort((a, b) => +a.trialEndsAt! - +b.trialEndsAt!),
      signups: [...signups.entries()]
        .sort()
        .map(([month, count]) => ({ month, count })),
    };
  }

  // ----- Schools -----

  @Get('schools')
  async schools(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const now = new Date();
    // Phones are stored as typed, so they are compared digits-only in SQL.
    const digits = search ? phoneSearchDigits(search) : null;
    const byPhone = digits
      ? (
          await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT s.id FROM "School" s
            WHERE regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}
            UNION
            SELECT u."schoolId" FROM "User" u
            JOIN "RoleAssignment" r ON r."userId" = u.id AND r.role = 'OWNER'
            WHERE regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
        ).map((r) => r.id)
      : [];
    const where: Prisma.SchoolWhereInput = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search.toLowerCase() } },
              { city: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              {
                users: {
                  some: {
                    email: { contains: search, mode: 'insensitive' },
                    roles: { some: { role: Role.OWNER } },
                  },
                },
              },
              ...(byPhone.length ? [{ id: { in: byPhone } }] : []),
            ],
          }
        : {}),
      // TRIAL_ENDED is not stored: a trial past its end date.
      ...(status === 'TRIAL_ENDED'
        ? {
            subscription: {
              status: SubscriptionStatus.TRIAL,
              trialEndsAt: { lt: now },
            },
          }
        : status && status in SubscriptionStatus
          ? { subscription: { status: status as SubscriptionStatus } }
          : {}),
    };
    const [schools, students, lastLogins, unpaid] = await Promise.all([
      this.prisma.school.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          subscription: { include: { plan: true } },
          _count: { select: { campuses: true } },
        },
      }),
      this.studentCounts(),
      this.prisma.user.groupBy({
        by: ['schoolId'],
        _max: { lastLoginAt: true },
      }),
      this.prisma.platformInvoice.groupBy({
        by: ['schoolId'],
        where: { status: PlatformInvoiceStatus.UNPAID },
        _sum: { amount: true, amountPaid: true },
        _min: { dueDate: true },
      }),
    ]);
    const lastLogin = new Map(
      lastLogins.map((l) => [l.schoolId, l._max.lastLoginAt]),
    );
    const due = new Map(
      unpaid.map((u) => [
        u.schoolId,
        {
          amount: (u._sum.amount ?? 0) - (u._sum.amountPaid ?? 0),
          oldest: u._min.dueDate,
        },
      ]),
    );
    const today = dayStart(localDate(now));
    const daysOverdue = (id: string) => {
      const oldest = due.get(id)?.oldest;
      return oldest && oldest < today
        ? Math.round((+today - +oldest) / 86_400_000)
        : 0;
    };
    const rows = schools.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      city: s.city,
      createdAt: s.createdAt,
      plan: s.subscription?.plan.name ?? null,
      status: s.subscription?.status ?? null,
      trialEndsAt: s.subscription?.trialEndsAt ?? null,
      students: students.get(s.id) ?? 0,
      campuses: s._count.campuses,
      monthly: s.subscription
        ? monthlyAmount(s.subscription.plan, students.get(s.id) ?? 0)
        : 0,
      balanceDue: due.get(s.id)?.amount ?? 0,
      daysOverdue: daysOverdue(s.id),
      lastLoginAt: lastLogin.get(s.id) ?? null,
    }));
    // Schools to consider suspending: a bill unpaid 30 days or more past its due date.
    return status === 'OVERDUE_30'
      ? rows.filter((r) => r.daysOverdue >= OVERDUE_FLAG_DAYS)
      : rows;
  }

  @Get('schools/:id')
  async school(@Param('id') id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        subscription: { include: { plan: true } },
        campuses: { select: { id: true, name: true } },
        platformInvoices: { orderBy: { period: 'desc' } },
      },
    });
    if (!school) throw new NotFoundException('School not found');
    const [students, staff, parents, owners, lastLogin, history, oldestUnpaid] =
      await Promise.all([
        this.prisma.student.count({
          where: { schoolId: id, status: StudentStatus.ACTIVE },
        }),
        this.prisma.user.count({
          where: {
            schoolId: id,
            roles: { some: { role: { notIn: [Role.PARENT, Role.STUDENT] } } },
          },
        }),
        this.prisma.user.count({
          where: { schoolId: id, roles: { some: { role: Role.PARENT } } },
        }),
        this.prisma.user.findMany({
          where: { schoolId: id, roles: { some: { role: Role.OWNER } } },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            lastLoginAt: true,
          },
        }),
        this.prisma.user.aggregate({
          where: { schoolId: id },
          _max: { lastLoginAt: true },
        }),
        this.prisma.platformAuditLog.findMany({
          where: { schoolId: id },
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: { admin: { select: { name: true } } },
        }),
        this.prisma.platformInvoice.findFirst({
          where: { schoolId: id, status: PlatformInvoiceStatus.UNPAID },
          orderBy: { dueDate: 'asc' },
        }),
      ]);
    const sub = school.subscription;
    return {
      id: school.id,
      name: school.name,
      slug: school.slug,
      city: school.city,
      phone: school.phone,
      email: school.email,
      createdAt: school.createdAt,
      campuses: school.campuses,
      owners,
      usage: {
        students,
        staff,
        parents,
        lastLoginAt: lastLogin._max.lastLoginAt,
      },
      subscription: sub && {
        plan: { code: sub.plan.code, name: sub.plan.name },
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        notes: sub.notes,
        planFeatures: sub.plan.features,
        featuresAdded: sub.featuresAdded,
        featuresRemoved: sub.featuresRemoved,
        features: effectiveFeatures(
          sub.plan.features,
          sub.featuresAdded,
          sub.featuresRemoved,
        ),
        monthly: monthlyAmount(sub.plan, students),
        ...accessFor({
          status: sub.status,
          trialEndsAt: sub.trialEndsAt,
          oldestUnpaidDue: oldestUnpaid?.dueDate ?? null,
        }),
      },
      invoices: school.platformInvoices,
      history,
    };
  }

  /** Changes a school's plan, status, trial end or notes. */
  @Patch('schools/:id/subscription')
  async updateSubscription(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(subscriptionSchema))
    body: z.infer<typeof subscriptionSchema>,
  ) {
    const before = await this.prisma.subscription.findUnique({
      where: { schoolId: id },
      include: { plan: true },
    });
    if (!before) throw new NotFoundException('School has no subscription');
    if (
      body.status === SubscriptionStatus.CANCELLED &&
      before.status !== SubscriptionStatus.CANCELLED &&
      admin.role !== PlatformRole.OWNER
    )
      throw new ForbiddenException('Only a SchoolSyncer owner can close a school');
    let planId: string | undefined;
    if (body.planCode) {
      const plan = await this.prisma.plan.findUnique({
        where: { code: body.planCode },
      });
      if (!plan) throw new BadRequestException('No such plan');
      planId = plan.id;
    }
    const after = await this.prisma.subscription.update({
      where: { schoolId: id },
      data: {
        planId,
        status: body.status,
        trialEndsAt: body.trialEndsAt,
        notes: body.notes,
        // Out of the trial: the nightly bill run starts with next month.
        ...(before.status === SubscriptionStatus.TRIAL &&
        body.status === SubscriptionStatus.ACTIVE
          ? { billedFrom: nextPeriod(localDate(new Date()).slice(0, 7)) }
          : {}),
      },
      include: { plan: true },
    });
    this.subscriptions.forget(id);
    await this.log(admin, 'subscription.update', id, {
      before: {
        plan: before.plan.code,
        status: before.status,
        trialEndsAt: before.trialEndsAt,
      },
      after: {
        plan: after.plan.code,
        status: after.status,
        trialEndsAt: after.trialEndsAt,
      },
    });
    return after;
  }

  /**
   * Signs a SchoolSyncer staff member in as the school's owner for an hour, to
   * help with a support request. The token carries `support` so the school
   * app shows a banner, and the visit is recorded with its reason in both the
   * platform's and the school's audit logs.
   */
  @Post('schools/:id/support-login')
  async supportLogin(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(supportSchema)) body: { reason: string },
  ) {
    const owner = await this.prisma.user.findFirst({
      where: {
        schoolId: id,
        isActive: true,
        roles: { some: { role: Role.OWNER } },
      },
      include: { roles: true, school: { select: { slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner)
      throw new NotFoundException(
        'This school has no active owner to sign in as',
      );
    const payload: AuthUser = {
      sub: owner.id,
      schoolId: id,
      name: owner.name,
      roles: owner.roles.map(({ role, campusId, customRoleId }) => ({
        role,
        campusId,
        customRoleId,
      })),
      support: { adminId: admin.sub, adminName: admin.name },
      tv: owner.tokenVersion,
    };
    const expiresAt = new Date(Date.now() + SUPPORT_SESSION_MS);
    await this.prisma.auditLog.create({
      data: {
        schoolId: id,
        userId: null,
        action: 'platform.support_login',
        entity: 'User',
        entityId: owner.id,
        after: { by: admin.name, byAdminId: admin.sub, reason: body.reason },
      },
    });
    await this.log(admin, 'school.support_login', id, {
      as: owner.id,
      reason: body.reason,
      expiresAt,
    });
    return {
      accessToken: this.jwt.sign(payload, {
        expiresIn: SUPPORT_SESSION_MS / 1000,
      }),
      expiresAt,
      schoolSlug: owner.school.slug,
      user: payload,
    };
  }

  // ----- Plans -----

  @Get('plans')
  async plans() {
    const [plans, counts] = await Promise.all([
      this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.subscription.groupBy({ by: ['planId'], _count: true }),
    ]);
    const schools = new Map(counts.map((c) => [c.planId, c._count]));
    return {
      features: FEATURES,
      plans: plans.map((p) => ({ ...p, schools: schools.get(p.id) ?? 0 })),
    };
  }

  @Patch('plans/:id')
  @PlatformOwnerOnly()
  async updatePlan(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(planSchema)) body: z.infer<typeof planSchema>,
  ) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found');
    const after = await this.prisma.plan.update({ where: { id }, data: body });
    // Every school on this plan sees the change.
    this.subscriptions.forget();
    await this.log(admin, 'plan.update', null, {
      plan: after.code,
      before,
      after,
    });
    return after;
  }

  // ----- Platform invoices -----

  @Get('invoices')
  invoices(
    @Query('status') status?: string,
    @Query('period') forPeriod?: string,
  ) {
    return this.prisma.platformInvoice.findMany({
      where: {
        ...(status && status in PlatformInvoiceStatus
          ? { status: status as PlatformInvoiceStatus }
          : {}),
        ...(forPeriod ? { period: forPeriod } : {}),
      },
      orderBy: [{ period: 'desc' }, { number: 'desc' }],
      take: 500,
      include: { school: { select: { id: true, name: true, slug: true } } },
    });
  }

  /**
   * Bills every paying school for a month at its current student count. The
   * nightly run does this on the 1st; staff can run it for any month. Schools
   * on trial, suspended, closed or already billed for the month are skipped.
   */
  @Post('invoices/generate')
  async generate(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(z.object({ period }))) body: { period: string },
  ) {
    const result = await this.billing.issueBills(body.period);
    await this.log(admin, 'invoices.generate', null, {
      period: body.period,
      count: result.created,
    });
    return { created: result.created, total: result.total };
  }

  /** One bill with what has been paid towards it, for the printable bill. */
  @Get('invoices/:id')
  async invoice(@Param('id') id: string) {
    const invoice = await this.prisma.platformInvoice.findUnique({
      where: { id },
      include: {
        school: { select: { id: true, name: true, slug: true, city: true, phone: true, email: true } },
        allocations: { include: { payment: { select: { id: true, number: true, receivedOn: true, method: true, status: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Bill not found');
    return { invoice, settings: await this.billing.settings() };
  }

  /** Records a payment for whatever is still owed on one bill. */
  @Post('invoices/:id/pay')
  async pay(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(paySchema)) body: z.infer<typeof paySchema>,
  ) {
    const { payment, invoice } = await this.billing.payInvoice(
      id,
      { method: body.method, reference: body.reference, receivedOn: body.paidAt },
      admin.name,
    );
    await this.log(admin, 'invoice.pay', invoice.schoolId, {
      number: invoice.number,
      receipt: payment.number,
      amount: payment.amount,
      method: body.method,
    });
    return invoice;
  }

  /**
   * Writes off an unpaid bill (and may lift a past-due block), so only an
   * owner can do it and the reason is kept on the bill and in the audit log.
   * Anything already paid towards it becomes credit.
   */
  @Post('invoices/:id/void')
  @PlatformOwnerOnly()
  async void(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(supportSchema)) body: { reason: string },
  ) {
    const after = await this.billing.voidInvoice(id, body.reason);
    await this.log(admin, 'invoice.void', after.schoolId, {
      number: after.number,
      amount: after.amount,
      reason: body.reason,
    });
    return after;
  }

  // ----- Payments and statements -----

  @Get('payments')
  payments(@Query('status') status?: string) {
    return this.prisma.platformPayment.findMany({
      where: status === 'VOID' || status === 'RECORDED' ? { status } : {},
      orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        school: { select: { id: true, name: true, slug: true } },
        allocations: { include: { invoice: { select: { id: true, number: true } } } },
      },
    });
  }

  /** One payment, for the printable receipt. */
  @Get('payments/:id')
  async payment(@Param('id') id: string) {
    const payment = await this.prisma.platformPayment.findUnique({
      where: { id },
      include: {
        school: { select: { id: true, name: true, slug: true, city: true, phone: true, email: true } },
        allocations: { include: { invoice: { select: { id: true, number: true, period: true, amount: true } } } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return { payment, settings: await this.billing.settings() };
  }

  /** Money received from a school: applied to its oldest unpaid bills, the rest kept as credit. */
  @Post('schools/:id/payments')
  async recordPayment(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') schoolId: string,
    @Body(new ZodValidationPipe(paymentSchema)) body: z.infer<typeof paymentSchema>,
  ) {
    const payment = await this.billing.recordPayment(schoolId, body, admin.name);
    await this.log(admin, 'payment.record', schoolId, {
      receipt: payment.number,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
    });
    return payment;
  }

  /** Undoes a payment recorded by mistake; the bills it paid are owed again. */
  @Post('payments/:id/void')
  @PlatformOwnerOnly()
  async voidPayment(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(supportSchema)) body: { reason: string },
  ) {
    const payment = await this.billing.voidPayment(id, body.reason);
    await this.log(admin, 'payment.void', payment.schoolId, {
      receipt: payment.number,
      amount: payment.amount,
      reason: body.reason,
    });
    return payment;
  }

  @Get('schools/:id/statement')
  async statement(@Param('id') schoolId: string) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundException('School not found');
    return this.billing.statement(schoolId);
  }

  /** Issues this month's bill for one school now instead of waiting for the nightly run. */
  @Post('schools/:id/bill-now')
  async billNow(@CurrentAdmin() admin: PlatformUser, @Param('id') schoolId: string) {
    const forPeriod = localDate(new Date()).slice(0, 7);
    const result = await this.billing.issueBills(forPeriod, { schoolId });
    if (!result.created)
      throw new ConflictException(
        'Nothing to bill: the school is already billed for this month, on trial, suspended, closed, or starts paying next month.',
      );
    await this.log(admin, 'invoices.generate', schoolId, { period: forPeriod, count: 1 });
    return result.invoices[0];
  }

  // ----- SchoolSyncer's business details -----

  @Get('settings')
  settings() {
    return this.billing.settings();
  }

  @Patch('settings')
  @PlatformOwnerOnly()
  async updateSettings(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    const before = await this.billing.settings();
    const after = await this.prisma.platformSettings.update({ where: { id: 'default' }, data: body });
    await this.log(admin, 'settings.update', null, {
      changed: Object.keys(body).filter((k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]),
    });
    return after;
  }

  // ----- Helpers -----

  private async studentCounts() {
    const rows = await this.prisma.student.groupBy({
      by: ['schoolId'],
      where: { status: StudentStatus.ACTIVE },
      _count: true,
    });
    return new Map(rows.map((r) => [r.schoolId, r._count]));
  }

  private log(
    admin: PlatformUser,
    action: string,
    schoolId: string | null,
    details: unknown,
  ) {
    return logPlatform(this.prisma, admin, action, schoolId, details);
  }
}
