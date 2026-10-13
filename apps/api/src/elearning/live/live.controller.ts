import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { LiveProvider, LiveStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  administers,
  ATTENDANCE_ROLES,
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../../common/admin-roles.js';
import { AuditService } from '../../common/audit.service.js';
import { PermissionService } from '../../common/permission.service.js';
import { satisfies } from '../../common/permissions.js';
import type { AuthUser } from '../../common/auth-user.js';
import {
  dayStart,
  daysBefore,
  localDate,
  localToday,
  startOfLocalDay,
} from '../../common/dates.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { teacherGrantInScope } from '../teacher-grant.js';
import { isHttpsUrl } from '../courses/course-rules.js';
import {
  attendanceFromJoins,
  jitsiUrl,
  mondayOf,
  slotOccurrence,
  weekdayDate,
} from './live-rules.js';
import { liveInclude, LiveService } from './live.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpsUrl, 'Links must start with https://');
const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const listSchema = z.object({
  sectionId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(LiveStatus).optional(),
});
const createSchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(160).optional(),
  startsAt: instant,
  durationMin: z.number().int().min(5).max(300).default(40),
  provider: z.enum(LiveProvider).default('JITSI'),
  joinUrl: httpsUrl.optional(),
  teacherId: z.string().min(1).nullable().optional(),
});
const updateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  subjectId: z.string().min(1).nullable().optional(),
  startsAt: instant.optional(),
  durationMin: z.number().int().min(5).max(300).optional(),
  provider: z.enum(LiveProvider).optional(),
  joinUrl: httpsUrl.optional(),
  recordingUrl: httpsUrl.nullable().optional(),
  teacherId: z.string().min(1).nullable().optional(),
});
const endSchema = z
  .object({ recordingUrl: httpsUrl.nullable().optional() })
  .optional();
const fromTimetableSchema = z.object({
  sectionId: z.string().min(1),
  weekStart: isoDate,
});

type ListQuery = z.infer<typeof listSchema>;
type CreateLive = z.infer<typeof createSchema>;
type UpdateLive = z.infer<typeof updateSchema>;

/**
 * Live online classes (SCHOOL-118) for teachers and admins: schedule by hand
 * or from a section's timetable for a week, start and end them, see who
 * joined and turn that into the day's attendance register.
 */
