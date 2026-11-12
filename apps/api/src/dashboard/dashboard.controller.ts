import { Controller, Get } from '@nestjs/common';
import { InvoiceStatus, Prisma, Role } from '@prisma/client';
import { ATTENDANCE_ROLES, campusScope, FEE_ROLES, hasAnyRole, STAFF_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { dayStart, daysBefore, localToday, SCHOOL_TIMEZONE, startOfLocalDay } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { billedOf, feeOutstanding } from '../fees/outstanding.js';
import { ageOn, challanCounts, genderCounts, monthsOwed, teachingDesignationWhere } from './dashboard-rules.js';

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
    const lastMonth = periods[periods.length - 2];
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
      owed,
      trend,
      weekRecords,
      payments,
      exams,
      announcements,
      classes,
      staff,
      teachers,
      registers,
      genders,
      withdrawals,
      birthdays,
      challanRows,
      cashByMonth,
      staffNoDesignation,
      expenseRows,
      complaintsOpen,
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
        _sum: { total: true, paid: true, arrears: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { schoolId, receivedAt: { gte: startOfLocalDay(todayIso) }, reversedAt: null, invoice: { student: campusFilter } },
        _sum: { amount: true },
      }),
      this.prisma.application.groupBy({
        by: ['stage'],
        where: { schoolId, ...campusFilter },
        _count: true,
      }),
      // The shared outstanding calculation, as /fees/outstanding and the defaulters list use.
      feeOutstanding(this.prisma, { schoolId, student: campusFilter }, todayIso, true),
      this.prisma.invoice.groupBy({
        by: ['period'],
        where: { schoolId, period: { in: periods }, status: { not: InvoiceStatus.CANCELLED }, student: campusFilter },
        _sum: { total: true, paid: true, arrears: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { session: { schoolId, date: { gte: weekFrom, lte: today } }, student: campusFilter },
        select: { status: true, session: { select: { date: true } } },
      }),
      this.prisma.payment.findMany({
        where: { schoolId, reversedAt: null, invoice: { student: campusFilter } },
        // `take: 0` keeps the Promise.all tuple typed while skipping the rows for non-fee staff.
        orderBy: { receivedAt: 'desc' },
        take: canFees ? 5 : 0,
        select: {
          id: true,
          amount: true,
          method: true,
          receiptNo: true,
          receivedAt: true,
          receivedBy: { select: { name: true } },
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
      // Teaching staff by role, or by a designation like "Teacher" (schools that only filled in designations).
      this.prisma.user.count({
        where: {
          schoolId,
          isActive: true,
          roles: { some: { role: { in: STAFF_ROLES }, ...staffFilter } },
          OR: [{ roles: { some: { role: { in: TEACHING_ROLES }, ...staffFilter } } }, ...teachingDesignationWhere()],
        },
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
      this.prisma.student.groupBy({ by: ['gender'], where: { schoolId, status: 'ACTIVE', ...campusFilter }, _count: true }),
      // Left this month: needs the real leaving date, not the day the record was edited.
      this.prisma.student.count({
        where: { schoolId, status: 'LEFT', leftOn: { gte: dayStart(`${period}-01`), lte: today }, ...campusFilter },
      }),
      this.prisma.$queryRaw<{ id: string; firstName: string; lastName: string | null; admissionNo: string; dateOfBirth: string }[]>(Prisma.sql`
        SELECT id, "firstName", "lastName", "admissionNo", "dateOfBirth"::text AS "dateOfBirth" FROM "Student"
        WHERE "schoolId" = ${schoolId} AND status = 'ACTIVE' AND "dateOfBirth" IS NOT NULL
          AND to_char("dateOfBirth", 'MM-DD') = ${todayIso.slice(5)}
          ${scope ? Prisma.sql`AND "campusId" = ANY(${scope})` : Prisma.empty}
        ORDER BY "firstName" LIMIT 12`),
      // This month's vouchers plus every older voucher still owing, per student and month.
      canFees
        ? this.prisma.invoice.groupBy({
            by: ['studentId', 'period'],
            where: {
              schoolId,
              student: campusFilter,
              status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.CARRIED_FORWARD] },
              OR: [{ period }, { status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] } }],
            },
            _sum: { total: true, paid: true },
          })
        : [],
      // Cash by the month it was received, so back-dated receipts fill the history.
      canFees
        ? this.prisma.$queryRaw<{ period: string; amount: number }[]>(Prisma.sql`
            SELECT to_char((p."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${SCHOOL_TIMEZONE}, 'YYYY-MM') AS period, SUM(p.amount)::int AS amount
            FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId" JOIN "Student" st ON st.id = i."studentId"
            WHERE p."schoolId" = ${schoolId} AND p."reversedAt" IS NULL AND p."receivedAt" >= ${startOfLocalDay(`${periods[0]}-01`)}
              ${scope ? Prisma.sql`AND st."campusId" = ANY(${scope})` : Prisma.empty}
            GROUP BY 1`)
        : [],
      this.prisma.user.count({
        where: { schoolId, isActive: true, roles: { some: { role: { in: STAFF_ROLES }, ...staffFilter } }, staffProfile: { is: null } },
      }),
      // Spending this month and last, from the Accounts ledger.
      canFees
        ? this.prisma.accountEntry.groupBy({
            by: ['date'],
            where: { schoolId, kind: 'EXPENSE', date: { gte: dayStart(`${lastMonth}-01`), lte: today }, ...(scope ? { OR: [{ campusId: null }, { campusId: { in: scope } }] } : {}) },
            _sum: { amount: true },
          })
        : [],
      this.prisma.complaint.count({ where: { schoolId, status: 'OPEN', ...campusFilter } }),
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
    // Balances carried onto this month's vouchers were billed in their own month.
    const billed = billedOf(invoices._sum);
    const collected = invoices._sum.paid ?? 0;
    const monthOwed = canFees
      ? await feeOutstanding(this.prisma, { schoolId, period, student: campusFilter }, todayIso)
      : null;

    return {
      students,
      newStudentsThisMonth: newStudents,
      withdrawalsThisMonth: withdrawals,
      genderSplit: genderCounts(genders.map((g) => ({ gender: g.gender, _count: g._count }))),
      birthdaysToday: birthdays.map((b) => ({
        id: b.id,
        name: [b.firstName, b.lastName].filter(Boolean).join(' '),
        admissionNo: b.admissionNo,
        turns: ageOn(b.dateOfBirth, todayIso),
      })),
      challans: canFees ? { period, ...challanCounts(challanRows.map((r) => ({ studentId: r.studentId, period: r.period, total: r._sum.total ?? 0, paid: r._sum.paid ?? 0 })), period) } : null,
      staff,
      teachers,
      staffWithoutDesignation: staffNoDesignation,
      complaintsOpen,
      expenses: canFees
        ? {
            thisMonth: expenseRows.filter((e) => e.date.toISOString().slice(0, 7) === period).reduce((n, e) => n + (e._sum.amount ?? 0), 0),
            lastMonth: expenseRows.filter((e) => e.date.toISOString().slice(0, 7) === lastMonth).reduce((n, e) => n + (e._sum.amount ?? 0), 0),
          }
        : null,
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
        // This month's vouchers still owing (all open vouchers are in `outstanding` below).
        outstanding: monthOwed ? monthOwed.outstanding.amount : Math.max(0, billed - collected),
        collectedToday: collectedToday._sum.amount ?? 0,
      },
      overdue: canFees ? owed.overdue : { invoices: 0, amount: 0 },
      outstanding: canFees ? owed.outstanding : { invoices: 0, amount: 0 },
      collectionTrend: canFees
        ? periods.map((p) => {
            const row = trend.find((t) => t.period === p);
            return { period: p, billed: row ? billedOf(row._sum) : 0, collected: cashByMonth.find((c) => c.period === p)?.amount ?? 0 };
          })
        : [],
      recentPayments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        receiptNo: p.receiptNo,
        receivedAt: p.receivedAt,
        receivedBy: p.receivedBy?.name ?? null,
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
    const ranked = byStudent
      .map((r) => ({
        studentId: r.studentId,
        balance: Math.max(0, (r._sum.total ?? 0) - (r._sum.paid ?? 0)),
        vouchers: r._count,
      }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);
    if (!ranked.length) return [];
    // Months owed come from the balance and the monthly fee, since arrears often sit on a single voucher.
    const [monthly, months] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { schoolId, studentId: { in: ranked.map((r) => r.studentId) }, kind: 'MONTHLY', status: { not: InvoiceStatus.CANCELLED } },
        orderBy: { period: 'desc' },
        select: { studentId: true, total: true, arrears: true, fineBooked: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['studentId', 'period'],
        where: { schoolId, studentId: { in: ranked.map((r) => r.studentId) }, status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] } },
      }),
    ]);
    const top = ranked.map((r) => {
      const latest = monthly.find((m) => m.studentId === r.studentId);
      const fee = latest ? latest.total - latest.arrears - latest.fineBooked : 0;
      const openMonths = months.filter((m) => m.studentId === r.studentId).length;
      return { studentId: r.studentId, balance: r.balance, monthsOwed: monthsOwed(r.balance, fee, openMonths) };
    });

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
