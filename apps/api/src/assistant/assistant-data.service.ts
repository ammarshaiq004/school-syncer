import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, ExamStatus, InvoiceStatus, Prisma, Role, StudentStatus } from '@prisma/client';
import { campusScope, FEE_ROLES, hasAnyRole, SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { PermissionService } from '../common/permission.service.js';
import { moduleLabel, satisfies, type PermissionMatrix, type PermissionModule } from '../common/permissions.js';
import { studentSearchWhere } from '../common/student-search.js';
import { billedOf, feeOutstanding } from '../fees/outstanding.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { DraftFacts } from './draft-rules.js';
import { attendancePercent, riskFlags, riskLevel, riskScore, type RiskFlag, type RiskInput } from './risk-rules.js';

/**
 * What one signed-in user may see through the assistant. School-wide roles
 * (owner, principal, admin, accountant) see every student in their campus
 * scope; teachers see the students of the sections they teach this year.
 * Each area also needs the role's permission level for its module.
 */
export interface Reach {
  user: AuthUser;
  wide: boolean;
  campuses: string[] | null;
  /** Current-year sections in reach. */
  sectionIds: string[];
  perms: PermissionMatrix;
  canFees: boolean;
}

/** Ages of the windows the assistant reports on. */
const ATTENDANCE_DAYS = 30;
const RISK_LIMIT = 200;

const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

interface SubjectRow {
  subject: string;
  max: number;
  marks: number | null;
  absent: boolean;
  passed: boolean;
}

interface RecentResult {
  exam: string;
  percent: number;
  grade: string;
  position: number;
  passed: boolean;
  subjects: SubjectRow[];
  teacherRemark: string | null;
}

const subjectRows = (json: Prisma.JsonValue): SubjectRow[] =>
  Array.isArray(json) ? (json as unknown as SubjectRow[]).filter((r) => r && typeof r.subject === 'string') : [];

/**
 * Read-only school data for the assistant: the tools Claude calls, the
 * at-risk list and the facts a draft is written from. Every query is fenced
 * by schoolId and by the caller's Reach, so the model can only ever see what
 * the user could already open in the app.
 */
@Injectable()
export class AssistantData {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async reach(user: AuthUser): Promise<Reach> {
    const campuses = campusScope(user);
    const wide = hasAnyRole(user, [...SETUP_ROLES, Role.ACCOUNTANT]);
    const perms = await this.permissions.permissionsFor(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYear: { isCurrent: true },
        ...(campuses ? { class: { campusId: { in: campuses } } } : {}),
        ...(wide ? {} : { OR: [{ classTeacherId: user.sub }, { subjects: { some: { teacherId: user.sub } } }] }),
      },
      select: { id: true },
    });
    return {
      user,
      wide,
      campuses,
      sectionIds: sections.map((s) => s.id),
      perms,
      canFees: hasAnyRole(user, FEE_ROLES) && satisfies(perms.fees, 'view'),
    };
  }

  can(reach: Reach, module: PermissionModule): boolean {
    return satisfies(reach.perms[module], 'view');
  }

  require(reach: Reach, module: PermissionModule) {
    if (!this.can(reach, module))
      throw new ForbiddenException(`Your role does not have access to ${moduleLabel(module)}`);
  }

  /** Active students in reach. */
  studentWhere(reach: Reach, extra: Prisma.StudentWhereInput = {}): Prisma.StudentWhereInput {
    const base: Prisma.StudentWhereInput = { schoolId: reach.user.schoolId, status: StudentStatus.ACTIVE };
    const fence: Prisma.StudentWhereInput = reach.wide
      ? reach.campuses
        ? { campusId: { in: reach.campuses } }
        : {}
      : { enrollments: { some: { sectionId: { in: reach.sectionIds }, status: 'ACTIVE' } } };
    return { AND: [base, fence, extra] };
  }

  sectionFilter(reach: Reach, sectionId?: string): string[] {
    if (!sectionId) return reach.sectionIds;
    if (!reach.sectionIds.includes(sectionId)) throw new NotFoundException('Section not found');
    return [sectionId];
  }

  /** The student, if in reach; 404 otherwise so ids cannot be probed. */
  async student(reach: Reach, studentId: string) {
    const s = await this.prisma.student.findFirst({
      where: this.studentWhere(reach, { id: studentId }),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        gender: true,
        enrollments: {
          where: { academicYear: { isCurrent: true } },
          select: { sectionId: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } },
          take: 1,
        },
      },
    });
    if (!s) throw new NotFoundException('Student not found');
    const e = s.enrollments[0];
    return {
      id: s.id,
      name: fullName(s),
      firstName: s.firstName,
      admissionNo: s.admissionNo,
      gender: s.gender,
      sectionId: e?.sectionId ?? null,
      className: e ? `${e.section.class.name} ${e.section.name}` : null,
      rollNo: e?.rollNo ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  async schoolOverview(reach: Reach) {
    this.require(reach, 'students');
    const where = this.studentWhere(reach);
    const [school, total, byGender, sections] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: reach.user.schoolId }, select: { name: true, mode: true } }),
      this.prisma.student.count({ where }),
      this.prisma.student.groupBy({ by: ['gender'], where, _count: true }),
      this.sections(reach),
    ]);
    return {
      school: school.name,
      mode: school.mode,
      today: localToday(),
      yourView: reach.wide ? 'whole school (your campuses)' : 'the sections you teach',
      activeStudents: total,
      byGender: Object.fromEntries(byGender.map((g) => [g.gender, g._count])),
      sections,
      areasYouCanSee: {
        attendance: this.can(reach, 'attendance'),
        exams: this.can(reach, 'exams'),
        fees: reach.canFees,
      },
    };
  }

  async sections(reach: Reach) {
    const rows = await this.prisma.section.findMany({
      where: { id: { in: reach.sectionIds } },
      select: {
        id: true,
        name: true,
        class: { select: { name: true, sortOrder: true } },
        classTeacher: { select: { name: true } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });
    return rows
      .sort((a, b) => a.class.sortOrder - b.class.sortOrder || a.name.localeCompare(b.name))
      .map((s) => ({
        sectionId: s.id,
        name: `${s.class.name} ${s.name}`,
        classTeacher: s.classTeacher?.name ?? null,
        students: s._count.enrollments,
      }));
  }

  async findStudents(reach: Reach, input: { query?: string; sectionId?: string; limit?: number }) {
    this.require(reach, 'students');
    const extra: Prisma.StudentWhereInput[] = [];
    const search = studentSearchWhere(input.query);
    if (search) extra.push(search);
    if (input.sectionId) {
      const ids = this.sectionFilter(reach, input.sectionId);
      extra.push({ enrollments: { some: { sectionId: { in: ids }, status: 'ACTIVE' } } });
    }
    const rows = await this.prisma.student.findMany({
      where: this.studentWhere(reach, { AND: extra }),
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: Math.min(input.limit ?? 25, 50),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        gender: true,
        enrollments: {
          where: { academicYear: { isCurrent: true } },
          select: { section: { select: { name: true, class: { select: { name: true } } } } },
          take: 1,
        },
      },
    });
    return rows.map((s) => ({
      studentId: s.id,
      name: fullName(s),
      admissionNo: s.admissionNo,
      gender: s.gender,
      class: s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}` : null,
    }));
  }

  async studentOverview(reach: Reach, studentId: string) {
    this.require(reach, 'students');
    const student = await this.student(reach, studentId);
    const [attendance, results, fees] = await Promise.all([
      this.can(reach, 'attendance') ? this.attendanceCounts([studentId]) : null,
      this.can(reach, 'exams') ? this.recentResults([studentId], 3) : null,
      reach.canFees ? this.overdueFees([studentId]) : null,
    ]);
    const counts = attendance?.get(studentId);
    const risk = this.flagsFor(studentId, attendance, results, fees);
    return {
      ...student,
      attendanceLast30Days: counts ? { ...counts, percent: attendancePercent(counts) } : 'not visible to your role',
      results:
        results?.get(studentId)?.map((r) => ({
          exam: r.exam,
          percent: r.percent,
          grade: r.grade,
          position: r.position,
          passed: r.passed,
          subjects: r.subjects.map((s) => ({
            subject: s.subject,
            marks: s.absent ? 'absent' : s.marks,
            max: s.max,
            passed: s.passed,
          })),
          teacherRemark: r.teacherRemark,
        })) ?? 'not visible to your role',
      fees: fees ? (fees.get(studentId) ?? { overdueAmount: 0, oldestOverdueDays: 0 }) : 'not visible to your role',
      riskFlags: risk,
    };
  }

  async attendanceReport(reach: Reach, input: { from?: string; to?: string; sectionId?: string }) {
    this.require(reach, 'attendance');
    const today = localToday();
    const to = input.to && input.to <= today ? input.to : today;
    const from = input.from && input.from <= to ? input.from : daysBefore(to, ATTENDANCE_DAYS - 1);
    const sectionIds = this.sectionFilter(reach, input.sectionId);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        session: { schoolId: reach.user.schoolId, sectionId: { in: sectionIds }, date: { gte: dayStart(from), lte: dayStart(to) } },
        student: this.studentWhere(reach),
      },
      select: {
        status: true,
        studentId: true,
        session: { select: { sectionId: true } },
      },
    });
    const bySection = new Map<string, Record<AttendanceStatus, number>>();
    const byStudent = new Map<string, Record<AttendanceStatus, number>>();
    const zero = () => ({ PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 });
    for (const r of records) {
      const s = bySection.get(r.session.sectionId) ?? zero();
      s[r.status]++;
      bySection.set(r.session.sectionId, s);
      const st = byStudent.get(r.studentId) ?? zero();
      st[r.status]++;
      byStudent.set(r.studentId, st);
    }
    const names = await this.names([...byStudent.keys()]);
    const sections = await this.sections(reach);
    const pct = (c: Record<AttendanceStatus, number>) => {
      const marked = c.PRESENT + c.ABSENT + c.LATE + c.LEAVE;
      return marked ? Math.round(((c.PRESENT + c.LATE) / marked) * 1000) / 10 : null;
    };
    return {
      from,
      to,
      sections: sections
        .filter((s) => sectionIds.includes(s.sectionId))
        .map((s) => {
          const c = bySection.get(s.sectionId);
          return { section: s.name, sectionId: s.sectionId, percent: c ? pct(c) : null, ...c };
        }),
      lowestStudents: [...byStudent.entries()]
        .map(([id, c]) => ({ studentId: id, name: names.get(id) ?? 'Unknown', percent: pct(c), absent: c.ABSENT, late: c.LATE }))
        .sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))
        .slice(0, 10),
    };
  }

  async examReport(reach: Reach, input: { examId?: string; sectionId?: string }) {
    this.require(reach, 'exams');
    const exams = await this.prisma.exam.findMany({
      where: { schoolId: reach.user.schoolId, status: ExamStatus.PUBLISHED },
      orderBy: [{ publishedAt: 'desc' }],
      take: 10,
      select: { id: true, name: true, publishedAt: true, academicYear: { select: { name: true } } },
    });
    const exam = input.examId ? exams.find((e) => e.id === input.examId) : exams[0];
    const list = exams.map((e) => ({ examId: e.id, name: e.name, year: e.academicYear.name }));
    if (!exam) return { publishedExams: list, note: input.examId ? 'Exam not found or not published' : 'No published exams yet' };
    const sectionIds = this.sectionFilter(reach, input.sectionId);
    const results = await this.prisma.examResult.findMany({
      where: { examId: exam.id, sectionId: { in: sectionIds }, student: this.studentWhere(reach) },
      select: {
        studentId: true,
        sectionId: true,
        percent: true,
        grade: true,
        position: true,
        passed: true,
        subjects: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    const sections = new Map((await this.sections(reach)).map((s) => [s.sectionId, s.name]));
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const bySection = new Map<string, typeof results>();
    const subjectPct = new Map<string, number[]>();
    for (const r of results) {
      bySection.set(r.sectionId, [...(bySection.get(r.sectionId) ?? []), r]);
      for (const s of subjectRows(r.subjects))
        if (!s.absent && s.marks !== null && s.max > 0)
          subjectPct.set(s.subject, [...(subjectPct.get(s.subject) ?? []), (s.marks / s.max) * 100]);
    }
    const ranked = [...results].sort((a, b) => b.percent - a.percent);
    const row = (r: (typeof results)[number]) => ({
      studentId: r.studentId,
      name: fullName(r.student),
      section: sections.get(r.sectionId) ?? null,
      percent: Math.round(r.percent * 10) / 10,
      grade: r.grade,
      passed: r.passed,
    });
    return {
      exam: { examId: exam.id, name: exam.name, year: exam.academicYear.name },
      publishedExams: list,
      students: results.length,
      averagePercent: avg(results.map((r) => r.percent)),
      passRate: results.length ? Math.round((results.filter((r) => r.passed).length / results.length) * 1000) / 10 : null,
      sections: [...bySection.entries()].map(([id, rs]) => ({
        section: sections.get(id) ?? id,
        students: rs.length,
        averagePercent: avg(rs.map((r) => r.percent)),
        failed: rs.filter((r) => !r.passed).length,
      })),
      subjects: [...subjectPct.entries()]
        .map(([subject, xs]) => ({ subject, averagePercent: avg(xs) }))
        .sort((a, b) => (a.averagePercent ?? 0) - (b.averagePercent ?? 0)),
      top: ranked.slice(0, 5).map(row),
      bottom: ranked.slice(-5).reverse().map(row),
    };
  }

  async feeReport(reach: Reach, input: { period?: string }) {
    if (!reach.canFees) throw new ForbiddenException('Your role does not have access to Fees');
    const period = input.period ?? localToday().slice(0, 7);
    const where: Prisma.InvoiceWhereInput = {
      schoolId: reach.user.schoolId,
      status: { not: InvoiceStatus.CANCELLED },
      student: this.studentWhere(reach),
    };
    const [month, overdue] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { ...where, period }, _sum: { total: true, paid: true, arrears: true }, _count: true }),
      this.overdueFees(null, where),
    ]);
    const owed = await feeOutstanding(this.prisma, { ...where, period });
    const names = await this.names([...overdue.keys()]);
    // Balances carried onto this month's vouchers were billed in their own month.
    const billed = billedOf(month._sum);
    const collected = month._sum.paid ?? 0;
    const defaulters = [...overdue.entries()]
      .map(([id, f]) => ({ studentId: id, name: names.get(id) ?? 'Unknown', ...f }))
      .sort((a, b) => b.overdueAmount - a.overdueAmount);
    return {
      period,
      vouchers: month._count,
      billed,
      collected,
      outstanding: owed.outstanding.amount,
      collectionRate: billed ? Math.round((collected / billed) * 1000) / 10 : null,
      overdueAllPeriods: {
        students: defaulters.length,
        amount: defaulters.reduce((a, d) => a + d.overdueAmount, 0),
        top: defaulters.slice(0, 15),
      },
      currency: 'PKR',
    };
  }

  // ---------------------------------------------------------------------------
  // At-risk students (SCHOOL-107)
  // ---------------------------------------------------------------------------

  async atRisk(reach: Reach, sectionId?: string) {
    this.require(reach, 'students');
    const ids = this.sectionFilter(reach, sectionId);
    const enrolled = await this.prisma.enrollment.findMany({
      where: {
        sectionId: { in: ids },
        status: 'ACTIVE',
        student: this.studentWhere(reach),
      },
      select: {
        studentId: true,
        rollNo: true,
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
      },
    });
    const studentIds = enrolled.map((e) => e.studentId);
    const [attendance, results, fees] = await Promise.all([
      this.can(reach, 'attendance') ? this.attendanceCounts(studentIds) : null,
      this.can(reach, 'exams') ? this.recentResults(studentIds, 2) : null,
      reach.canFees ? this.overdueFees(studentIds) : null,
    ]);
    const students = enrolled
      .map((e) => {
        const flags = this.flagsFor(e.studentId, attendance, results, fees);
        return {
          studentId: e.studentId,
          name: fullName(e.student),
          admissionNo: e.student.admissionNo,
          sectionId: e.section.id,
          section: `${e.section.class.name} ${e.section.name}`,
          level: riskLevel(flags),
          flags,
          score: riskScore(flags),
        };
      })
      .filter((s) => s.level !== null)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return {
      checked: enrolled.length,
      areas: { attendance: attendance !== null, results: results !== null, fees: fees !== null },
      students: students.slice(0, RISK_LIMIT).map(({ score: _score, ...s }) => s),
      truncated: students.length > RISK_LIMIT,
    };
  }

  private flagsFor(
    studentId: string,
    attendance: Map<string, RiskInput['attendance']> | null,
    results: Map<string, RecentResult[]> | null,
    fees: Map<string, { overdueAmount: number; oldestOverdueDays: number }> | null,
  ): RiskFlag[] {
    return riskFlags({
      attendance: attendance?.get(studentId) ?? { present: 0, absent: 0, late: 0, leave: 0 },
      results: (results?.get(studentId) ?? []).map((r) => ({
        exam: r.exam,
        percent: r.percent,
        passed: r.passed,
        failedSubjects: r.subjects.filter((s) => !s.passed).map((s) => s.subject),
      })),
      fees: fees ? (fees.get(studentId) ?? { overdueAmount: 0, oldestOverdueDays: 0 }) : null,
    });
  }

  // ---------------------------------------------------------------------------
  // Draft facts (SCHOOL-106)
  // ---------------------------------------------------------------------------

  async draftFacts(reach: Reach, studentId: string, examId?: string): Promise<{ facts: DraftFacts; examId: string | null }> {
    this.require(reach, 'students');
    const student = await this.student(reach, studentId);
    const [school, writer, attendance, result, fees] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: reach.user.schoolId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: reach.user.sub }, select: { name: true } }),
      this.can(reach, 'attendance') ? this.attendanceCounts([studentId]) : null,
      this.can(reach, 'exams')
        ? this.prisma.examResult.findFirst({
            where: {
              studentId,
              exam: { schoolId: reach.user.schoolId, status: ExamStatus.PUBLISHED, ...(examId ? { id: examId } : {}) },
            },
            orderBy: { exam: { publishedAt: 'desc' } },
            select: {
              percent: true,
              grade: true,
              position: true,
              passed: true,
              subjects: true,
              exam: { select: { id: true, name: true } },
            },
          })
        : null,
      reach.canFees ? this.overdueFees([studentId]) : null,
    ]);
    if (examId && !result) throw new NotFoundException('No published result for this student in that exam');
    const counts = attendance?.get(studentId);
    const facts: DraftFacts = {
      student: { firstName: student.firstName, fullName: student.name, className: student.className },
      attendancePercent: counts ? attendancePercent(counts) : null,
      result: result
        ? {
            exam: result.exam.name,
            percent: Math.round(result.percent * 10) / 10,
            grade: result.grade,
            position: result.position,
            passed: result.passed,
            subjects: subjectRows(result.subjects).map((s) => ({
              subject: s.subject,
              percent: s.absent || s.marks === null || !s.max ? null : Math.round((s.marks / s.max) * 1000) / 10,
              passed: s.passed,
              absent: s.absent,
            })),
          }
        : null,
      overdueFees: fees ? (fees.get(studentId)?.overdueAmount ?? 0) : null,
      schoolName: school.name,
      writerName: writer?.name ?? reach.user.name,
    };
    return { facts, examId: result?.exam.id ?? null };
  }

  /** Pickers for the assistant page: sections in reach and recent published exams. */
  async options(reach: Reach) {
    const exams = this.can(reach, 'exams')
      ? await this.prisma.exam.findMany({
          where: { schoolId: reach.user.schoolId, status: ExamStatus.PUBLISHED },
          orderBy: { publishedAt: 'desc' },
          take: 10,
          select: { id: true, name: true },
        })
      : [];
    return { sections: await this.sections(reach), exams };
  }

  // ---------------------------------------------------------------------------
  // Shared lookups
  // ---------------------------------------------------------------------------

  private async names(ids: string[]) {
    const rows = await this.prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(rows.map((r) => [r.id, fullName(r)]));
  }

  /** Attendance counts per student over the last 30 days. */
  async attendanceCounts(studentIds: string[]) {
    const from = dayStart(daysBefore(localToday(), ATTENDANCE_DAYS - 1));
    const rows = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where: { studentId: { in: studentIds }, session: { date: { gte: from } } },
      _count: true,
    });
    const out = new Map<string, RiskInput['attendance']>();
    for (const r of rows) {
      const c = out.get(r.studentId) ?? { present: 0, absent: 0, late: 0, leave: 0 };
      c[r.status.toLowerCase() as keyof RiskInput['attendance']] += r._count;
      out.set(r.studentId, c);
    }
    return out;
  }

  /** Each student's latest published results, newest first. */
  async recentResults(studentIds: string[], perStudent: number) {
    const rows = await this.prisma.examResult.findMany({
      where: { studentId: { in: studentIds }, exam: { status: ExamStatus.PUBLISHED } },
      orderBy: { exam: { publishedAt: 'desc' } },
      select: {
        studentId: true,
        percent: true,
        grade: true,
        position: true,
        passed: true,
        subjects: true,
        teacherRemark: true,
        exam: { select: { name: true } },
      },
    });
    const out = new Map<string, RecentResult[]>();
    for (const r of rows) {
      const list = out.get(r.studentId) ?? [];
      if (list.length >= perStudent) continue;
      list.push({
        exam: r.exam.name,
        percent: Math.round(r.percent * 10) / 10,
        grade: r.grade,
        position: r.position,
        passed: r.passed,
        subjects: subjectRows(r.subjects),
        teacherRemark: r.teacherRemark,
      });
      out.set(r.studentId, list);
    }
    return out;
  }

  /** Unpaid balance past its due date, per student, with the age of the oldest. */
  async overdueFees(studentIds: string[] | null, where: Prisma.InvoiceWhereInput = {}) {
    const today = localToday();
    const rows = await this.prisma.invoice.findMany({
      where: {
        ...where,
        ...(studentIds ? { studentId: { in: studentIds } } : {}),
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
        dueDate: { lt: dayStart(today) },
      },
      select: { studentId: true, total: true, paid: true, dueDate: true },
    });
    const out = new Map<string, { overdueAmount: number; oldestOverdueDays: number }>();
    const now = dayStart(today).getTime();
    for (const r of rows) {
      const due = r.total - r.paid;
      if (due <= 0) continue;
      const days = Math.floor((now - r.dueDate.getTime()) / 86_400_000);
      const f = out.get(r.studentId) ?? { overdueAmount: 0, oldestOverdueDays: 0 };
      f.overdueAmount += due;
      f.oldestOverdueDays = Math.max(f.oldestOverdueDays, days);
      out.set(r.studentId, f);
    }
    return out;
  }
}
