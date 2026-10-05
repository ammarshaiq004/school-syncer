import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
} from '../../common/admin-roles.js';
import type { AuthUser } from '../../common/auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { joinWindow, JOIN_EARLY_MIN, liveEndsAt } from './live-rules.js';

export const liveInclude = {
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { id: true, name: true, campusId: true } },
    },
  },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, name: true } },
  _count: { select: { attendance: true } },
} satisfies Prisma.LiveClassInclude;

type LiveRow = Prisma.LiveClassGetPayload<{ include: typeof liveInclude }>;

/**
 * Who may see and run which live class.
 *
 * SETUP roles see every class whose section is in their campus scope. Everyone
 * else sees a class they teach (LiveClass.teacherId or the timetable slot's
 * teacher), one in a section they are class teacher of, or one for a subject
 * they teach in that section (SectionSubject.teacherId).
 */
@Injectable()
export class LiveService {
  constructor(private readonly prisma: PrismaService) {}

  async scopeWhere(user: AuthUser): Promise<Prisma.LiveClassWhereInput> {
    const base: Prisma.LiveClassWhereInput = { schoolId: user.schoolId };
    if (hasAnyRole(user, SETUP_ROLES)) {
      const scope = campusScope(user);
      return scope
        ? { ...base, section: { class: { campusId: { in: scope } } } }
        : base;
    }
    const teaches = await this.prisma.sectionSubject.findMany({
      where: { schoolId: user.schoolId, teacherId: user.sub },
      select: { sectionId: true, subjectId: true },
    });
    return {
      ...base,
      OR: [
        { teacherId: user.sub },
        { timetableSlot: { teacherId: user.sub } },
        { section: { classTeacherId: user.sub } },
        ...teaches.map((t) => ({
          sectionId: t.sectionId,
          subjectId: t.subjectId,
        })),
      ],
    };
  }

  /** A class this user may see, or 404. */
  async classInScope(user: AuthUser, id: string) {
    const cls = await this.prisma.liveClass.findFirst({
      where: { AND: [{ id: id ?? '' }, await this.scopeWhere(user)] },
      include: liveInclude,
    });
    if (!cls) throw new NotFoundException('Live class not found');
    return cls;
  }

  /** A class as staff see it: the stored row plus its planned end and the join window. */
  static present(cls: LiveRow, now = new Date()) {
    const { _count, ...rest } = cls;
    return {
      ...rest,
      endsAt: liveEndsAt(cls.startsAt, cls.durationMin),
      joinOpensAt: new Date(cls.startsAt.getTime() - JOIN_EARLY_MIN * 60_000),
      joinWindow: joinWindow(cls, now),
      attendanceCount: _count.attendance,
    };
  }

  /** Active students of a section, in roll order. */
  sectionStudents(sectionId: string) {
    return this.prisma.enrollment.findMany({
      where: { sectionId, status: 'ACTIVE' },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
      select: {
        rollNo: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            photoUrl: true,
          },
        },
      },
    });
  }
}
