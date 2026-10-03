import { Controller, Get } from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('parent')
@Roles(Role.PARENT)
export class ParentController {
  constructor(private readonly prisma: PrismaService) {}

  /** A parent's children with this month's attendance, homework, published results and any unpaid fees. */
  @Get('children')
  async children(@CurrentUser() user: AuthUser) {
    const monthStart = dayStart(`${localToday().slice(0, 7)}-01`);
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId: user.sub },
      include: {
        students: {
          include: {
            student: {
              include: {
                enrollments: {
                  where: { status: 'ACTIVE' },
                  include: {
                    section: {
                      select: {
                        name: true,
                        class: { select: { name: true } },
                        // Homework due from yesterday on, so today's and tomorrow's work is always there.
                        homework: {
                          where: { dueDate: { gte: dayStart(daysBefore(localToday(), 1)) } },
                          orderBy: { dueDate: 'asc' },
                          include: { subject: { select: { name: true } } },
                        },
                      },
                    },
                  },
                },
                attendance: {
                  where: { session: { date: { gte: monthStart } } },
                  select: { status: true, session: { select: { date: true } } },
                },
                examResults: {
                  where: { exam: { status: 'PUBLISHED' } },
                  include: { exam: { select: { name: true, publishedAt: true } } },
                  orderBy: { exam: { publishedAt: 'desc' } },
                },
                invoices: {
                  where: { status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] } },
                  orderBy: { period: 'desc' },
                },
                bookLoans: {
                  where: { OR: [{ returnedOn: null }, { fineStatus: 'DUE' }] },
                  include: { copy: { select: { book: { select: { title: true } } } } },
                  orderBy: { dueOn: 'asc' },
                },
                transport: {
                  where: { endsOn: null },
                  include: { route: { include: { vehicle: true } }, stop: true },
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
      homework: (student.enrollments[0]?.section.homework ?? []).map((h) => ({
        id: h.id,
        subject: h.subject.name,
        title: h.title,
        details: h.details,
        dueDate: h.dueDate.toISOString().slice(0, 10),
      })),
      results: student.examResults.map((r) => ({
        examId: r.examId,
        exam: r.exam.name,
        percent: r.percent,
        grade: r.grade,
        position: r.position,
        passed: r.passed,
      })),
      transport: student.transport[0]
        ? {
            route: student.transport[0].route.name,
            stop: student.transport[0].stop?.name ?? null,
            pickupTime: student.transport[0].stop?.pickupTime ?? null,
            dropTime: student.transport[0].stop?.dropTime ?? null,
            vehicle: student.transport[0].route.vehicle?.registrationNo ?? null,
            driverName: student.transport[0].route.vehicle?.driverName ?? null,
            driverPhone: student.transport[0].route.vehicle?.driverPhone ?? null,
          }
        : null,
      libraryBooks: student.bookLoans.map((l) => ({
        title: l.copy.book.title,
        dueOn: l.dueOn.toISOString().slice(0, 10),
        returned: l.returnedOn !== null,
        overdue: l.returnedOn === null && l.dueOn < dayStart(localToday()),
        fine: l.fineStatus === 'DUE' ? l.fine : 0,
      })),
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
