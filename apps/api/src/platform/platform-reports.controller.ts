import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  PlatformInvoiceStatus,
  Prisma,
  StudentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { localDate, startOfLocalDay } from '../common/dates.js';
import { PlatformOnly } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard } from './platform-access.guard.js';
import { monthlyAmount } from './plans.js';
import {
  byMonth,
  fallingStudents,
  monthKeys,
  trialConversion,
} from './reports.js';

const PAGE_SIZE = 50;
const DAY = 86_400_000;

/** Console-wide numbers and the console's audit trail. */
@Controller('platform')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paged audit trail of console actions, newest first. `action` matches as a
   * prefix, so "school." finds every school action.
   */
  @Get('audit')
  async audit(
    @Query('schoolId') schoolId?: string,
    @Query('adminId') adminId?: string,
    @Query('action') action?: string,
    @Query('page') pageParam?: string,
  ) {
    const page = Math.max(1, Math.floor(Number(pageParam)) || 1);
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(schoolId ? { schoolId } : {}),
      ...(adminId ? { adminId } : {}),
      ...(action ? { action: { startsWith: action } } : {}),
    };
    const [rows, total, actions] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { admin: { select: { id: true, name: true } } },
      }),
      this.prisma.platformAuditLog.count({ where }),
      this.prisma.platformAuditLog.groupBy({
        by: ['action'],
        orderBy: { action: 'asc' },
      }),
    ]);
    const schoolIds = [
      ...new Set(rows.map((r) => r.schoolId).filter((s) => s !== null)),
    ];
    const schools = new Map(
      (
        await this.prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: { id: true, name: true, slug: true },
        })
      ).map((s) => [s.id, s]),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        createdAt: r.createdAt,
        details: r.details,
        admin: r.admin,
        schoolId: r.schoolId,
        school: r.schoolId ? (schools.get(r.schoolId) ?? null) : null,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      actions: actions.map((a) => a.action),
    };
  }

  @Get('reports')
  async reports() {
    const now = new Date();
    const months = monthKeys(now, 12);
    const since = startOfLocalDay(`${months[0]}-01`);
    const [subs, studentRows, paid, created, lastLogins, bills] =
      await Promise.all([
        this.prisma.subscription.findMany({
          include: {
            plan: true,
            school: {
              select: { id: true, name: true, slug: true, createdAt: true },
            },
          },
        }),
        this.prisma.student.groupBy({
          by: ['schoolId'],
          where: { status: StudentStatus.ACTIVE },
          _count: true,
        }),
        this.prisma.platformInvoice.findMany({
          where: { status: PlatformInvoiceStatus.PAID, paidAt: { gte: since } },
          select: { paidAt: true, amount: true },
        }),
        this.prisma.school.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true },
        }),
        this.prisma.user.groupBy({
          by: ['schoolId'],
          _max: { lastLoginAt: true },
        }),
        this.prisma.platformInvoice.findMany({
          where: {
            status: { not: PlatformInvoiceStatus.VOID },
            dueDate: { gte: new Date(now.getTime() - 120 * DAY) },
          },
          select: { schoolId: true, period: true, students: true },
        }),
      ]);
    const students = new Map(studentRows.map((r) => [r.schoolId, r._count]));
    const lastLogin = new Map(
      lastLogins.map((l) => [l.schoolId, l._max.lastLoginAt]),
    );

    let mrr = 0;
    const byStatus = Object.fromEntries(
      Object.values(SubscriptionStatus).map((s) => [s, 0]),
    ) as Record<SubscriptionStatus, number>;
    const byPlan = new Map<
      string,
      { planCode: string; planName: string; schools: number; mrr: number }
    >();
    for (const s of subs) {
      byStatus[s.status] += 1;
      const entry = byPlan.get(s.plan.code) ?? {
        planCode: s.plan.code,
        planName: s.plan.name,
        schools: 0,
        mrr: 0,
      };
      entry.schools += 1;
      if (
        s.status === SubscriptionStatus.ACTIVE ||
        s.status === SubscriptionStatus.PAST_DUE
      ) {
        const amount = monthlyAmount(s.plan, students.get(s.schoolId) ?? 0);
        mrr += amount;
        entry.mrr += amount;
      }
      byPlan.set(s.plan.code, entry);
    }

    // Churn risk: one row per school and reason.
    type Risk = 'past_due' | 'trial_ending' | 'inactive' | 'students_falling';
    const risks: {
      schoolId: string;
      name: string;
      slug: string;
      status: SubscriptionStatus;
      reason: Risk;
      detail: string;
    }[] = [];
    const soon = new Date(now.getTime() + 7 * DAY);
    const idleSince = new Date(now.getTime() - 14 * DAY);
    const falling = fallingStudents(bills);
    for (const s of subs) {
      if (s.status === SubscriptionStatus.CANCELLED) continue;
      const base = {
        schoolId: s.schoolId,
        name: s.school.name,
        slug: s.school.slug,
        status: s.status,
      };
      if (s.status === SubscriptionStatus.PAST_DUE)
        risks.push({ ...base, reason: 'past_due', detail: 'Bill overdue' });
      if (
        s.status === SubscriptionStatus.TRIAL &&
        s.trialEndsAt &&
        s.trialEndsAt >= now &&
        s.trialEndsAt <= soon
      ) {
        const days = Math.ceil((+s.trialEndsAt - +now) / DAY);
        risks.push({
          ...base,
          reason: 'trial_ending',
          detail: `Trial ends in ${days} day${days === 1 ? '' : 's'}`,
        });
      }
      const seen = lastLogin.get(s.schoolId);
      // A school set up in the last two weeks is not idle yet.
      if (
        s.status !== SubscriptionStatus.SUSPENDED &&
        s.school.createdAt < idleSince &&
        (!seen || seen < idleSince)
      )
        risks.push({
          ...base,
          reason: 'inactive',
          detail: seen
            ? `No sign-ins since ${localDate(seen)}`
            : 'Nobody has signed in yet',
        });
      const drop = falling.get(s.schoolId);
      if (drop)
        risks.push({
          ...base,
          reason: 'students_falling',
          detail: `Billed students fell from ${drop[0]} to ${drop[1]}`,
        });
    }

    return {
      generatedAt: now,
      mrr,
      students: [...students.values()].reduce((a, b) => a + b, 0),
      schools: subs.length,
      revenueByMonth: byMonth(
        months,
        paid.map((p) => ({ at: p.paidAt!, value: p.amount })),
      ).map(({ month, value }) => ({ month, amount: value })),
      newSchoolsByMonth: byMonth(
        months,
        created.map((c) => ({ at: c.createdAt })),
      ).map(({ month, value }) => ({ month, count: value })),
      schoolsByStatus: byStatus,
      schoolsByPlan: [...byPlan.values()].sort((a, b) => b.schools - a.schools),
      trialConversion: trialConversion(subs, now),
      churnRisk: risks,
    };
  }
}
