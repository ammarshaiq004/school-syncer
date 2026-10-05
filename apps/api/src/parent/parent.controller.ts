import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import type { SubjectResult } from '../exams/result-calculator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { learningSummary } from '../student/learning-summary.js';

@Controller('parent')
@Permission('students')
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
        // The per-subject marks let the dashboard name what failed, not just "not passed".
        subjects: r.subjects as unknown as SubjectResult[],
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

  /**
   * One child's e-school picture: course progress, upcoming live classes and
   * live attendance, assignments with status and points, and quiz scores.
   */
  @Get('children/:studentId/learning')
  @Permission('elearning')
  @RequiresFeature('elearning')
  async learning(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    // Only a guardian linked to this child (in this school) gets past here.
    const link = await this.prisma.studentGuardian.findFirst({
      where: { studentId, guardian: { userId: user.sub }, student: { schoolId: user.schoolId } },
      select: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              orderBy: [{ academicYear: { isCurrent: 'desc' } }, { createdAt: 'desc' }],
              take: 1,
              select: { sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } },
            },
          },
        },
      },
    });
    if (!link) throw new NotFoundException('Child not found');
    const { student } = link;
    const enrollment = student.enrollments[0];
    const summary = await learningSummary(this.prisma, {
      id: student.id,
      schoolId: user.schoolId,
      sectionId: enrollment?.sectionId ?? null,
    });
    return {
      student: {
        id: student.id,
        name: [student.firstName, student.lastName].filter(Boolean).join(' '),
        class: enrollment ? `${enrollment.section.class.name} ${enrollment.section.name}` : null,
      },
      ...summary,
    };
  }
}
