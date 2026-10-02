import { Controller, Get } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { campusScope, STAFF_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  /** Today's attendance, this month's fees and the admissions pipeline in one call. */
  @Get('summary')
  @Roles(...STAFF_ROLES)
  async summary(@CurrentUser() user: AuthUser) {
    const schoolId = user.schoolId;
    const scope = campusScope(user);
    const campusFilter = scope ? { campusId: { in: scope } } : {};
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const period = today.toISOString().slice(0, 7);

    const [students, attendance, invoices, collectedToday, applications] = await Promise.all([
      this.prisma.student.count({ where: { schoolId, status: 'ACTIVE', ...campusFilter } }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { session: { schoolId, date: today }, student: campusFilter },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: { schoolId, period, status: { not: InvoiceStatus.CANCELLED }, student: campusFilter },
        _sum: { total: true, paid: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { schoolId, receivedAt: { gte: today }, invoice: { student: campusFilter } },
        _sum: { amount: true },
      }),
      this.prisma.application.groupBy({
        by: ['stage'],
        where: { schoolId, ...campusFilter },
        _count: true,
      }),
    ]);

    const count = (s: string) => attendance.find((a) => a.status === s)?._count ?? 0;
    const marked = attendance.reduce((n, a) => n + a._count, 0);
    return {
      students,
      attendanceToday: {
        marked,
        present: count('PRESENT') + count('LATE'),
        absent: count('ABSENT'),
        leave: count('LEAVE'),
      },
      feesThisMonth: {
        period,
        invoices: invoices._count,
        billed: invoices._sum.total ?? 0,
        collected: invoices._sum.paid ?? 0,
        collectedToday: collectedToday._sum.amount ?? 0,
      },
      admissions: Object.fromEntries(applications.map((a) => [a.stage, a._count])),
    };
  }
}
