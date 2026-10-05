import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../../common/decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { neighbours, progressPercent } from './course-rules.js';
import { CoursesService } from './courses.service.js';

const ordered = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

/**
 * A student's courses: published courses of their current section, with only
 * published lessons visible. Everything else answers 404.
 */
@Controller('student')
@Roles(Role.STUDENT)
@Permission('elearning')
@RequiresFeature('elearning')
export class StudentCoursesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
  ) {}

  @Get('courses')
  async list(@CurrentUser() user: AuthUser) {
    const student = await this.courses.currentStudent(user);
    if (!student.sectionId) return [];
    const rows = await this.prisma.course.findMany({
      where: { schoolId: user.schoolId, sectionId: student.sectionId, isPublished: true },
      orderBy: { title: 'asc' },
      include: {
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
        units: {
          orderBy: ordered,
          select: {
            lessons: {
              where: { isPublished: true },
              orderBy: ordered,
              select: { id: true, title: true, progress: { where: { studentId: student.id }, select: { id: true } } },
            },
          },
        },
      },
    });
    return rows.map(({ units, ...course }) => {
      const lessons = units.flatMap((u) => u.lessons);
      const completed = lessons.filter((l) => l.progress.length).length;
      const next = lessons.find((l) => !l.progress.length);
      return {
        id: course.id,
        title: course.title,
        description: course.description,
        color: course.color,
        subject: course.subject,
        teacher: course.teacher,
        lessonCount: lessons.length,
        completedCount: completed,
        percent: progressPercent(completed, lessons.length),
        nextLesson: next ? { id: next.id, title: next.title } : null,
      };
    });
  }

  @Get('courses/:id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.courses.currentStudent(user);
    const course = await this.prisma.course.findFirst({
      where: { id, schoolId: user.schoolId, sectionId: student.sectionId ?? '', isPublished: true },
      include: {
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
        units: {
          orderBy: ordered,
          select: {
            id: true,
            title: true,
            lessons: {
              where: { isPublished: true },
              orderBy: ordered,
              select: {
                id: true,
                title: true,
                kind: true,
                durationMin: true,
                progress: { where: { studentId: student.id }, select: { completedAt: true } },
              },
            },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    const units = course.units
      .filter((u) => u.lessons.length)
      .map((u) => ({
        id: u.id,
        title: u.title,
        lessons: u.lessons.map(({ progress, ...lesson }) => ({
          ...lesson,
          completed: progress.length > 0,
          completedAt: progress[0]?.completedAt ?? null,
        })),
      }));
    const lessons = units.flatMap((u) => u.lessons);
    const completed = lessons.filter((l) => l.completed).length;
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      color: course.color,
      subject: course.subject,
      teacher: course.teacher,
      lessonCount: lessons.length,
      completedCount: completed,
      percent: progressPercent(completed, lessons.length),
      units,
    };
  }

  @Get('lessons/:id')
  async lesson(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.courses.currentStudent(user);
    const { lesson, course, flat } = await this.visibleLesson(user, student.sectionId, id);
    const progress = await this.prisma.lessonProgress.findUnique({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId: student.id } },
      select: { completedAt: true },
    });
    const { prev, next } = neighbours(flat, lesson.id);
    return {
      ...CoursesService.withEmbed({
        id: lesson.id,
        title: lesson.title,
        kind: lesson.kind,
        body: lesson.body,
        url: lesson.url,
        durationMin: lesson.durationMin,
        publishedAt: lesson.publishedAt,
      }),
      completed: Boolean(progress),
      completedAt: progress?.completedAt ?? null,
      course: { id: course.id, title: course.title, color: course.color },
      unit: { id: lesson.unit.id, title: lesson.unit.title },
      prev: prev ? { id: prev.id, title: prev.title } : null,
      next: next ? { id: next.id, title: next.title } : null,
    };
  }

  /** Marks a lesson done (idempotent) and returns the new course percentage. */
  @Post('lessons/:id/complete')
  @Permission('elearning', 'view')
  async complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.courses.currentStudent(user);
    const { lesson, flat } = await this.visibleLesson(user, student.sectionId, id);
    const row = await this.prisma.lessonProgress.upsert({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId: student.id } },
      create: { lessonId: lesson.id, studentId: student.id },
      update: {},
    });
    const done = await this.prisma.lessonProgress.count({
      where: { studentId: student.id, lessonId: { in: flat.map((l) => l.id) } },
    });
    return {
      lessonId: lesson.id,
      completed: true,
      completedAt: row.completedAt,
      completedCount: done,
      lessonCount: flat.length,
      percent: progressPercent(done, flat.length),
    };
  }

  /** A published lesson of a published course in the student's section, plus the course's lessons in order. */
  private async visibleLesson(user: AuthUser, sectionId: string | null, lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isPublished: true,
        unit: { course: { schoolId: user.schoolId, sectionId: sectionId ?? '', isPublished: true } },
      },
      include: { unit: { select: { id: true, title: true, courseId: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: lesson.unit.courseId },
      select: {
        id: true,
        title: true,
        color: true,
        units: {
          orderBy: ordered,
          select: { lessons: { where: { isPublished: true }, orderBy: ordered, select: { id: true, title: true } } },
        },
      },
    });
    return { lesson, course, flat: course.units.flatMap((u) => u.lessons) };
  }
}
