import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Role, StudentStatus, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { AllowWhenReadOnly, CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { localDate } from '../common/dates.js';
import { BillingService, nextPeriod } from './billing/billing.service.js';
import { FEATURES, monthlyAmount } from './plans.js';
import { SubscriptionService } from './subscription.service.js';

const choosePlanSchema = z.object({ planCode: z.string().min(1) });

/** The school's own view of its SchoolSyncer plan and bills. */
@Controller('subscription')
@Permission('billing')
@Roles(...SETUP_ROLES, Role.ACCOUNTANT)
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const [sub, students, campuses, plans, invoices, access, statement, notices, settings] =
      await Promise.all([
        this.prisma.subscription.findUnique({
          where: { schoolId: user.schoolId },
          include: { plan: true },
        }),
        this.usage(user.schoolId),
        this.prisma.campus.count({ where: { schoolId: user.schoolId } }),
        this.prisma.plan.findMany({
          where: { isPublic: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.platformInvoice.findMany({
          where: { schoolId: user.schoolId },
          orderBy: { period: 'desc' },
          take: 24,
        }),
        this.subscriptions.forSchool(user.schoolId),
        this.billing.statement(user.schoolId),
        this.prisma.platformNotice.findMany({
          where: { schoolId: user.schoolId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.billing.settings(),
      ]);
    if (!sub) throw new NotFoundException('This school has no plan');
    return {
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      access: access.access,
      reason: access.reason,
      plan: { code: sub.plan.code, name: sub.plan.name },
      usage: { students, campuses },
      estimate: monthlyAmount(sub.plan, students),
      plans: plans.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        pricePerStudent: p.pricePerStudent,
        minimumMonthly: p.minimumMonthly,
        maxStudents: p.maxStudents,
        maxCampuses: p.maxCampuses,
        features: p.features
          .map((f) => FEATURES[f as keyof typeof FEATURES])
          .filter(Boolean),
        estimate: monthlyAmount(p, students),
        fits:
          (p.maxStudents === null || students <= p.maxStudents) &&
          (p.maxCampuses === null || campuses <= p.maxCampuses),
      })),
      invoices,
      outstanding: statement.outstanding,
      credit: statement.credit,
      payments: statement.payments
        .slice()
        .reverse()
        .slice(0, 24)
        .map((p) => ({
          id: p.id,
          number: p.number,
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          receivedOn: p.receivedOn,
          status: p.status,
          bills: p.allocations.map((a) => a.invoice.number),
        })),
      notices,
      paymentInstructions: settings.paymentInstructions,
    };
  }

  /** One SchoolSyncer bill, for the printable copy. */
  @Get('invoices/:id')
  @AllowWhenReadOnly()
  async invoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const invoice = await this.prisma.platformInvoice.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        school: { select: { id: true, name: true, slug: true, city: true, phone: true, email: true } },
        allocations: { include: { payment: { select: { id: true, number: true, receivedOn: true, method: true, status: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Bill not found');
    return { invoice, settings: await this.billing.settings() };
  }

  /** One receipt for a payment to SchoolSyncer. */
  @Get('payments/:id')
  @AllowWhenReadOnly()
  async payment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const payment = await this.prisma.platformPayment.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        school: { select: { id: true, name: true, slug: true, city: true, phone: true, email: true } },
        allocations: { include: { invoice: { select: { id: true, number: true, period: true, amount: true } } } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return { payment, settings: await this.billing.settings() };
  }

  /** Unread SchoolSyncer messages that need attention, for the banner at the top of the app. */
  @Get('notices/unread')
  @AllowWhenReadOnly()
  unread(@CurrentUser() user: AuthUser) {
    return this.prisma.platformNotice.findMany({
      where: { schoolId: user.schoolId, readAt: null, severity: { in: ['WARNING', 'URGENT'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  }

  @Post('notices/:id/read')
  @AllowWhenReadOnly()
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { count } = await this.prisma.platformNotice.updateMany({
      where: { id, schoolId: user.schoolId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /**
   * The owner picks a plan. Choosing one ends the trial: billing starts with
   * the next monthly invoice. Works even when the school is read-only, since
   * that is how a school gets out of it.
   */
  @Post('plan')
  @Roles(Role.OWNER)
  @AllowWhenReadOnly()
  async choosePlan(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(choosePlanSchema))
    body: z.infer<typeof choosePlanSchema>,
  ) {
    const plan = await this.prisma.plan.findFirst({
      where: { code: body.planCode, isPublic: true },
    });
    if (!plan) throw new NotFoundException('No such plan');
    const before = await this.prisma.subscription.findUniqueOrThrow({
      where: { schoolId: user.schoolId },
    });
    const students = await this.usage(user.schoolId);
    const campuses = await this.prisma.campus.count({
      where: { schoolId: user.schoolId },
    });
    if (plan.maxStudents !== null && students > plan.maxStudents) {
      throw new ConflictException(
        `${plan.name} allows ${plan.maxStudents} students; the school has ${students}.`,
      );
    }
    if (plan.maxCampuses !== null && campuses > plan.maxCampuses) {
      throw new ConflictException(
        `${plan.name} allows ${plan.maxCampuses} campuses; the school has ${campuses}.`,
      );
    }
    const after = await this.prisma.subscription.update({
      where: { schoolId: user.schoolId },
      data: {
        planId: plan.id,
        // A trial becomes a paid plan; a past-due school stays past due until it pays.
        status:
          before.status === SubscriptionStatus.TRIAL
            ? SubscriptionStatus.ACTIVE
            : before.status,
        // The rest of this month is free; the nightly bill run starts next month.
        ...(before.status === SubscriptionStatus.TRIAL
          ? { billedFrom: nextPeriod(localDate(new Date()).slice(0, 7)) }
          : {}),
      },
    });
    this.subscriptions.forget(user.schoolId);
    await this.audit.record(
      user,
      'subscription.plan',
      'Subscription',
      after.id,
      {
        before: { planId: before.planId, status: before.status },
        after: { planId: after.planId, status: after.status },
      },
    );
    return { plan: plan.code, status: after.status };
  }

  private usage(schoolId: string) {
    return this.prisma.student.count({
      where: { schoolId, status: StudentStatus.ACTIVE },
    });
  }
}
