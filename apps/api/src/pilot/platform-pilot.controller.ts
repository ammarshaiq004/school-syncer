import { BadRequestException, Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { dateRange, nextDay } from '../common/date-range.js';
import { dayStart, startOfLocalDay } from '../common/dates.js';
import { PlatformOnly } from '../common/decorators.js';
import { PlatformAccessGuard } from '../platform/platform-access.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { attendanceCoverage, dailyActive, eachDay, latest } from './pilot-health.js';
import { OPEN_STATUSES } from './problem-reports.js';

const MAX_DAYS = 93;

/**
 * Pilot health (SCHOOL-150): how much one school really used SchoolSyncer
 * over a date range, so the console can tell a pilot month that is running
 * from one that has quietly stopped.
 */
@Controller('platform/schools')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformPilotController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/pilot-health')
  async health(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const days = eachDay(r.from, r.to);
    if (days.length > MAX_DAYS) throw new BadRequestException(`Choose at most ${MAX_DAYS} days`);
    const school = await this.prisma.school.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
    if (!school) throw new NotFoundException('School not found');

    const schoolId = id;
    const dates = { gte: dayStart(r.from), lte: dayStart(r.to) };
    const instants = { gte: startOfLocalDay(r.from), lt: startOfLocalDay(nextDay(r.to)) };
    const [
      activity,
      sections,
      sessions,
      vouchers,
      voidedVouchers,
      runs,
      payments,
      reversed,
      messages,
      openReports,
      reportsInRange,
      lastSeen,
      lastLogin,
      lastAttendance,
      lastPayment,
      lastVoucher,
    ] = await Promise.all([
      this.prisma.userActivityDay.findMany({ where: { schoolId, date: dates }, select: { date: true, roles: true } }),
      this.prisma.section.findMany({
        where: {
          schoolId,
          OR: [{ academicYear: { isCurrent: true } }, { attendanceSessions: { some: { date: dates } } }],
        },
        select: { id: true, name: true, class: { select: { name: true, sortOrder: true, campus: { select: { name: true } } } } },
      }),
      this.prisma.attendanceSession.findMany({ where: { schoolId, date: dates }, select: { sectionId: true, date: true } }),
      this.prisma.invoice.count({ where: { schoolId, createdAt: instants } }),
      this.prisma.invoice.count({ where: { schoolId, createdAt: instants, status: 'CANCELLED' } }),
      this.prisma.voucherRun.count({ where: { schoolId, startedAt: instants, status: 'DONE' } }),
      this.prisma.payment.aggregate({
        where: { schoolId, receivedAt: instants, reversedAt: null },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.payment.count({ where: { schoolId, receivedAt: instants, reversedAt: { not: null } } }),
      this.prisma.notificationLog.groupBy({ by: ['status'], where: { schoolId, createdAt: instants }, _count: true }),
      this.prisma.problemReport.findMany({
        where: { schoolId, status: { in: OPEN_STATUSES } },
        select: { id: true, message: true, page: true, status: true, reporterName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.problemReport.count({ where: { schoolId, createdAt: instants } }),
      this.prisma.userActivityDay.aggregate({ where: { schoolId }, _max: { date: true } }),
      this.prisma.user.aggregate({ where: { schoolId }, _max: { lastLoginAt: true } }),
      this.prisma.attendanceSession.aggregate({ where: { schoolId }, _max: { takenAt: true } }),
      this.prisma.payment.aggregate({ where: { schoolId }, _max: { receivedAt: true } }),
      this.prisma.invoice.aggregate({ where: { schoolId }, _max: { createdAt: true } }),
    ]);

    const multiCampus = new Set(sections.map((s) => s.class.campus.name)).size > 1;
    const sent = Object.fromEntries(Object.values(NotificationStatus).map((s) => [s, 0])) as Record<NotificationStatus, number>;
    for (const m of messages) sent[m.status] = m._count;
    const lastUsed = {
      signIn: lastLogin._max.lastLoginAt,
      appUse: lastSeen._max.date,
      attendance: lastAttendance._max.takenAt,
      payment: lastPayment._max.receivedAt,
      voucher: lastVoucher._max.createdAt,
    };
    return {
      ...r,
      school,
      activeUsers: dailyActive(
        activity.map((a) => ({ date: a.date.toISOString().slice(0, 10), roles: a.roles })),
        days,
      ),
      attendance: attendanceCoverage(
        sections.map((s) => ({
          id: s.id,
          name: `${s.class.name} ${s.name}${multiCampus ? `, ${s.class.campus.name}` : ''}`,
          sort: s.class.sortOrder,
        })),
        sessions.map((s) => ({ sectionId: s.sectionId, date: s.date.toISOString().slice(0, 10) })),
      ),
      vouchers: { generated: vouchers, voided: voidedVouchers, runs },
      payments: { recorded: payments._count, amount: payments._sum.amount ?? 0, reversed },
      messages: { ...sent, total: Object.values(sent).reduce((a, b) => a + b, 0) },
      problemReports: { open: openReports.length, inRange: reportsInRange, latestOpen: openReports.slice(0, 5) },
      lastActivity: { at: latest(...Object.values(lastUsed)), ...lastUsed },
    };
  }
}