@Controller('elearning/live')
@Permission('elearning')
@RequiresFeature('elearning')
export class ElearningLiveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  /** Classes in scope, oldest first. Without from/to: the last 30 days and everything ahead. */
  @Get()
  @Roles(...STAFF_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSchema)) query: ListQuery,
  ) {
    const from =
      query.from ?? (query.to ? undefined : daysBefore(localToday(), 30));
    const startsAt: Prisma.DateTimeFilter = {};
    if (from) startsAt.gte = startOfLocalDay(from);
    if (query.to) startsAt.lt = startOfLocalDay(daysBefore(query.to, -1));
    const rows = await this.prisma.liveClass.findMany({
      where: {
        AND: [
          await this.live.scopeWhere(user),
          query.sectionId ? { sectionId: query.sectionId } : {},
          query.status ? { status: query.status } : {},
          { startsAt },
        ],
      },
      include: liveInclude,
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    const canManage = hasAnyRole(user, ATTENDANCE_ROLES);
    const now = new Date();
    return rows.map((r) => ({ ...LiveService.present(r, now), canManage }));
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.live.classInScope(user, id);
    return {
      ...LiveService.present(cls),
      canManage: hasAnyRole(user, ATTENDANCE_ROLES),
    };
  }

  @Post()
  @Roles(...ATTENDANCE_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: CreateLive,
  ) {
    const access = await this.sectionAccess(user, body.sectionId);
    const subject = body.subjectId
      ? this.subjectFor(user, access, body.subjectId)
      : null;
    if (!subject && !access.isAdmin && !access.isClassTeacher) {
      throw new BadRequestException(
        'Choose the subject you teach in this section',
      );
    }
    // A teacher runs the classes they schedule; admins default to the subject's teacher.
    let teacherId = access.isAdmin ? (subject?.teacherId ?? null) : user.sub;
    if (body.teacherId !== undefined) {
      if (!access.isAdmin)
        throw new ForbiddenException('Only admins can choose the teacher');
      teacherId =
        body.teacherId === null
          ? null
          : await this.staffUser(user, body.teacherId);
    }
    const joinUrl = await this.joinUrlFor(user, body.provider, body.joinUrl);
    const created = await this.prisma.liveClass.create({
      data: {
        schoolId: user.schoolId,
        sectionId: access.section.id,
        subjectId: subject?.subjectId ?? null,
        teacherId,
        title: body.title ?? subject?.subject.name ?? 'Live class',
        startsAt: body.startsAt,
        durationMin: body.durationMin,
        provider: body.provider,
        joinUrl,
      },
      include: liveInclude,
    });
    await this.audit.record(user, 'live.create', 'LiveClass', created.id, {
      after: this.snapshot(created),
    });
    return { ...LiveService.present(created), canManage: true };
  }

  /**
   * Edits a class. Time, subject, provider and link can only change while it
   * is still scheduled; the title and recording link can change any time.
   */
  @Patch(':id')
  @Roles(...ATTENDANCE_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateLive,
  ) {
    const cls = await this.live.classInScope(user, id);
    const scheduleChange = [
      'subjectId',
      'startsAt',
      'durationMin',
      'provider',
      'joinUrl',
      'teacherId',
    ].some((k) => body[k as keyof UpdateLive] !== undefined);
    if (scheduleChange && cls.status !== 'SCHEDULED') {
      throw new ConflictException('Only a scheduled class can be rescheduled');
    }
    const data: Prisma.LiveClassUncheckedUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.startsAt !== undefined) data.startsAt = body.startsAt;
    if (body.durationMin !== undefined) data.durationMin = body.durationMin;
    if (body.recordingUrl !== undefined) data.recordingUrl = body.recordingUrl;
    if (body.subjectId !== undefined) {
      if (body.subjectId === null) data.subjectId = null;
      else {
        const access = await this.sectionAccess(user, cls.sectionId);
        data.subjectId = this.subjectFor(
          user,
          access,
          body.subjectId,
        ).subjectId;
      }
    }
    if (body.teacherId !== undefined) {
      if (!hasAnyRole(user, SETUP_ROLES))
        throw new ForbiddenException('Only admins can choose the teacher');
      data.teacherId =
        body.teacherId === null
          ? null
          : await this.staffUser(user, body.teacherId);
    }
    if (body.provider !== undefined || body.joinUrl !== undefined) {
      const provider = body.provider ?? cls.provider;
      data.provider = provider;
      // Keeping Jitsi keeps its room unless a new link is given.
      const keep =
        provider === 'JITSI' &&
        cls.provider === 'JITSI' &&
        body.joinUrl === undefined;
      if (!keep)
        data.joinUrl = await this.joinUrlFor(user, provider, body.joinUrl);
    }
    const updated = await this.prisma.liveClass.update({
      where: { id: cls.id },
      data,
      include: liveInclude,
    });
    await this.audit.record(user, 'live.update', 'LiveClass', cls.id, {
      before: this.snapshot(cls),
      after: this.snapshot(updated),
    });
    return { ...LiveService.present(updated), canManage: true };
  }

  @Post(':id/cancel')
  @Roles(...ATTENDANCE_ROLES)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.live.classInScope(user, id);
    if (cls.status === 'CANCELLED')
      return { ...LiveService.present(cls), canManage: true };
    if (cls.status !== 'SCHEDULED')
      throw new ConflictException('Only a scheduled class can be cancelled');
    return this.setStatus(user, cls, 'live.cancel', { status: 'CANCELLED' });
  }

  @Post(':id/start')
  @Roles(...ATTENDANCE_ROLES)
  async start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.live.classInScope(user, id);
    if (cls.status === 'LIVE')
      return { ...LiveService.present(cls), canManage: true };
    if (cls.status !== 'SCHEDULED')
      throw new ConflictException(`This class is ${cls.status.toLowerCase()}`);
    return this.setStatus(user, cls, 'live.start', {
      status: 'LIVE',
      startedAt: new Date(),
    });
  }

  /** Ends a live (or never started) class; a recording link can be added now or later. */
  @Post(':id/end')
  @Roles(...ATTENDANCE_ROLES)
  async end(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endSchema)) body: z.infer<typeof endSchema>,
  ) {
    const cls = await this.live.classInScope(user, id);
    if (cls.status === 'CANCELLED')
      throw new ConflictException('This class was cancelled');
    if (cls.status === 'ENDED')
      throw new ConflictException('This class has already ended');
    return this.setStatus(user, cls, 'live.end', {
      status: 'ENDED',
      endedAt: new Date(),
      ...(body?.recordingUrl !== undefined
        ? { recordingUrl: body.recordingUrl }
        : {}),
    });
  }

  /** Removes a class nobody has joined (scheduled or cancelled). */
  @Delete(':id')
  @Roles(...ATTENDANCE_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.live.classInScope(user, id);
    if (cls.status === 'LIVE' || cls._count.attendance > 0) {
      throw new ConflictException(
        'A class that students joined cannot be deleted; cancel or end it instead',
      );
    }
    await this.prisma.liveClass.delete({ where: { id: cls.id } });
    await this.audit.record(user, 'live.delete', 'LiveClass', cls.id, {
      before: this.snapshot(cls),
    });
    return { deleted: true };
  }

  /**
   * Creates a Jitsi class for every timetable period of a section in the week
   * containing `weekStart`. Periods already scheduled and periods that have
   * already started are skipped. Teachers only get their own periods (class
   * teachers and admins get all of them).
   */
  @Post('from-timetable')
  @Roles(...ATTENDANCE_ROLES)
  async fromTimetable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(fromTimetableSchema))
    body: z.infer<typeof fromTimetableSchema>,
  ) {
    const access = await this.sectionAccess(user, body.sectionId);
    const monday = mondayOf(body.weekStart);
    const slots = await this.prisma.timetableSlot.findMany({
      where: {
        sectionId: access.section.id,
        schoolId: user.schoolId,
        period: { isBreak: false },
      },
      include: { period: true, subject: { select: { id: true, name: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { sortOrder: 'asc' } }],
    });
    const subjectTeacher = new Map(
      access.section.subjects.map((s) => [s.subjectId, s.teacherId]),
    );
    const mine = slots.filter(
      (s) =>
        access.isAdmin ||
        access.isClassTeacher ||
        s.teacherId === user.sub ||
        subjectTeacher.get(s.subjectId) === user.sub,
    );
    const now = new Date();
    const planned = mine.map((s) => ({
      slot: s,
      ...slotOccurrence(monday, {
        dayOfWeek: s.dayOfWeek,
        startTime: s.period.startTime,
        endTime: s.period.endTime,
      }),
    }));
    const weekStartAt = startOfLocalDay(monday);
    const weekEnd = startOfLocalDay(weekdayDate(monday, 8));
    // Saving a timetable recreates its slots (links on older classes become
    // null), so "already scheduled" is decided by section and start time too.
    const taken = new Set(
      (
        await this.prisma.liveClass.findMany({
          where: {
            sectionId: access.section.id,
            startsAt: { gte: weekStartAt, lt: weekEnd },
          },
          select: { startsAt: true },
        })
      ).map((c) => c.startsAt.getTime()),
    );
    const future = planned.filter((p) => p.startsAt > now);
    const fresh = future.filter((p) => !taken.has(p.startsAt.getTime()));
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      select: { slug: true },
    });
    const result = await this.prisma.liveClass.createMany({
      data: fresh.map((p) => ({
        schoolId: user.schoolId,
        sectionId: access.section.id,
        subjectId: p.slot.subjectId,
        teacherId:
          p.slot.teacherId ??
          subjectTeacher.get(p.slot.subjectId) ??
          (access.isAdmin ? null : user.sub),
        title: p.slot.subject.name,
        startsAt: p.startsAt,
        durationMin: p.durationMin,
        provider: 'JITSI' as const,
        joinUrl: jitsiUrl(school.slug),
        timetableSlotId: p.slot.id,
      })),
      skipDuplicates: true,
    });
    const classes = await this.prisma.liveClass.findMany({
      where: {
        sectionId: access.section.id,
        startsAt: { in: planned.map((p) => p.startsAt) },
      },
      include: liveInclude,
      orderBy: { startsAt: 'asc' },
    });
    await this.audit.record(
      user,
      'live.from_timetable',
      'Section',
      access.section.id,
      {
        after: { weekStart: monday, created: result.count },
      },
    );
    return {
      weekStart: monday,
      created: result.count,
      skippedExisting: future.length - result.count,
      skippedPast: planned.length - future.length,
      classes: classes.map((c) => ({
        ...LiveService.present(c, now),
        canManage: true,
      })),
    };
  }

  /** The section's students and whether (and when) each joined. */
  @Get(':id/attendance')
  @Roles(...STAFF_ROLES)
  async attendance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.live.classInScope(user, id);
    const date = localDate(cls.startsAt);
    const [enrollments, joins, sheet] = await Promise.all([
      this.live.sectionStudents(cls.sectionId),
      this.prisma.liveAttendance.findMany({ where: { liveClassId: cls.id } }),
      this.prisma.attendanceSession.findUnique({
        where: {
          sectionId_date: { sectionId: cls.sectionId, date: dayStart(date) },
        },
        select: { id: true },
      }),
    ]);
    const byStudent = new Map(joins.map((j) => [j.studentId, j]));
    const students = enrollments.map((e) => {
      const join = byStudent.get(e.student.id);
      return {
        ...e.student,
        rollNo: e.rollNo,
        joined: Boolean(join),
        joinedAt: join?.joinedAt ?? null,
        leftAt: join?.leftAt ?? null,
      };
    });
    return {
      liveClass: LiveService.present(cls),
      date,
      sheetTaken: Boolean(sheet),
      canMarkAttendance: cls.status === 'ENDED' && !sheet,
      studentCount: students.length,
      joinedCount: students.filter((s) => s.joined).length,
      students,
    };
  }

  /**
   * Writes the day's attendance register from an ended class: present if the
   * student joined, absent otherwise. Refused when a register already exists
   * for that section and (school-local) day, so it never overwrites one.
   */
  @Post(':id/mark-attendance')
  @Roles(...ATTENDANCE_ROLES)
  async markAttendance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    // This writes the daily register, so it also needs attendance rights.
    if (!satisfies(await this.permissions.levelFor(user, 'attendance'), 'manage'))
      throw new ForbiddenException('You do not have permission to mark attendance');
    const cls = await this.live.classInScope(user, id);
    if (cls.status !== 'ENDED')
      throw new ConflictException('End the class before marking attendance');
    const date = localDate(cls.startsAt);
    if (date > localToday())
      throw new ConflictException(
        'Attendance can only be marked on or after the day of the class',
      );
    const [enrollments, joins] = await Promise.all([
      this.live.sectionStudents(cls.sectionId),
      this.prisma.liveAttendance.findMany({
        where: { liveClassId: cls.id },
        select: { studentId: true },
      }),
    ]);
    if (!enrollments.length)
      throw new ConflictException('This section has no students');
    const rows = attendanceFromJoins(
      enrollments.map((e) => e.student.id),
      new Set(joins.map((j) => j.studentId)),
    );
    const taken = () =>
      new ConflictException(`Attendance for ${date} has already been taken`);
    const existing = await this.prisma.attendanceSession.findUnique({
      where: {
        sectionId_date: { sectionId: cls.sectionId, date: dayStart(date) },
      },
      select: { id: true },
    });
    if (existing) throw taken();
    let sessionId: string;
    try {
      sessionId = await this.prisma.$transaction(async (tx) => {
        const session = await tx.attendanceSession.create({
          data: {
            schoolId: user.schoolId,
            sectionId: cls.sectionId,
            date: dayStart(date),
            takenById: user.sub,
          },
        });
        await tx.attendanceRecord.createMany({
          data: rows.map((r) => ({
            sessionId: session.id,
            studentId: r.studentId,
            status: r.status,
            note: 'Live class',
          })),
        });
        return session.id;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw taken();
      throw e;
    }
    const present = rows.filter((r) => r.status === 'PRESENT').length;
    await this.audit.record(user, 'live.mark_attendance', 'LiveClass', cls.id, {
      after: { date, sessionId, present, absent: rows.length - present },
    });
    return { date, sessionId, present, absent: rows.length - present };
  }

  // Helpers

  private async setStatus(
    user: AuthUser,
    cls: Awaited<ReturnType<LiveService['classInScope']>>,
    action: string,
    data: Prisma.LiveClassUncheckedUpdateInput,
  ) {
    const updated = await this.prisma.liveClass.update({
      where: { id: cls.id },
      data,
      include: liveInclude,
    });
    await this.audit.record(user, action, 'LiveClass', cls.id, {
      before: { status: cls.status },
      after: { status: updated.status, recordingUrl: updated.recordingUrl },
    });
    return { ...LiveService.present(updated), canManage: true };
  }

  /**
   * A section this user may schedule classes for. Out of campus scope -> 404;
   * a teacher needs to be its class teacher or teach a subject in it.
   */
  private async sectionAccess(user: AuthUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId ?? '', schoolId: user.schoolId },
      include: {
        class: { select: { campusId: true } },
        subjects: {
          include: { subject: { select: { id: true, name: true } } },
        },
      },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    const isAdmin = administers(user, section.class.campusId);
    const isClassTeacher = section.classTeacherId === user.sub;
    if (
      !isAdmin &&
      !isClassTeacher &&
      !section.subjects.some((s) => s.teacherId === user.sub)
    ) {
      throw new ForbiddenException('You do not teach in this section');
    }
    return { section, isAdmin, isClassTeacher };
  }

  /** A subject taught in the section that this user may hold classes for. */
  private subjectFor(
    user: AuthUser,
    access: Awaited<ReturnType<ElearningLiveController['sectionAccess']>>,
    subjectId: string,
  ) {
    const taught = access.section.subjects.find(
      (s) => s.subjectId === subjectId,
    );
    if (!taught)
      throw new NotFoundException('This subject is not taught in this section');
    if (
      !access.isAdmin &&
      !access.isClassTeacher &&
      taught.teacherId !== user.sub
    ) {
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    }
    return taught;
  }

  /** Jitsi rooms are generated; every other provider needs a pasted https link. */
  private async joinUrlFor(
    user: AuthUser,
    provider: LiveProvider,
    joinUrl?: string,
  ) {
    if (provider !== 'JITSI') {
      if (!joinUrl)
        throw new BadRequestException('Paste the meeting link for this class');
      return joinUrl;
    }
    if (joinUrl) return joinUrl;
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      select: { slug: true },
    });
    return jitsiUrl(school.slug);
  }

  private async staffUser(user: AuthUser, teacherId: string) {
    const teacher = await this.prisma.user.findFirst({
      where: {
        id: teacherId,
        schoolId: user.schoolId,
        isActive: true,
        roles: { some: teacherGrantInScope(user) },
      },
      select: { id: true },
    });
    if (!teacher)
      throw new BadRequestException('Choose a teacher from this school');
    return teacher.id;
  }

  private snapshot(cls: {
    title: string;
    startsAt: Date;
    durationMin: number;
    provider: LiveProvider;
    status: LiveStatus;
    teacherId: string | null;
    subjectId: string | null;
  }) {
    const {
      title,
      startsAt,
      durationMin,
      provider,
      status,
      teacherId,
      subjectId,
    } = cls;
    return {
      title,
      startsAt,
      durationMin,
      provider,
      status,
      teacherId,
      subjectId,
    };
  }
}
