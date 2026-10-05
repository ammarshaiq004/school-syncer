import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { campusScope, hasAnyRole, SETUP_ROLES } from '../../common/admin-roles.js';
import type { AuthUser } from '../../common/auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolveStudent } from '../../student/student-context.js';
import { progressPercent } from './course-rules.js';
import { videoEmbedUrl } from './video-embed.js';

const courseSummary = {
  section: { select: { id: true, name: true, class: { select: { id: true, name: true, campusId: true } } } },
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, name: true } },
} satisfies Prisma.CourseInclude;

/**
 * Who may see and change which course, plus the shared reads used by the
 * staff and student course controllers.
 *
 * Staff scope: SETUP roles see every course in their campus scope. Everyone
 * else sees a course when they teach that subject in that section
 * (SectionSubject.teacherId), are the section's class teacher, or are the
 * course's own teacher.
 */
@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  /** A Prisma filter for the courses this staff user may see. */
  async scopeWhere(user: AuthUser): Promise<Prisma.CourseWhereInput> {
    const base: Prisma.CourseWhereInput = { schoolId: user.schoolId };
    if (hasAnyRole(user, SETUP_ROLES)) {
      const scope = campusScope(user);
      return scope ? { ...base, section: { class: { campusId: { in: scope } } } } : base;
    }
    const teaches = await this.prisma.sectionSubject.findMany({
      where: { schoolId: user.schoolId, teacherId: user.sub },
      select: { sectionId: true, subjectId: true },
    });
    return {
      ...base,
      OR: [
        { teacherId: user.sub },
        { section: { classTeacherId: user.sub } },
        ...teaches.map((t) => ({ sectionId: t.sectionId, subjectId: t.subjectId })),
      ],
    };
  }

  /** A course this user may see, or 404. */
  async courseInScope(user: AuthUser, id: string) {
    const course = await this.prisma.course.findFirst({
      where: { AND: [{ id: id ?? '' }, await this.scopeWhere(user)] },
      include: courseSummary,
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  /** A unit whose course this user may see, or 404. */
  async unitInScope(user: AuthUser, unitId: string) {
    const unit = await this.prisma.courseUnit.findFirst({
      where: { id: unitId ?? '', course: await this.scopeWhere(user) },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  /** A lesson whose course this user may see, or 404. */
  async lessonInScope(user: AuthUser, lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId ?? '', unit: { course: await this.scopeWhere(user) } },
      include: { unit: { select: { id: true, courseId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return lesson;
  }

  /**
   * A section this user may create courses in, with its subjects. Out of
   * campus scope -> 404; a teacher may only use subjects they teach there
   * (class teachers: any subject of their section).
   */
  async sectionForCourses(user: AuthUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId ?? '', schoolId: user.schoolId },
      include: {
        class: { select: { name: true, campusId: true } },
        subjects: { include: { subject: { select: { id: true, name: true } } } },
      },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    const isAdmin = hasAnyRole(user, SETUP_ROLES);
    const manageable = section.subjects.filter(
      (s) => isAdmin || section.classTeacherId === user.sub || s.teacherId === user.sub,
    );
    if (!manageable.length && !isAdmin) {
      throw new ForbiddenException('You do not teach in this section');
    }
    return { section, manageable };
  }

  /** Active students of a section, in roll order. */
  sectionStudents(sectionId: string) {
    return this.prisma.enrollment.findMany({
      where: { sectionId, status: 'ACTIVE' },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
      select: {
        rollNo: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, photoUrl: true } },
      },
    });
  }

  /**
   * Average completion of published lessons per course, over each course's
   * currently enrolled students. Keyed by course id.
   */
  async completionByCourse(courses: { id: string; sectionId: string }[]) {
    const result = new Map<string, { students: number; publishedLessons: number; avgPercent: number }>();
    if (!courses.length) return result;
    const sectionIds = [...new Set(courses.map((c) => c.sectionId))];
    const [enrollments, lessons, progress] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { sectionId: { in: sectionIds }, status: 'ACTIVE' },
        select: { sectionId: true, studentId: true },
      }),
      this.prisma.lesson.findMany({
        where: { isPublished: true, unit: { courseId: { in: courses.map((c) => c.id) } } },
        select: { id: true, unit: { select: { courseId: true } } },
      }),
      this.prisma.lessonProgress.findMany({
        where: { lesson: { isPublished: true, unit: { courseId: { in: courses.map((c) => c.id) } } } },
        select: { studentId: true, lesson: { select: { unit: { select: { courseId: true } } } } },
      }),
    ]);
    const studentsBySection = new Map<string, Set<string>>();
    for (const e of enrollments) {
      const set = studentsBySection.get(e.sectionId) ?? new Set<string>();
      set.add(e.studentId);
      studentsBySection.set(e.sectionId, set);
    }
    for (const course of courses) {
      const students = studentsBySection.get(course.sectionId) ?? new Set<string>();
      const published = lessons.filter((l) => l.unit.courseId === course.id).length;
      const done = progress.filter((p) => p.lesson.unit.courseId === course.id && students.has(p.studentId)).length;
      result.set(course.id, {
        students: students.size,
        publishedLessons: published,
        avgPercent: progressPercent(done, students.size * published),
      });
    }
    return result;
  }

  /**
   * The signed-in student's record and current section. Same resolution as the
   * rest of the student workspace (current student, current year's enrollment
   * first), so courses and live classes always follow the same section.
   */
  async currentStudent(user: AuthUser) {
    const me = await resolveStudent(this.prisma, user);
    return { id: me.id, sectionId: me.sectionId };
  }

  /** Lesson as staff see it, with the embeddable player URL for videos. */
  static withEmbed<T extends { url: string | null }>(lesson: T) {
    return { ...lesson, embedUrl: videoEmbedUrl(lesson.url) };
  }
}

export { courseSummary };
