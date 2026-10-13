import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { adminScope, campusScope, hasAnyRole, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

const periodsSchema = z.object({
  campusId: z.string().min(1),
  periods: z
    .array(
      z
        .object({
          id: z.string().optional(),
          name: z.string().trim().min(1).max(30),
          startTime: time,
          endTime: time,
          isBreak: z.boolean().default(false),
        })
        .refine((p) => p.startTime < p.endTime, 'A period must end after it starts'),
    )
    .max(16),
});
const slotsSchema = z.object({
  slots: z.array(
    z.object({
      dayOfWeek: z.number().int().min(1).max(7),
      periodId: z.string().min(1),
      subjectId: z.string().min(1),
      // Leave out to use the section's teacher for the subject; null for none.
      teacherId: z.string().min(1).nullable().optional(),
      room: z.string().trim().max(30).optional(),
    }),
  ),
});

const slotInclude = {
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, name: true } },
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
  period: { select: { id: true, name: true, startTime: true, endTime: true, sortOrder: true } },
} as const;

@Controller('timetable')
@Permission('timetable')
@RequiresFeature('timetable')
export class TimetableController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('periods')
  @Roles(...STAFF_ROLES)
  async periods(@CurrentUser() user: AuthUser, @Query('campusId') campusId: string) {
    await this.campusInSchool(user, campusId);
    return this.prisma.period.findMany({ where: { campusId }, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * Replaces a campus's bell schedule. Periods keep their id when sent back,
   * so existing timetables stay attached; a period still used in a timetable
   * cannot be removed.
   */
  @Put('periods')
  @Roles(...SETUP_ROLES)
  async setPeriods(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(periodsSchema)) body: z.infer<typeof periodsSchema>,
  ) {
    await this.campusInSchool(user, body.campusId, adminScope(user));
    const existing = await this.prisma.period.findMany({
      where: { campusId: body.campusId },
      include: { _count: { select: { slots: true } } },
    });
    const keep = new Set(body.periods.map((p) => p.id).filter(Boolean));
    if (body.periods.some((p) => p.id && !existing.some((e) => e.id === p.id))) {
      throw new NotFoundException('Period not found');
    }
    const removed = existing.filter((e) => !keep.has(e.id));
    const inUse = removed.find((e) => e._count.slots > 0);
    if (inUse) {
      throw new ConflictException(`${inUse.name} is used in timetables; clear those slots first`);
    }
    const sorted = [...body.periods].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        throw new ConflictException(`${sorted[i - 1].name} and ${sorted[i].name} overlap`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.period.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } }),
      // Park kept periods on negative positions so re-ordering can't collide on the unique index.
      ...existing
        .filter((e) => keep.has(e.id))
        .map((e, i) =>
          this.prisma.period.update({ where: { id: e.id }, data: { sortOrder: -1 - i } }),
        ),
      ...sorted.map((p, i) => {
        const data = {
          name: p.name,
          startTime: p.startTime,
          endTime: p.endTime,
          isBreak: p.isBreak,
          sortOrder: i + 1,
        };
        return p.id
          ? this.prisma.period.update({ where: { id: p.id }, data })
          : this.prisma.period.create({
              data: { ...data, schoolId: user.schoolId, campusId: body.campusId },
            });
      }),
    ]);
    await this.audit.record(user, 'update', 'Period', body.campusId, {
      before: existing,
      after: sorted,
    });
    return this.periods(user, body.campusId);
  }

  /** A section's week: the campus periods and what is taught in each. */
  @Get('sections/:sectionId')
  @Roles(...STAFF_ROLES)
  async forSection(@CurrentUser() user: AuthUser, @Param('sectionId') sectionId: string) {
    const section = await this.sectionInScope(user, sectionId);
    return this.sectionWeek(section);
  }

  /** Replaces a section's whole timetable, refusing teacher clashes with other sections. */
  @Put('sections/:sectionId')
  @Roles(...SETUP_ROLES)
  async setSection(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(slotsSchema)) body: z.infer<typeof slotsSchema>,
  ) {
    const section = await this.sectionInScope(user, sectionId, adminScope(user));
    const [periods, subjects, sectionSubjects] = await Promise.all([
      this.prisma.period.findMany({ where: { campusId: section.class.campusId } }),
      this.prisma.subject.findMany({ where: { schoolId: user.schoolId } }),
      this.prisma.sectionSubject.findMany({ where: { sectionId } }),
    ]);

    const seen = new Set<string>();
    const rows = body.slots.map((s) => {
      const period = periods.find((p) => p.id === s.periodId);
      if (!period) throw new NotFoundException('Period not found for this campus');
      if (period.isBreak) throw new ConflictException(`${period.name} is a break`);
      if (!subjects.some((x) => x.id === s.subjectId)) throw new NotFoundException('Subject not found');
      const key = `${s.dayOfWeek}|${s.periodId}`;
      if (seen.has(key)) throw new ConflictException(`${period.name} is filled twice on the same day`);
      seen.add(key);
      const teacherId =
        s.teacherId === undefined
          ? (sectionSubjects.find((x) => x.subjectId === s.subjectId)?.teacherId ?? null)
          : s.teacherId;
      return {
        schoolId: user.schoolId,
        sectionId,
        dayOfWeek: s.dayOfWeek,
        periodId: s.periodId,
        subjectId: s.subjectId,
        teacherId,
        room: s.room || null,
      };
    });

    const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((t): t is string => !!t))];
    if (teacherIds.length) {
      const found = await this.prisma.user.count({
        where: { id: { in: teacherIds }, schoolId: user.schoolId },
      });
      if (found !== teacherIds.length) throw new NotFoundException('Teacher not found');
      const busy = await this.prisma.timetableSlot.findMany({
        where: { teacherId: { in: teacherIds }, sectionId: { not: sectionId } },
        include: slotInclude,
      });
      for (const r of rows) {
        const clash = busy.find(
          (b) => b.teacherId === r.teacherId && b.dayOfWeek === r.dayOfWeek && b.periodId === r.periodId,
        );
        if (clash) {
          throw new ConflictException(
            `${clash.teacher?.name} already teaches ${clash.section.class.name} ${clash.section.name} in ${clash.period.name} on ${DAY_NAMES[r.dayOfWeek]}`,
          );
        }
      }
    }

    const before = await this.prisma.timetableSlot.findMany({ where: { sectionId } });
    await this.prisma.$transaction([
      this.prisma.timetableSlot.deleteMany({ where: { sectionId } }),
      this.prisma.timetableSlot.createMany({ data: rows }),
    ]);
    await this.audit.record(user, 'update', 'TimetableSlot', sectionId, { before, after: rows });
    return this.sectionWeek(section);
  }

  /** The signed-in teacher's week across all sections. */
  @Get('me')
  @Roles(...STAFF_ROLES)
  async mine(@CurrentUser() user: AuthUser) {
    return this.teacherWeek(user.sub);
  }

  @Get('teachers/:teacherId')
  @Roles(...SETUP_ROLES)
  async forTeacher(@CurrentUser() user: AuthUser, @Param('teacherId') teacherId: string) {
    const teacher = await this.prisma.user.findFirst({ where: { id: teacherId, schoolId: user.schoolId } });
    if (!teacher) throw new NotFoundException('Teacher not found');
    return this.teacherWeek(teacherId);
  }

  /** A child's timetable, for their parent. */
  @Get('students/:studentId')
  @Roles(Role.PARENT, ...STAFF_ROLES)
  async forStudent(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    if (!hasAnyRole(user, STAFF_ROLES)) {
      const link = await this.prisma.studentGuardian.findFirst({
        where: { studentId, guardian: { userId: user.sub } },
      });
      if (!link) throw new NotFoundException('Student not found');
    }
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        status: 'ACTIVE',
        student: { schoolId: user.schoolId },
        academicYear: { isCurrent: true },
      },
      include: { section: { include: { class: { select: { name: true, campusId: true } } } } },
    });
    if (!enrollment) throw new NotFoundException('Student is not enrolled this year');
    return this.sectionWeek(enrollment.section);
  }

  private async sectionWeek(section: {
    id: string;
    name: string;
    class: { name: string; campusId: string };
  }) {
    const [periods, slots] = await Promise.all([
      this.prisma.period.findMany({
        where: { campusId: section.class.campusId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.timetableSlot.findMany({
        where: { sectionId: section.id },
        include: slotInclude,
      }),
    ]);
    return {
      section: { id: section.id, name: `${section.class.name} ${section.name}` },
      periods,
      slots: slots.map(toSlot),
    };
  }

  private async teacherWeek(teacherId: string) {
    const slots = await this.prisma.timetableSlot.findMany({
      where: { teacherId },
      include: slotInclude,
    });
    return slots
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.period.startTime.localeCompare(b.period.startTime))
      .map(toSlot);
  }

  /** Admin actions pass adminScope; reads use the caller's campus scope. */
  private async campusInSchool(user: AuthUser, campusId: string, scope = campusScope(user)) {
    const campus = await this.prisma.campus.findFirst({ where: { id: campusId ?? '', schoolId: user.schoolId } });
    if (!campus || (scope && !scope.includes(campus.id))) throw new NotFoundException('Campus not found');
    return campus;
  }

  private async sectionInScope(user: AuthUser, sectionId: string, scope = campusScope(user)) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
      include: { class: { select: { name: true, campusId: true } } },
    });
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    return section;
  }
}

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toSlot(s: {
  id: string;
  dayOfWeek: number;
  room: string | null;
  period: { id: string; name: string; startTime: string; endTime: string };
  subject: { id: string; name: string };
  teacher: { id: string; name: string } | null;
  section: { id: string; name: string; class: { name: string } };
}) {
  return {
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    periodId: s.period.id,
    period: s.period.name,
    startTime: s.period.startTime,
    endTime: s.period.endTime,
    subjectId: s.subject.id,
    subject: s.subject.name,
    teacherId: s.teacher?.id ?? null,
    teacher: s.teacher?.name ?? null,
    sectionId: s.section.id,
    section: `${s.section.class.name} ${s.section.name}`,
    room: s.room,
  };
}
