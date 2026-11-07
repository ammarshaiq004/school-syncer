import { Body, Controller, ForbiddenException, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { AttendanceStatus, StaffStatus } from '@prisma/client';
import { z } from 'zod';
import { adminScope, ATTENDANCE_ROLES, campusScope, hasAnyRole, SETUP_ROLES, workingSections } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { staffWhere } from '../hr/staff-where.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { datewiseCounts, rankAbsences, validRange } from './attendance-reports.js';
import { assertCanMark } from './attendance.controller.js';
import { parseScanCode, scanStatus } from './qr.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const range = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => validRange(r.from, r.to), 'Pick a range of up to 92 days, starting before it ends');
const statuses = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',') : v),
  z.array(z.enum(AttendanceStatus)).min(1),
);

const scanSchema = z.object({ code: z.string().trim().min(1).max(100) });
const closeSchema = z.object({ date: isoDate.optional() });
const dailySchema = z.object({
  date: isoDate,
  status: statuses.default([AttendanceStatus.ABSENT, AttendanceStatus.LATE, AttendanceStatus.LEAVE]),
  sectionId: z.string().min(1).optional(),
});
const classSchema = range.and(z.object({ sectionId: z.string().min(1) }));
const staffDailySchema = dailySchema.omit({ sectionId: true });
const staffRankSchema = range.and(z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }));

const fullName = (s: { firstName: string; lastName: string | null }) => [s.firstName, s.lastName].filter(Boolean).join(' ');

