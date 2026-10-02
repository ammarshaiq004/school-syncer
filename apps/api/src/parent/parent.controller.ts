import { Controller, Get } from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('parent')
@Roles(Role.PARENT)
export class ParentController {
  constructor(private readonly prisma: PrismaService) {}

  /** A parent's children with this month's attendance and any unpaid fees. */
  @Get('children')
  async children(@CurrentUser() user: AuthUser) {
    const monthStart = new Date(new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z');
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId: user.sub },
      include: {
        students: {
          include: {
            student: {
              include: {
                enrollments: {
                  where: { status: 'ACTIVE' },
                  include: { section: { select: { name: true, class: { select: { name: true } } } } },
                },
                attendance: {
                  where: { session: { date: { gte: monthStart } } },
                  select: { status: true, session: { select: { date: true } } },
                },
                invoices: {
                  where: { status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] } },
                  orderBy: { period: 'desc' },
                },
              },
            },
          },
        },
      },
    });
    if (!guardian) return [];
    return guardian.students.map(({ student, relation }) => ({
      id: student.id,
      name: [student.firstName, student.lastName].filter(Boolean).join(' '),
      relation,
      admissionNo: student.admissionNo,
      class: student.enrollments[0]
        ? `${student.enrollments[0].section.class.name} ${student.enrollments[0].section.name}`
        : null,
      attendanceThisMonth: {
        present: student.attendance.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length,
        absent: student.attendance.filter((a) => a.status === 'ABSENT').length,
        leave: student.attendance.filter((a) => a.status === 'LEAVE').length,
        absentDates: student.attendance
          .filter((a) => a.status === 'ABSENT')
          .map((a) => a.session.date.toISOString().slice(0, 10)),
      },
      unpaidInvoices: student.invoices.map((i) => ({
        id: i.id,
        voucherNo: i.voucherNo,
        period: i.period,
        dueDate: i.dueDate,
        balance: i.total - i.paid,
      })),
    }));
  }
}
