import { Controller, Get } from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import { ATTENDANCE_ROLES, campusScope, FEE_ROLES, hasAnyRole, STAFF_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { dayStart, daysBefore, localToday, startOfLocalDay } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TEACHING_ROLES: Role[] = [Role.TEACHER, Role.CLASS_TEACHER];

/** The `count` YYYY-MM periods ending with `period`, oldest first. */
function lastPeriods(period: string, count: number): string[] {
  const [y, m] = period.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

@Controller('dashboard')
@Permission('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Today's attendance, this month's fees and the admissions pipeline in one call,
   * plus the trends and lists the admin dashboard shows.
   */
  @Get('summary')
  @Roles(...STAFF_ROLES)
  async summary(@CurrentUser() user: AuthUser) {
    const schoolId = user.schoolId;
    const scope = campusScope(user);
    const campusFilter = scope ? { campusId: { in: scope } } : {};
    const todayIso = localToday();
    const today = dayStart(todayIso);
    const period = todayIso.slice(0, 7);
    const periods = lastPeriods(period, 6);
    const weekFrom = dayStart(daysBefore(todayIso, 20));
    // Per-payment rows and fee trends are for fee staff only; other staff get aggregates.
    const canFees = hasAnyRole(user, FEE_ROLES);
    const staffFilter = scope
      ? { OR: [{ campusId: null }, { campusId: { in: scope } }] }
      : {};

    const [
      students,
      newStudents,
      attendance,
      invoices,
      collectedToday,
      applications,
      overdue,
      trend,
      weekRecords,
      payments,
      exams,
      announcements,
      classes,
      staff,
      teachers,
      registers,
    ] = await Promise.all([
      this.prisma.student.count({ where: { schoolId, status: 'ACTIVE', ...campusFilter } }),
      this.prisma.student.count({
        where: { schoolId, status: 'ACTIVE', admittedOn: { gte: dayStart(`${period}-01`) }, ...campusFilter },
      }),
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
        where: { schoolId, receivedAt: { gte: startOfLocalDay(todayIso) }, invoice: { student: campusFilter } },
        _sum: { amount: true },
      }),
      this.prisma.application.groupBy({
        by: ['stage'],
        where: { schoolId, ...campusFilter },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: {
          schoolId,
          status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
          dueDate: { lt: today },
          student: campusFilter,
        },
        _sum: { total: true, paid: true },
        _count: true,
      }),
      this.prisma.invoice.groupBy({
        by: ['period'],
        where: { schoolId, period: { in: periods }, status: { not: InvoiceStatus.CANCELLED }, student: campusFilter },
        _sum: { total: true, paid: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { session: { schoolId, date: { gte: weekFrom, lte: today } }, student: campusFilter },
        select: { status: true, session: { select: { date: true } } },
      }),
      this.prisma.payment.findMany({
        where: { schoolId, invoice: { student: campusFilter } },
        // `take: 0` keeps the Promise.all tuple typed while skipping the rows for non-fee staff.
        orderBy: { receivedAt: 'desc' },
        take: canFees ? 5 : 0,
        select: {
          id: true,
          amount: true,
          method: true,
          receiptNo: true,
          receivedAt: true,
          invoice: {
            select: {
              id: true,
              period: true,
              status: true,
              student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
            },
          },
        },
      }),
      this.prisma.exam.findMany({
        where: { schoolId, OR: [{ endsOn: { gte: today } }, { endsOn: null, startsOn: { gte: today } }] },
        orderBy: [{ startsOn: 'asc' }],
        take: 4,
        select: { id: true, name: true, startsOn: true, endsOn: true, status: true },
      }),
      this.prisma.announcement.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: {
          id: true,
          title: true,
          body: true,
          audience: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      }),
      this.prisma.class.findMany({
        where: { schoolId, ...campusFilter },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          campusId: true,
          campus: { select: { name: true } },
          sections: {
            where: { academicYear: { isCurrent: true } },
            select: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
          },
        },
      }),
      this.prisma.user.count({
        where: { schoolId, isActive: true, roles: { some: { role: { in: STAFF_ROLES }, ...staffFilter } } },
      }),
      this.prisma.user.count({
        where: { schoolId, isActive: true, roles: { some: { role: { in: TEACHING_ROLES }, ...staffFilter } } },
      }),
      // Every class with pupils owes a register today; whether it is in says how much of the school today's rate covers.
      this.prisma.section.findMany({
        where: {
          schoolId,
          academicYear: { isCurrent: true },
          enrollments: { some: { status: 'ACTIVE' } },
          ...(scope ? { class: { campusId: { in: scope } } } : {}),
        },
        select: { id: true, attendanceSessions: { where: { date: today }, select: { id: true } } },
      }),
    ]);
    const topDefaulters = canFees ? await this.topDefaulters(schoolId, campusFilter) : [];

    const count = (s: string) => attendance.find((a) => a.status === s)?._count ?? 0;
    const marked = attendance.reduce((n, a) => n + a._count, 0);

    // The last 7 days that had any attendance taken, oldest first.
    const byDay = new Map<string, { present: number; late: number; absent: number; leave: number; marked: number }>();
    for (const r of weekRecords) {
      const key = r.session.date.toISOString().slice(0, 10);
      const d = byDay.get(key) ?? { present: 0, late: 0, absent: 0, leave: 0, marked: 0 };
      d.marked += 1;
      if (r.status === 'PRESENT') d.present += 1;
      else if (r.status === 'LATE') d.late += 1;
      else if (r.status === 'ABSENT') d.absent += 1;
      else d.leave += 1;
      byDay.set(key, d);
    }
    const attendanceWeek = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, d]) => ({
        date,
        ...d,
        rate: d.marked ? Math.round(((d.present + d.late) / d.marked) * 1000) / 10 : 0,
      }));

    const multiCampus = new Set(classes.map((c) => c.campusId)).size > 1;
    const billed = invoices._sum.total ?? 0;
    const collected = invoices._sum.paid ?? 0;

    return {
      students,
      newStudentsThisMonth: newStudents,
      staff,
      teachers,
      attendanceToday: {
        marked,
        present: count('PRESENT') + count('LATE'),
        absent: count('ABSENT'),
        leave: count('LEAVE'),
        late: count('LATE'),
        registersTotal: registers.length,
        registersTaken: registers.filter((s) => s.attendanceSessions.length > 0).length,
      },
      attendanceWeek,
      feesThisMonth: {
        period,
        invoices: invoices._count,
        billed,
        collected,
        outstanding: Math.max(0, billed - collected),
        collectedToday: collectedToday._sum.amount ?? 0,
      },
      overdue: canFees
        ? {
            invoices: overdue._count,
            amount: Math.max(0, (overdue._sum.total ?? 0) - (overdue._sum.paid ?? 0)),
          }
        : { invoices: 0, amount: 0 },
      collectionTrend: canFees
        ? periods.map((p) => {
            const row = trend.find((t) => t.period === p);
            return { period: p, billed: row?._sum.total ?? 0, collected: row?._sum.paid ?? 0 };
          })
        : [],
      recentPayments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        receiptNo: p.receiptNo,
        receivedAt: p.receivedAt,
        invoiceId: p.invoice.id,
        period: p.invoice.period,
        invoiceStatus: p.invoice.status,
        student: p.invoice.student,
      })),
      topDefaulters,
      upcomingExams: exams,
      announcements: announcements.map((a) => ({ ...a, createdBy: a.createdBy?.name ?? null })),
      studentsByClass: classes
        .map((c) => ({
          id: c.id,
          // Class names repeat across campuses ("Grade 1" at each), so say which one.
          name: multiCampus ? `${c.name} (${c.campus.name})` : c.name,
          students: c.sections.reduce((n, s) => n + s._count.enrollments, 0),
        }))
        .filter((c) => c.students > 0),
      admissions: Object.fromEntries(applications.map((a) => [a.stage, a._count])),
    };
  }

  /**
   * The five students who owe the most across every open voucher, for the
   * dashboard's defaulters card. Same open-invoice rule as /fees/defaulters,
   * but summed per student rather than listed per voucher.
   */
  private async topDefaulters(schoolId: string, campusFilter: { campusId?: { in: string[] } }) {
    const byStudent = await this.prisma.invoice.groupBy({
      by: ['studentId'],
      where: {
        schoolId,
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
        student: campusFilter,
      },
      _sum: { total: true, paid: true },
      _count: true,
    });
    const top = byStudent
      .map((r) => ({
        studentId: r.studentId,
        balance: Math.max(0, (r._sum.total ?? 0) - (r._sum.paid ?? 0)),
        monthsOwed: r._count,
      }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);
    if (!top.length) return [];

    const students = await this.prisma.student.findMany({
      where: { id: { in: top.map((r) => r.studentId) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: { section: { select: { name: true, class: { select: { name: true } } } } },
        },
      },
    });
    return top.flatMap((r) => {
      const student = students.find((s) => s.id === r.studentId);
      if (!student) return [];
      const enrolment = student.enrollments[0];
      return [
        {
          ...r,
          name: [student.firstName, student.lastName].filter(Boolean).join(' '),
          admissionNo: student.admissionNo,
          className: enrolment ? `${enrolment.section.class.name} ${enrolment.section.name}` : null,
        },
      ];
    });
  }

  /** A teacher's day: the sections they teach (and whether today's register is in) and homework coming due. */
  @Get('teacher')
  @Roles(...ATTENDANCE_ROLES)
  async teacher(@CurrentUser() user: AuthUser) {
    const todayIso = localToday();
    const today = dayStart(todayIso);
    const mine = {
      schoolId: user.schoolId,
      academicYear: { isCurrent: true },
      OR: [{ classTeacherId: user.sub }, { subjects: { some: { teacherId: user.sub } } }],
    };
    const sections = await this.prisma.section.findMany({
      where: mine,
      include: {
        class: { select: { name: true, sortOrder: true } },
        subjects: { where: { teacherId: user.sub }, select: { subject: { select: { id: true, name: true } } } },
        attendanceSessions: { where: { date: today }, select: { id: true } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });
    const ids = sections.map((s) => s.id);
    const homework = ids.length
      ? await this.prisma.homework.findMany({
          where: { sectionId: { in: ids }, dueDate: { gte: today } },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          take: 8,
          include: {
            subject: { select: { name: true } },
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        })
      : [];

    return {
      date: todayIso,
      sections: sections
        .sort((a, b) => a.class.sortOrder - b.class.sortOrder || a.name.localeCompare(b.name))
        .map((s) => ({
          id: s.id,
          name: `${s.class.name} ${s.name}`,
          students: s._count.enrollments,
          isClassTeacher: s.classTeacherId === user.sub,
          mySubjects: s.subjects.map((x) => x.subject),
          attendanceTaken: s.attendanceSessions.length > 0,
        })),
      homeworkDue: homework.map((h) => ({
        id: h.id,
        title: h.title,
        dueDate: h.dueDate.toISOString().slice(0, 10),
        subject: h.subject.name,
        section: `${h.section.class.name} ${h.section.name}`,
        sectionId: h.sectionId,
        mine: h.assignedById === user.sub,
      })),
    };
  }
}
