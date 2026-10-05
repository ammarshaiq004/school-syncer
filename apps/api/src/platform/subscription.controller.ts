import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
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
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const [sub, students, campuses, plans, invoices, access] =
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
    };
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
