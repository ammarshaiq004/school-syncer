import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
} from '../../common/admin-roles.js';
import type { AuthUser } from '../../common/auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** A where-filter that fits both Assignment and Quiz (same scoping columns). */
export type TeachingWhere = Prisma.AssignmentWhereInput & Prisma.QuizWhereInput;

/**
 * Who may see and change assignments and quizzes. Same rules as courses:
 * SETUP roles see everything in their campus scope; anyone else sees an item
 * when they created it, are the section's class teacher, or teach that
 * subject in that section (SectionSubject.teacherId). Out of scope is 404.
 */
@Injectable()
export class TeachingScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async where(user: AuthUser): Promise<TeachingWhere> {
    if (hasAnyRole(user, SETUP_ROLES)) {
      const scope = campusScope(user);
      return scope
        ? {
            schoolId: user.schoolId,
            section: { class: { campusId: { in: scope } } },
          }
        : { schoolId: user.schoolId };
    }
    const teaches = await this.prisma.sectionSubject.findMany({
      where: { schoolId: user.schoolId, teacherId: user.sub },
      select: { sectionId: true, subjectId: true },
    });
    return {
      schoolId: user.schoolId,
      OR: [
        { createdById: user.sub },
        { section: { classTeacherId: user.sub } },
        ...teaches.map((t) => ({
          sectionId: t.sectionId,
          subjectId: t.subjectId,
        })),
      ],
    };
  }

  /**
   * Checks the user may set work for this section and subject, and that the
   * optional course belongs to the same section and subject. Section out of
   * scope -> 404, subject not taught there -> 404, not their class -> 403.
   */
  async target(
    user: AuthUser,
    sectionId: string,
    subjectId: string,
    courseId?: string | null,
  ) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId ?? '', schoolId: user.schoolId },
      select: {
        id: true,
        classTeacherId: true,
        class: { select: { campusId: true } },
        subjects: {
          where: { subjectId: subjectId ?? '' },
          select: { subjectId: true, teacherId: true },
        },
      },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    const taught = section.subjects[0];
    if (!taught)
      throw new NotFoundException('This subject is not taught in this section');
    const allowed =
      hasAnyRole(user, SETUP_ROLES) ||
      section.classTeacherId === user.sub ||
      taught.teacherId === user.sub;
    if (!allowed)
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    if (courseId) {
      const course = await this.prisma.course.findFirst({
        where: {
          id: courseId,
          schoolId: user.schoolId,
          sectionId: section.id,
          subjectId,
        },
        select: { id: true },
      });
      if (!course)
        throw new BadRequestException(
          'Choose a course of the same section and subject',
        );
    }
    return { sectionId: section.id, subjectId };
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

  /** Number of active students per section. */
  async studentCounts(sectionIds: string[]) {
    const rows = await this.prisma.enrollment.groupBy({
      by: ['sectionId'],
      where: { sectionId: { in: [...new Set(sectionIds)] }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.sectionId, r._count._all]));
  }
}

export function fullName(s: { firstName: string; lastName: string | null }) {
  return [s.firstName, s.lastName].filter(Boolean).join(' ');
}
