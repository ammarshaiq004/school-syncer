import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { z } from 'zod';
import {
  administers,
  ATTENDANCE_ROLES,
  campusScope,
  STAFF_ROLES,
  workingSections,
} from '../common/admin-roles.js';
import { AuditService, type AuditEntry } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { withNames } from '../common/change-history.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { dayStart } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildMatrix, monthBounds, monthDays } from './attendance-matrix.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const sheetSchema = z.object({
  sectionId: z.string().min(1),
  date: isoDate,
  records: z
    .array(
      z.object({
        studentId: z.string().min(1),
        status: z.enum(AttendanceStatus),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1),
});
type SheetInput = z.infer<typeof sheetSchema>;

const historySchema = z.object({
  sectionId: z.string().min(1),
  date: isoDate.optional(),
  studentId: z.string().min(1).optional(),
});

const asDate = dayStart;

const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

@Controller('attendance')
@Permission('attendance')
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Sections this user can take attendance for this year: all of them for admins, otherwise the ones they teach. */
  @Get('sections')
  @Roles(...ATTENDANCE_ROLES)
  async mySections(@CurrentUser() user: AuthUser) {
    const scope = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYear: { isCurrent: true },
        ...(scope ? { class: { campusId: { in: scope } } } : {}),
        ...workingSections(user),
      },
      include: {
        class: { select: { name: true, sortOrder: true } },
        subjects: { where: { teacherId: user.sub }, select: { subject: { select: { id: true, name: true } } } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });
    return sections
      .sort((a, b) => a.class.sortOrder - b.class.sortOrder || a.name.localeCompare(b.name))
      .map((s) => ({
        id: s.id,
        name: `${s.class.name} ${s.name}`,
        students: s._count.enrollments,
        isClassTeacher: s.classTeacherId === user.sub,
        mySubjects: s.subjects.map((x) => x.subject),
      }));
  }

  /** The register for one section and day: every enrolled student and their status, if taken. */
  @Get('sheet')
  @Roles(...ATTENDANCE_ROLES)
  async sheet(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId: string,
    @Query('date', new ZodValidationPipe(isoDate)) date: string,
  ) {
    const section = await this.assertCanMark(user, sectionId);
    const [enrollments, session] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId, academicYearId: section.academicYearId, status: 'ACTIVE' },
        orderBy: [{ rollNo: 'asc' }],
        include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      }),
      this.prisma.attendanceSession.findUnique({
        where: { sectionId_date: { sectionId, date: asDate(date) } },
        include: { records: true, takenBy: { select: { name: true } } },
      }),
    ]);
    return {
      section: { id: section.id, name: section.name, className: section.class.name },
      date,
      taken: Boolean(session),
      takenBy: session?.takenBy?.name ?? null,
      students: enrollments.map((e) => {
        const record = session?.records.find((r) => r.studentId === e.studentId);
        return {
          ...e.student,
          rollNo: e.rollNo,
          status: record?.status ?? null,
          note: record?.note ?? null,
        };
      }),
    };
  }

  /**
   * The month at a glance for one section: every school day as a column and
   * every enrolled student as a row with their status per day. Teachers only
   * see sections they teach; admins any section on their campuses.
   */
  @Get('matrix')
  @Roles(...ATTENDANCE_ROLES)
  async matrix(
    @CurrentUser() user: AuthUser,
    @Query('sectionId', new ZodValidationPipe(z.string().min(1, 'sectionId is required'))) sectionId: string,
    @Query('month', new ZodValidationPipe(monthParam)) month: string,
  ) {
    const section = await this.assertCanMark(user, sectionId);
    const { start, end } = monthBounds(month);
    const [enrollments, sessions] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId, academicYearId: section.academicYearId, status: 'ACTIVE' },
        orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
        select: {
          rollNo: true,
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, photoUrl: true } },
        },
      }),
      this.prisma.attendanceSession.findMany({
        where: { sectionId, date: { gte: asDate(start), lt: asDate(end) } },
        orderBy: { date: 'asc' },
        select: { id: true, date: true, records: { select: { studentId: true, status: true } } },
      }),
    ]);
    const sessionByDate = new Map(sessions.map((s) => [s.date.toISOString().slice(0, 10), s.id]));
    const days = monthDays(month, sessionByDate);
    const { students, totals } = buildMatrix(
      enrollments.map(({ rollNo, student: s }) => ({
        id: s.id,
        name: [s.firstName, s.lastName].filter(Boolean).join(' '),
        admissionNo: s.admissionNo,
        rollNo,
        photoUrl: s.photoUrl,
      })),
      sessions.flatMap((s) =>
        s.records.map((r) => ({ ...r, date: s.date.toISOString().slice(0, 10) })),
      ),
      days,
    );
    return {
      section: { id: section.id, name: section.name, className: section.class.name },
      month,
      days,
      students,
      totals,
    };
  }

  /** Saves the register; re-saving the same day replaces it. Parents of newly absent students get a WhatsApp alert. */
  @Put('sheet')
  @Roles(...ATTENDANCE_ROLES)
  async save(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(sheetSchema)) body: SheetInput,
  ) {
    const section = await this.assertCanMark(user, body.sectionId);
    const enrolled = await this.prisma.enrollment.findMany({
      where: { sectionId: body.sectionId, academicYearId: section.academicYearId, status: 'ACTIVE' },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrolled.map((e) => e.studentId));
    const stray = body.records.find((r) => !enrolledIds.has(r.studentId));
    if (stray) throw new NotFoundException('A student is not enrolled in this section');

    const date = asDate(body.date);
    const previous = await this.prisma.attendanceSession.findUnique({
      where: { sectionId_date: { sectionId: body.sectionId, date } },
      include: { records: true },
    });
    const wasAbsent = new Set(
      previous?.records.filter((r) => r.status === 'ABSENT').map((r) => r.studentId),
    );

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.upsert({
        where: { sectionId_date: { sectionId: body.sectionId, date } },
        update: { takenById: user.sub, takenAt: new Date() },
        create: { schoolId: user.schoolId, sectionId: body.sectionId, date, takenById: user.sub },
      });
      // Read under the session row's lock (taken by the upsert above), so two
      // people saving the same register cannot both log the same old value.
      const existing = new Map(
        (await tx.attendanceRecord.findMany({ where: { sessionId: session.id } })).map((r) => [r.studentId, r]),
      );
      const taken: { studentId: string; status: AttendanceStatus }[] = [];
      const changes: AuditEntry[] = [];
      for (const r of body.records) {
        const before = existing.get(r.studentId);
        // Leaving the note out keeps the one already there.
        const note = r.note === undefined ? (before?.note ?? null) : r.note;
        if (!before) {
          await tx.attendanceRecord.create({
            data: { sessionId: session.id, studentId: r.studentId, status: r.status, note },
          });
          taken.push({ studentId: r.studentId, status: r.status });
          continue;
        }
        // Re-saving the register leaves unchanged students alone and unlogged.
        if (before.status === r.status && before.note === note) continue;
        await tx.attendanceRecord.update({ where: { id: before.id }, data: { status: r.status, note } });
        changes.push({
          action: 'attendance.change',
          entity: 'AttendanceRecord',
          entityId: before.id,
          before: { status: before.status, note: before.note },
          after: { status: r.status, note, studentId: r.studentId, sectionId: body.sectionId, date: body.date },
        });
      }
      // Taking the register is the normal case: one compact record per save.
      if (taken.length) {
        changes.push({
          action: 'attendance.take',
          entity: 'AttendanceSession',
          entityId: session.id,
          after: { sectionId: body.sectionId, date: body.date, records: taken },
        });
      }
      await this.audit.recordMany(user, changes, tx);
    });

    const newlyAbsent = body.records
      .filter((r) => r.status === 'ABSENT' && !wasAbsent.has(r.studentId))
      .map((r) => r.studentId);
    let alertsSent = 0;
    if (newlyAbsent.length) {
      const [students, phones] = await Promise.all([
        this.prisma.student.findMany({
          where: { id: { in: newlyAbsent } },
          select: { id: true, firstName: true, lastName: true },
        }),
        guardianPhones(this.prisma, newlyAbsent),
      ]);
      alertsSent = await this.notifications.send(
        user.schoolId,
        students.flatMap((s) =>
          (phones.get(s.id) ?? []).map((to) => ({
            to,
            template: 'attendance.absent' as const,
            params: {
              studentName: [s.firstName, s.lastName].filter(Boolean).join(' '),
              date: body.date,
              schoolName: section.class.school.name,
            },
          })),
        ),
      );
    }

    const counts = Object.fromEntries(
      Object.values(AttendanceStatus).map((s) => [s, body.records.filter((r) => r.status === s).length]),
    );
    return { saved: body.records.length, counts, alertsSent };
  }

  /** Per-section totals for one day, for the dashboard and principals. */
  @Get('summary')
  @Roles(...STAFF_ROLES)
  async summary(
    @CurrentUser() user: AuthUser,
    @Query('date', new ZodValidationPipe(isoDate)) date: string,
  ) {
    const scope = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYear: { isCurrent: true },
        ...(scope ? { class: { campusId: { in: scope } } } : {}),
      },
      include: {
        class: { select: { name: true, sortOrder: true, campus: { select: { name: true } } } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        attendanceSessions: {
          where: { date: asDate(date) },
          include: { records: { select: { status: true } } },
        },
      },
    });
    return sections
      .sort((a, b) => a.class.sortOrder - b.class.sortOrder || a.name.localeCompare(b.name))
      .map((s) => {
        const records = s.attendanceSessions[0]?.records ?? [];
        const count = (status: AttendanceStatus) => records.filter((r) => r.status === status).length;
        return {
          sectionId: s.id,
          name: `${s.class.name} ${s.name}`,
          campus: s.class.campus.name,
          enrolled: s._count.enrollments,
          taken: s.attendanceSessions.length > 0,
          present: count('PRESENT') + count('LATE'),
          absent: count('ABSENT'),
          leave: count('LEAVE'),
        };
      });
  }

  /**
   * Change history of a section's register, for one day and/or one student:
   * when the register was taken, and every later change to a student's mark
   * with the old and new value and who made it. Newest first.
   */
  @Get('history')
  @Roles(...ATTENDANCE_ROLES)
  async history(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(historySchema)) query: z.infer<typeof historySchema>,
  ) {
    const section = await this.assertCanMark(user, query.sectionId);
    const on = (field: string, value: string | undefined) =>
      value ? [{ after: { path: [field], equals: value } }] : [];
    const logs = await this.prisma.auditLog.findMany({
      where: {
        schoolId: user.schoolId,
        OR: [
          {
            entity: 'AttendanceRecord',
            AND: [...on('sectionId', section.id), ...on('date', query.date), ...on('studentId', query.studentId)],
          },
          {
            entity: 'AttendanceSession',
            action: 'attendance.take',
            AND: [...on('sectionId', section.id), ...on('date', query.date)],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    type Mark = { status: AttendanceStatus; note?: string | null };
    const rows = logs.flatMap((log) => {
      const after = log.after as unknown as { date: string; studentId?: string; records?: { studentId: string; status: AttendanceStatus }[] } & Mark;
      if (log.entity === 'AttendanceSession') {
        return (after.records ?? [])
          .filter((r) => !query.studentId || r.studentId === query.studentId)
          .map((r) => ({
            at: log.createdAt,
            userId: log.userId,
            date: after.date,
            studentId: r.studentId,
            kind: 'taken' as 'taken' | 'changed',
            before: null as Mark | null,
            after: { status: r.status } as Mark,
          }));
      }
      return [
        {
          at: log.createdAt,
          userId: log.userId,
          date: after.date,
          studentId: after.studentId!,
          kind: 'changed' as const,
          before: log.before as unknown as Mark,
          after: { status: after.status, note: after.note },
        },
      ];
    });
    return {
      section: { id: section.id, name: `${section.class.name} ${section.name}` },
      history: await withNames(this.prisma, user.schoolId, rows),
    };
  }

  /** One student's attendance for a month (YYYY-MM). */
  @Get('students/:studentId')
  @Roles(...STAFF_ROLES)
  async forStudent(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query('month', new ZodValidationPipe(z.string().regex(/^\d{4}-\d{2}$/))) month: string,
  ) {
    // Another school's student is not found, rather than an empty month.
    const known = await this.prisma.student.count({ where: { id: studentId, schoolId: user.schoolId } });
    if (!known) throw new NotFoundException('Student not found');
    const start = asDate(`${month}-01`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        student: { schoolId: user.schoolId },
        session: { date: { gte: start, lt: end } },
      },
      orderBy: { session: { date: 'asc' } },
      select: { status: true, note: true, session: { select: { date: true } } },
    });
  }

  /**
   * Admins mark any section; teachers only sections where they are class
   * teacher or teach a subject.
   */
  private async assertCanMark(user: AuthUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
      include: {
        class: { select: { name: true, campusId: true, school: { select: { name: true } } } },
        subjects: { select: { teacherId: true } },
      },
    });
    if (!section) throw new NotFoundException('Section not found');

    if (administers(user, section.class.campusId)) return section;
    const teaches =
      section.classTeacherId === user.sub ||
      section.subjects.some((s) => s.teacherId === user.sub);
    if (!teaches) throw new ForbiddenException('You do not teach this section');
    return section;
  }
}
