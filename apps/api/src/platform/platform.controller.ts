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
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';
import {
  accessFor,
  effectiveFeatures,
  FEATURES,
  isFeature,
  monthlyAmount,
  nextInvoiceNumber,
} from './plans.js';
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
  features: z.array(z.string().refine(isFeature, 'Unknown feature')).optional(),
  isPublic: z.boolean().optional(),
});

const supportSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

const SUPPORT_SESSION_MS = 60 * 60_000;

const paySchema = z.object({
  method: z.string().trim().min(2).max(30),
  reference: z.string().trim().max(60).optional(),
  paidAt: z.coerce.date().optional(),
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
        _sum: { amount: true },
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
      unpaid: { amount: unpaid._sum.amount ?? 0, count: unpaid._count },
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
    const where: Prisma.SchoolWhereInput = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search.toLowerCase() } },
              { city: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(status && status in SubscriptionStatus
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
        _sum: { amount: true },
      }),
    ]);
    const lastLogin = new Map(
      lastLogins.map((l) => [l.schoolId, l._max.lastLoginAt]),
    );
    const due = new Map(unpaid.map((u) => [u.schoolId, u._sum.amount ?? 0]));
    return schools.map((s) => ({
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
      balanceDue: due.get(s.id) ?? 0,
      lastLoginAt: lastLogin.get(s.id) ?? null,
    }));
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
   * Bills every paying school for a month at its current student count.
   * Schools on trial, suspended or cancelled are skipped, as are schools
   * already billed for the month, so it is safe to run again.
   */
  @Post('invoices/generate')
  async generate(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(z.object({ period }))) body: { period: string },
  ) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
        school: { platformInvoices: { none: { period: body.period } } },
      },
      include: { plan: true },
    });
    const students = await this.studentCounts();
    const last = await this.prisma.platformInvoice.findFirst({
      where: { period: body.period },
      orderBy: { number: 'desc' },
    });
    let number = last?.number ?? null;
    const [y, m] = body.period.split('-').map(Number);
    const dueDate = new Date(Date.UTC(y, m - 1, 10));
    const created = [];
    for (const s of subs) {
      const count = students.get(s.schoolId) ?? 0;
      created.push(
        await this.prisma.platformInvoice.create({
          data: {
            number: (number = nextInvoiceNumber(body.period, number)),
            schoolId: s.schoolId,
            period: body.period,
            planName: s.plan.name,
            students: count,
            amount: monthlyAmount(s.plan, count),
            dueDate,
          },
        }),
      );
      this.subscriptions.forget(s.schoolId);
    }
    await this.log(admin, 'invoices.generate', null, {
      period: body.period,
      count: created.length,
    });
    return {
      created: created.length,
      total: created.reduce((sum, i) => sum + i.amount, 0),
    };
  }

  @Post('invoices/:id/pay')
  async pay(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(paySchema)) body: z.infer<typeof paySchema>,
  ) {
    const invoice = await this.prisma.platformInvoice.findUnique({
      where: { id },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== PlatformInvoiceStatus.UNPAID)
      throw new ConflictException(
        `This invoice is already ${invoice.status.toLowerCase()}`,
      );
    const after = await this.prisma.platformInvoice.update({
      where: { id },
      data: {
        status: PlatformInvoiceStatus.PAID,
        paidAt: body.paidAt ?? new Date(),
        method: body.method,
        reference: body.reference,
      },
    });
    // A past-due school that has cleared everything is back in good standing.
    const stillUnpaid = await this.prisma.platformInvoice.count({
      where: {
        schoolId: invoice.schoolId,
        status: PlatformInvoiceStatus.UNPAID,
      },
    });
    if (!stillUnpaid) {
      await this.prisma.subscription.updateMany({
        where: {
          schoolId: invoice.schoolId,
          status: SubscriptionStatus.PAST_DUE,
        },
        data: { status: SubscriptionStatus.ACTIVE },
      });
    }
    this.subscriptions.forget(invoice.schoolId);
    await this.log(admin, 'invoice.pay', invoice.schoolId, {
      number: invoice.number,
      amount: invoice.amount,
      method: body.method,
    });
    return after;
  }

  @Post('invoices/:id/void')
  async void(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    const invoice = await this.prisma.platformInvoice.findUnique({
      where: { id },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== PlatformInvoiceStatus.UNPAID)
      throw new ConflictException('Only unpaid invoices can be voided');
    const after = await this.prisma.platformInvoice.update({
      where: { id },
      data: { status: PlatformInvoiceStatus.VOID },
    });
    this.subscriptions.forget(invoice.schoolId);
    await this.log(admin, 'invoice.void', invoice.schoolId, {
      number: invoice.number,
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
