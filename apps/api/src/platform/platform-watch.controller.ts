import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { PlatformOnly } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { schoolHealth, HEALTH_WINDOW_DAYS, type HealthSnapshot } from './health.js';
import { PlatformAccessGuard } from './platform-access.guard.js';
import { retention } from './reports.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** What the console shows about how schools use SchoolSyncer, from the nightly snapshots. */
@Controller('platform')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformWatchController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every school that is not cancelled, with its health score. */
  @Get('school-health')
  async schoolHealth() {
    const now = new Date();
    const since = daysBefore(localToday(), HEALTH_WINDOW_DAYS);
    const [subs, snaps] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: { not: SubscriptionStatus.CANCELLED } },
        select: { schoolId: true, status: true, school: { select: { name: true, slug: true, createdAt: true } } },
      }),
      this.prisma.schoolUsageSnapshot.findMany({
        where: { day: { gte: dayStart(since) } },
        select: { schoolId: true, day: true, students: true, attendanceSessions: true, staffActive7d: true },
      }),
    ]);
    const bySchool = new Map<string, HealthSnapshot[]>();
    for (const s of snaps) bySchool.set(s.schoolId, [...(bySchool.get(s.schoolId) ?? []), { ...s, day: iso(s.day) }]);
    return subs.map((s) => ({
      schoolId: s.schoolId,
      name: s.school.name,
      slug: s.school.slug,
      status: s.status,
      ...schoolHealth({ status: s.status, createdAt: s.school.createdAt, now, snapshots: bySchool.get(s.schoolId) ?? [] }),
    }));
  }

  /** One school's daily history, oldest first, and its health. */
  @Get('schools/:id/usage')
  async usage(@Param('id') id: string, @Query('days') daysParam?: string) {
    const days = Math.min(365, Math.max(7, Math.floor(Number(daysParam)) || 90));
    const today = localToday();
    const sub = await this.prisma.subscription.findUnique({
      where: { schoolId: id },
      select: { status: true, school: { select: { createdAt: true } } },
    });
    if (!sub) throw new NotFoundException('School not found');
    const rows = await this.prisma.schoolUsageSnapshot.findMany({
      where: { schoolId: id, day: { gte: dayStart(daysBefore(today, days - 1)) } },
      orderBy: { day: 'asc' },
    });
    const snapshots = rows.map(({ id: _id, schoolId: _s, createdAt: _c, day, storageBytes, ...rest }) => ({
      ...rest,
      day: iso(day),
      storageBytes: Number(storageBytes),
    }));
    const health = schoolHealth({
      status: sub.status,
      createdAt: sub.school.createdAt,
      now: new Date(),
      snapshots: snapshots.filter((s) => s.day >= daysBefore(today, HEALTH_WINDOW_DAYS)),
    });
    return { health, snapshots };
  }

  /** Monthly recurring revenue, students, churn and net revenue retention as they stood on the last snapshot of each of the last 12 months. */
  @Get('reports/history')
  async history() {
    const since = dayStart(daysBefore(localToday(), 366));
    const days = await this.prisma.schoolUsageSnapshot.groupBy({
      by: ['day'],
      where: { day: { gte: since } },
      _sum: { mrr: true, students: true },
      _count: true,
      orderBy: { day: 'asc' },
    });
    const lastOfMonth = new Map<string, (typeof days)[number]>();
    for (const d of days) lastOfMonth.set(iso(d.day).slice(0, 7), d);
    const months = [...lastOfMonth];
    // Churn and retention compare each month's last snapshot with the month before's.
    const rows = await this.prisma.schoolUsageSnapshot.findMany({
      where: { day: { in: months.map(([, d]) => d.day) } },
      select: { schoolId: true, day: true, mrr: true },
    });
    const at = (day: Date) => rows.filter((r) => +r.day === +day);
    return months.slice(-12).map(([month, d]) => {
      const before = months[months.findIndex(([m]) => m === month) - 1]?.[1];
      return {
        month,
        day: iso(d.day),
        mrr: d._sum.mrr ?? 0,
        students: d._sum.students ?? 0,
        schools: d._count,
        ...(before ? retention(at(before.day), at(d.day)) : { payingAtStart: 0, churned: 0, churnRate: null, nrr: null }),
      };
    });
  }
}