/** QR-scan attendance for students and staff, and the attendance reports built on the same marks. */
@Controller('attendance')
@Permission('attendance')
export class AttendanceQrController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Marks today's attendance from a scanned ID-card code (or an admission or
   * employee number typed in). Arrivals after the school's cut-off are late.
   * A student already marked present, late or on leave is left alone; one
   * marked absent earlier is corrected to the scan.
   */
  @Post('scan')
  @Roles(...ATTENDANCE_ROLES)
  async scan(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(scanSchema)) body: z.infer<typeof scanSchema>) {
    const target = parseScanCode(body.code);
    if (!target) throw new NotFoundException('Not a SchoolSyncer ID card code');
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      select: { attendanceLateAfter: true },
    });
    const now = new Date();
    const status = scanStatus(now, school.attendanceLateAfter);
    const date = dayStart(localToday());

    if (target.kind !== 'staff') {
      const marked = await this.scanStudent(user, target.value, date, status, now);
      if (marked) return marked;
      if (target.kind === 'student') throw new NotFoundException('No enrolled student has that admission number');
    }
    const marked = await this.scanStaff(user, target.value, date, status, now);
    if (!marked) throw new NotFoundException('No one at this school has that code');
    return marked;
  }

  /**
   * End of the day: everyone in scope with no mark yet (not scanned, not on
   * leave) is recorded absent, so the absent lists are complete.
   */
  @Post('scan/close')
  @Roles(...SETUP_ROLES)
  async closeDay(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(closeSchema)) body: z.infer<typeof closeSchema>) {
    const iso = body.date ?? localToday();
    const date = dayStart(iso);
    const scope = adminScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYear: { isCurrent: true },
        ...(scope ? { class: { campusId: { in: scope } } } : {}),
      },
      select: {
        id: true,
        academicYearId: true,
        enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
      },
    });
    let students = 0;
    for (const s of sections) {
      if (!s.enrollments.length) continue;
      students += await this.prisma.$transaction(async (tx) => {
        const session = await tx.attendanceSession.upsert({
          where: { sectionId_date: { sectionId: s.id, date } },
          update: {},
          create: { schoolId: user.schoolId, sectionId: s.id, date, takenById: user.sub },
        });
        const { count } = await tx.attendanceRecord.createMany({
          data: s.enrollments.map((e) => ({ sessionId: session.id, studentId: e.studentId, status: AttendanceStatus.ABSENT })),
          skipDuplicates: true,
        });
        return count;
      });
    }
    const [staff, marks] = await Promise.all([
      this.prisma.user.findMany({
        where: { ...staffWhere(user.schoolId, scope), isActive: true, OR: [{ staffProfile: null }, { staffProfile: { status: StaffStatus.ACTIVE } }] },
        select: { id: true },
      }),
      this.prisma.staffAttendance.findMany({ where: { schoolId: user.schoolId, date }, select: { userId: true } }),
    ]);
    const marked = new Set(marks.map((m) => m.userId));
    const { count } = await this.prisma.staffAttendance.createMany({
      data: staff
        .filter((u) => !marked.has(u.id))
        .map((u) => ({ schoolId: user.schoolId, userId: u.id, date, status: AttendanceStatus.ABSENT, markedById: user.sub })),
      skipDuplicates: true,
    });
    await this.audit.record(user, 'attendance.close', 'AttendanceSession', null, { after: { date: iso, students, staff: count } });
    return { date: iso, studentsMarkedAbsent: students, staffMarkedAbsent: count };
  }

  /** Students who were absent, late or on leave on a day (all three by default), by section. */
  @Get('reports/daily')
  @Roles(...ATTENDANCE_ROLES)
  async daily(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(dailySchema)) q: z.infer<typeof dailySchema>) {
    const scope = campusScope(user);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        status: { in: q.status },
        session: {
          schoolId: user.schoolId,
          date: dayStart(q.date),
          ...(q.sectionId ? { sectionId: q.sectionId } : {}),
          section: { ...(scope ? { class: { campusId: { in: scope } } } : {}), ...workingSections(user) },
        },
      },
      take: 2000,
      select: {
        status: true,
        note: true,
        scannedAt: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        session: { select: { section: { select: { name: true, class: { select: { name: true, sortOrder: true } } } } } },
      },
    });
    const rows = records
      .map((r) => ({
        studentId: r.student.id,
        name: fullName(r.student),
        admissionNo: r.student.admissionNo,
        section: `${r.session.section.class.name} ${r.session.section.name}`,
        order: r.session.section.class.sortOrder,
        status: r.status,
        note: r.note,
        scannedAt: r.scannedAt,
      }))
      .sort((a, b) => a.order - b.order || a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
      .map(({ order: _order, ...row }) => row);
    return { date: q.date, total: rows.length, rows };
  }

  /** One section over a date range: counts per day, and each student's totals. */
  @Get('reports/class')
  @Roles(...ATTENDANCE_ROLES)
  async classReport(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(classSchema)) q: z.infer<typeof classSchema>) {
    const section = await assertCanMark(this.prisma, user, q.sectionId);
    const [enrollments, records] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId: q.sectionId, academicYearId: section.academicYearId, status: 'ACTIVE' },
        orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
        select: { rollNo: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { session: { sectionId: q.sectionId, date: { gte: dayStart(q.from), lte: dayStart(q.to) } } },
        select: { studentId: true, status: true, session: { select: { date: true } } },
      }),
    ]);
    const flat = records.map((r) => ({ studentId: r.studentId, status: r.status, date: r.session.date.toISOString().slice(0, 10) }));
    const perStudent = new Map<string, { PRESENT: number; ABSENT: number; LATE: number; LEAVE: number }>();
    for (const r of flat) {
      const c = perStudent.get(r.studentId) ?? { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
      c[r.status] += 1;
      perStudent.set(r.studentId, c);
    }
    const zero = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
    return {
      section: { id: section.id, name: `${section.class.name} ${section.name}` },
      from: q.from,
      to: q.to,
      days: datewiseCounts(flat),
      students: enrollments.map((e) => ({
        id: e.student.id,
        name: fullName(e.student),
        admissionNo: e.student.admissionNo,
        rollNo: e.rollNo,
        ...(perStudent.get(e.student.id) ?? zero),
      })),
    };
  }

  /** Staff who were absent, late or on leave on a day (all three by default). */
  @Get('reports/staff')
  @Roles(...SETUP_ROLES)
  @Permission('hr', 'view')
  async staffDaily(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(staffDailySchema)) q: z.infer<typeof staffDailySchema>) {
    const records = await this.prisma.staffAttendance.findMany({
      where: {
        schoolId: user.schoolId,
        date: dayStart(q.date),
        status: { in: q.status },
        user: staffWhere(user.schoolId, adminScope(user)),
      },
      select: { status: true, note: true, scannedAt: true, user: { select: { id: true, name: true, staffProfile: { select: { designation: true } } } } },
    });
    const rows = records
      .map((r) => ({
        userId: r.user.id,
        name: r.user.name,
        designation: r.user.staffProfile?.designation ?? null,
        status: r.status,
        note: r.note,
        scannedAt: r.scannedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { date: q.date, total: rows.length, rows };
  }

  /** Staff ranked by days absent over a range (most absent first). */
  @Get('reports/staff-absences')
  @Roles(...SETUP_ROLES)
  @Permission('hr', 'view')
  async staffAbsences(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(staffRankSchema)) q: z.infer<typeof staffRankSchema>) {
    const records = await this.prisma.staffAttendance.findMany({
      where: {
        schoolId: user.schoolId,
        date: { gte: dayStart(q.from), lte: dayStart(q.to) },
        user: staffWhere(user.schoolId, adminScope(user)),
      },
      select: { status: true, user: { select: { id: true, name: true } } },
    });
    return {
      from: q.from,
      to: q.to,
      rows: rankAbsences(records.map((r) => ({ userId: r.user.id, name: r.user.name, status: r.status })), q.limit),
    };
  }

  private async scanStudent(user: AuthUser, value: string, date: Date, status: 'PRESENT' | 'LATE', now: Date) {
    const student = await this.prisma.student.findFirst({
      where: { schoolId: user.schoolId, admissionNo: value },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        enrollments: {
          where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
          take: 1,
          select: { sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } },
        },
      },
    });
    const enrollment = student?.enrollments[0];
    if (!student || !enrollment) return null;
    await assertCanMark(this.prisma, user, enrollment.sectionId);
    const base = {
      kind: 'student' as const,
      name: fullName(student),
      detail: `${enrollment.section.class.name} ${enrollment.section.name}`,
    };
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.upsert({
        where: { sectionId_date: { sectionId: enrollment.sectionId, date } },
        update: {},
        create: { schoolId: user.schoolId, sectionId: enrollment.sectionId, date, takenById: user.sub },
      });
      const before = await tx.attendanceRecord.findUnique({
        where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
      });
      if (before && before.status !== AttendanceStatus.ABSENT) return { ...base, result: 'already' as const, status: before.status };
      const record = await tx.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
        update: { status, scannedAt: now },
        create: { sessionId: session.id, studentId: student.id, status, scannedAt: now },
      });
      await this.audit.record(
        user,
        'attendance.scan',
        'AttendanceRecord',
        record.id,
        {
          before: before ? { status: before.status } : undefined,
          after: { status, studentId: student.id, sectionId: enrollment.sectionId, date: date.toISOString().slice(0, 10) },
        },
        tx,
      );
      return { ...base, result: 'marked' as const, status };
    });
  }

  private async scanStaff(user: AuthUser, value: string, date: Date, status: 'PRESENT' | 'LATE', now: Date) {
    const profile = await this.prisma.staffProfile.findFirst({
      where: {
        schoolId: user.schoolId,
        employeeNo: value,
        status: StaffStatus.ACTIVE,
        user: { isActive: true, ...staffWhere(user.schoolId, adminScope(user)) },
      },
      select: { userId: true, designation: true, user: { select: { name: true } } },
    });
    if (!profile) return null;
    // Staff attendance belongs to administrators, like the staff register.
    if (!hasAnyRole(user, SETUP_ROLES)) throw new ForbiddenException('Only administrators can scan staff');
    const base = { kind: 'staff' as const, name: profile.user.name, detail: profile.designation };
    const before = await this.prisma.staffAttendance.findUnique({ where: { userId_date: { userId: profile.userId, date } } });
    if (before && before.status !== AttendanceStatus.ABSENT) return { ...base, result: 'already' as const, status: before.status };
    const record = await this.prisma.staffAttendance.upsert({
      where: { userId_date: { userId: profile.userId, date } },
      update: { status, scannedAt: now, markedById: user.sub },
      create: { schoolId: user.schoolId, userId: profile.userId, date, status, scannedAt: now, markedById: user.sub },
    });
    await this.audit.record(user, 'attendance.scan', 'StaffAttendance', record.id, {
      before: before ? { status: before.status } : undefined,
      after: { status, userId: profile.userId, date: date.toISOString().slice(0, 10) },
    });
    return { ...base, result: 'marked' as const, status };
  }
}
