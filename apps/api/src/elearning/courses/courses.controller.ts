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
  Put,
  Query,
} from '@nestjs/common';
import { FilePurpose, LessonKind, Prisma, type StoredFile } from '@prisma/client';
import { z } from 'zod';
import { administers, ATTENDANCE_ROLES, hasAnyRole, SETUP_ROLES, STAFF_ROLES } from '../../common/admin-roles.js';
import { AuditService } from '../../common/audit.service.js';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { FileKind } from '../files/file-rules.js';
import { FilesService } from '../files/files.service.js';
import { teacherGrantInScope } from '../teacher-grant.js';
import { isHttpsUrl, lessonContentProblem, progressPercent, reorderProblem } from './course-rules.js';
import { courseSummary, CoursesService } from './courses.service.js';

const color = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4F46E5');
const httpsUrl = z.string().trim().max(2000).refine(isHttpsUrl, 'Links must start with https://');

const createCourseSchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  color: color.optional(),
  teacherId: z.string().min(1).optional(),
});
const generateSchema = z.object({ sectionId: z.string().min(1) });
const updateCourseSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  color: color.nullable().optional(),
  isPublished: z.boolean().optional(),
  teacherId: z.string().min(1).nullable().optional(),
});
const unitSchema = z.object({ title: z.string().trim().min(1).max(120) });
const orderSchema = z.object({ ids: z.array(z.string().min(1)).max(500) });
const lessonFields = {
  title: z.string().trim().min(1).max(160),
  kind: z.enum(LessonKind),
  body: z.string().max(20000).nullable().optional(),
  url: httpsUrl.nullable().optional(),
  fileId: z.string().min(1).nullable().optional(),
  durationMin: z.number().int().min(1).max(600).nullable().optional(),
  isPublished: z.boolean().optional(),
};
const createLessonSchema = z.object({ ...lessonFields, kind: lessonFields.kind.default('TEXT') });
const updateLessonSchema = z
  .object({ ...lessonFields, unitId: z.string().min(1) })
  .partial();
const publishSchema = z.object({ isPublished: z.boolean() });

type CreateCourse = z.infer<typeof createCourseSchema>;
type UpdateCourse = z.infer<typeof updateCourseSchema>;
type CreateLesson = z.infer<typeof createLessonSchema>;
type UpdateLesson = z.infer<typeof updateLessonSchema>;

/** What an uploaded lesson file may be, by lesson kind. */
const LESSON_FILE_KINDS: Partial<Record<LessonKind, FileKind[]>> = {
  VIDEO: ['video'],
  DOCUMENT: ['document', 'image', 'audio'],
};

/**
 * Course builder for teachers and admins: courses per section subject, their
 * units and lessons (ordered, publishable) and a students x lessons progress
 * matrix. Reads are open to staff; writes to teachers and SETUP roles, scoped
 * by CoursesService.
 */
@Controller('elearning')
@Permission('elearning')
@RequiresFeature('elearning')
export class ElearningCoursesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  @Get('courses')
  @Roles(...STAFF_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    const rows = await this.prisma.course.findMany({
      where: {
        AND: [
          await this.courses.scopeWhere(user),
          sectionId ? { sectionId } : {},
          subjectId ? { subjectId } : {},
        ],
      },
      include: {
        ...courseSummary,
        units: { select: { _count: { select: { lessons: true } } } },
      },
      orderBy: [{ section: { class: { sortOrder: 'asc' } } }, { section: { name: 'asc' } }, { title: 'asc' }],
    });
    const completion = await this.courses.completionByCourse(rows);
    const canManage = hasAnyRole(user, ATTENDANCE_ROLES);
    return rows.map(({ units, ...course }) => {
      const stats = completion.get(course.id);
      return {
        ...course,
        unitCount: units.length,
        lessonCount: units.reduce((sum, u) => sum + u._count.lessons, 0),
        publishedLessonCount: stats?.publishedLessons ?? 0,
        studentCount: stats?.students ?? 0,
        avgCompletion: stats?.avgPercent ?? 0,
        canManage,
      };
    });
  }

  @Post('courses')
  @Roles(...ATTENDANCE_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCourseSchema)) body: CreateCourse,
  ) {
    const { section, manageable } = await this.courses.sectionForCourses(user, body.sectionId);
    const taught = section.subjects.find((s) => s.subjectId === body.subjectId);
    if (!taught) throw new NotFoundException('This subject is not taught in this section');
    if (!manageable.includes(taught)) throw new ForbiddenException('You do not teach this subject in this section');
    const isAdmin = administers(user, section.class.campusId);
    let teacherId = taught.teacherId ?? (isAdmin ? null : user.sub);
    if (body.teacherId !== undefined) {
      if (!isAdmin) throw new ForbiddenException('Only admins can choose the teacher');
      teacherId = await this.staffUser(user, body.teacherId);
    }
    const existing = await this.prisma.course.findUnique({
      where: { sectionId_subjectId: { sectionId: section.id, subjectId: body.subjectId } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('This section already has a course for this subject');
    const course = await this.prisma.course.create({
      data: {
        schoolId: user.schoolId,
        academicYearId: section.academicYearId,
        sectionId: section.id,
        subjectId: body.subjectId,
        teacherId,
        title: body.title ?? taught.subject.name,
        description: body.description,
        color: body.color,
      },
      include: courseSummary,
    });
    await this.audit.record(user, 'course.create', 'Course', course.id, { after: course });
    return course;
  }

  /** One course for every subject of the section the user may manage that has none yet. */
  @Post('courses/generate')
  @Roles(...ATTENDANCE_ROLES)
  async generate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>,
  ) {
    const { section, manageable } = await this.courses.sectionForCourses(user, body.sectionId);
    const existing = new Set(
      (await this.prisma.course.findMany({ where: { sectionId: section.id }, select: { subjectId: true } })).map(
        (c) => c.subjectId,
      ),
    );
    const missing = manageable.filter((s) => !existing.has(s.subjectId));
    await this.prisma.course.createMany({
      data: missing.map((s) => ({
        schoolId: user.schoolId,
        academicYearId: section.academicYearId,
        sectionId: section.id,
        subjectId: s.subjectId,
        teacherId: s.teacherId ?? (hasAnyRole(user, SETUP_ROLES) ? null : user.sub),
        title: s.subject.name,
      })),
      skipDuplicates: true,
    });
    const courses = await this.prisma.course.findMany({
      where: { sectionId: section.id, subjectId: { in: missing.map((s) => s.subjectId) } },
      include: courseSummary,
      orderBy: { title: 'asc' },
    });
    if (courses.length) {
      await this.audit.record(user, 'course.generate', 'Section', section.id, {
        after: courses.map((c) => ({ id: c.id, title: c.title })),
      });
    }
    return { created: courses.length, courses };
  }

  /** The course with every unit and lesson (drafts included), in order. */
  @Get('courses/:id')
  @Roles(...STAFF_ROLES)
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const course = await this.courses.courseInScope(user, id);
    const [units, students] = await Promise.all([
      this.prisma.courseUnit.findMany({
        where: { courseId: course.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { lessons: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { file: true } } },
      }),
      this.prisma.enrollment.count({ where: { sectionId: course.sectionId, status: 'ACTIVE' } }),
    ]);
    const links = await this.files.links(units.flatMap((u) => u.lessons.map((l) => l.file)));
    return {
      ...course,
      studentCount: students,
      canManage: hasAnyRole(user, ATTENDANCE_ROLES),
      units: units.map((u) => ({
        ...u,
        lessons: u.lessons.map(({ file, ...l }) => ({
          ...CoursesService.withEmbed(l),
          file: file ? (links.get(file.id) ?? null) : null,
        })),
      })),
    };
  }

  @Patch('courses/:id')
  @Roles(...ATTENDANCE_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCourseSchema)) body: UpdateCourse,
  ) {
    const before = await this.courses.courseInScope(user, id);
    const data: Prisma.CourseUncheckedUpdateInput = {
      title: body.title,
      description: body.description,
      color: body.color,
      isPublished: body.isPublished,
    };
    if (body.teacherId !== undefined) {
      if (!administers(user, before.section.class.campusId)) {
        throw new ForbiddenException('Only admins can change the teacher');
      }
      data.teacherId = body.teacherId === null ? null : await this.staffUser(user, body.teacherId);
    }
    const course = await this.prisma.course.update({ where: { id: before.id }, data, include: courseSummary });
    await this.audit.record(user, 'course.update', 'Course', course.id, { before, after: course });
    return course;
  }

  @Delete('courses/:id')
  @Roles(...ATTENDANCE_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const course = await this.courses.courseInScope(user, id);
    const fileIds = await this.files.lessonFileIds({ courseId: course.id });
    await this.prisma.course.delete({ where: { id: course.id } });
    await this.files.release(fileIds);
    await this.audit.record(user, 'course.delete', 'Course', course.id, { before: course });
    return { deleted: true };
  }

  // Units

  @Post('courses/:id/units')
  @Roles(...ATTENDANCE_ROLES)
  async addUnit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(unitSchema)) body: z.infer<typeof unitSchema>,
  ) {
    const course = await this.courses.courseInScope(user, id);
    const last = await this.prisma.courseUnit.aggregate({ where: { courseId: course.id }, _max: { sortOrder: true } });
    const unit = await this.prisma.courseUnit.create({
      data: { courseId: course.id, title: body.title, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await this.audit.record(user, 'course.unit.create', 'CourseUnit', unit.id, { after: unit });
    return { ...unit, lessons: [] };
  }

  @Put('courses/:id/units/order')
  @Roles(...ATTENDANCE_ROLES)
  async reorderUnits(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ) {
    const course = await this.courses.courseInScope(user, id);
    const units = await this.prisma.courseUnit.findMany({ where: { courseId: course.id }, select: { id: true } });
    const problem = reorderProblem(units.map((u) => u.id), body.ids);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction(
      body.ids.map((unitId, sortOrder) => this.prisma.courseUnit.update({ where: { id: unitId }, data: { sortOrder } })),
    );
    return { ids: body.ids };
  }

  @Patch('units/:unitId')
  @Roles(...ATTENDANCE_ROLES)
  async renameUnit(
    @CurrentUser() user: AuthUser,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(unitSchema)) body: z.infer<typeof unitSchema>,
  ) {
    const unit = await this.courses.unitInScope(user, unitId);
    const updated = await this.prisma.courseUnit.update({ where: { id: unit.id }, data: { title: body.title } });
    await this.audit.record(user, 'course.unit.update', 'CourseUnit', unit.id, {
      before: { title: unit.title },
      after: { title: updated.title },
    });
    return updated;
  }

  /** Deletes the unit and its lessons. */
  @Delete('units/:unitId')
  @Roles(...ATTENDANCE_ROLES)
  async removeUnit(@CurrentUser() user: AuthUser, @Param('unitId') unitId: string) {
    const unit = await this.courses.unitInScope(user, unitId);
    const fileIds = await this.files.lessonFileIds({ unitId: unit.id });
    await this.prisma.courseUnit.delete({ where: { id: unit.id } });
    await this.files.release(fileIds);
    await this.audit.record(user, 'course.unit.delete', 'CourseUnit', unit.id, { before: unit });
    return { deleted: true };
  }

  // Lessons

  @Post('units/:unitId/lessons')
  @Roles(...ATTENDANCE_ROLES)
  async addLesson(
    @CurrentUser() user: AuthUser,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(createLessonSchema)) body: CreateLesson,
  ) {
    const unit = await this.courses.unitInScope(user, unitId);
    const problem = lessonContentProblem(body);
    if (problem) throw new BadRequestException(problem);
    if (body.fileId) await this.files.claim(user, body.fileId, FilePurpose.LESSON, LESSON_FILE_KINDS[body.kind]);
    const last = await this.prisma.lesson.aggregate({ where: { unitId: unit.id }, _max: { sortOrder: true } });
    const lesson = await this.prisma.lesson.create({
      data: {
        unitId: unit.id,
        title: body.title,
        kind: body.kind,
        body: body.body?.trim() || null,
        url: body.url || null,
        fileId: body.fileId || null,
        durationMin: body.durationMin ?? null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        isPublished: body.isPublished ?? false,
        publishedAt: body.isPublished ? new Date() : null,
      },
    });
    await this.audit.record(user, 'course.lesson.create', 'Lesson', lesson.id, { after: lessonSnapshot(lesson) });
    return this.present(lesson);
  }

  @Put('units/:unitId/lessons/order')
  @Roles(...ATTENDANCE_ROLES)
  async reorderLessons(
    @CurrentUser() user: AuthUser,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ) {
    const unit = await this.courses.unitInScope(user, unitId);
    const lessons = await this.prisma.lesson.findMany({ where: { unitId: unit.id }, select: { id: true } });
    const problem = reorderProblem(lessons.map((l) => l.id), body.ids);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction(
      body.ids.map((lessonId, sortOrder) => this.prisma.lesson.update({ where: { id: lessonId }, data: { sortOrder } })),
    );
    return { ids: body.ids };
  }

  /** Edits a lesson; `unitId` moves it to the end of another unit of the same course. */
  @Patch('lessons/:id')
  @Roles(...ATTENDANCE_ROLES)
  async updateLesson(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLessonSchema)) body: UpdateLesson,
  ) {
    const lesson = await this.courses.lessonInScope(user, id);
    const merged = {
      kind: body.kind ?? lesson.kind,
      body: body.body === undefined ? lesson.body : body.body,
      url: body.url === undefined ? lesson.url : body.url,
      fileId: body.fileId === undefined ? lesson.fileId : body.fileId,
    };
    const problem = lessonContentProblem(merged);
    if (problem) throw new BadRequestException(problem);
    const fileChanged = body.fileId !== undefined && body.fileId !== lesson.fileId;
    if (merged.fileId && (fileChanged || merged.kind !== lesson.kind)) {
      if (fileChanged) await this.files.claim(user, merged.fileId, FilePurpose.LESSON, LESSON_FILE_KINDS[merged.kind]);
      else await this.assertFileFits(merged.fileId, merged.kind);
    }
    const data: Prisma.LessonUncheckedUpdateInput = {
      title: body.title,
      kind: body.kind,
      body: body.body === undefined ? undefined : body.body?.trim() || null,
      url: body.url === undefined ? undefined : body.url || null,
      fileId: fileChanged ? body.fileId || null : undefined,
      durationMin: body.durationMin,
      ...this.publishChange(lesson, body.isPublished),
    };
    if (body.unitId && body.unitId !== lesson.unitId) {
      const target = await this.prisma.courseUnit.findFirst({
        where: { id: body.unitId, courseId: lesson.unit.courseId },
      });
      if (!target) throw new BadRequestException('Lessons can only move between units of the same course');
      const last = await this.prisma.lesson.aggregate({ where: { unitId: target.id }, _max: { sortOrder: true } });
      data.unitId = target.id;
      data.sortOrder = (last._max.sortOrder ?? -1) + 1;
    }
    const updated = await this.prisma.lesson.update({ where: { id: lesson.id }, data });
    await this.audit.record(user, 'course.lesson.update', 'Lesson', lesson.id, {
      before: lessonSnapshot(lesson),
      after: lessonSnapshot(updated),
    });
    if (fileChanged) await this.files.release([lesson.fileId]);
    return this.present(updated);
  }

  @Put('lessons/:id/publish')
  @Roles(...ATTENDANCE_ROLES)
  async publishLesson(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishSchema)) body: z.infer<typeof publishSchema>,
  ) {
    const lesson = await this.courses.lessonInScope(user, id);
    const updated = await this.prisma.lesson.update({
      where: { id: lesson.id },
      data: this.publishChange(lesson, body.isPublished),
    });
    if (updated.isPublished !== lesson.isPublished) {
      await this.audit.record(
        user,
        updated.isPublished ? 'course.lesson.publish' : 'course.lesson.unpublish',
        'Lesson',
        lesson.id,
        { before: { isPublished: lesson.isPublished }, after: { isPublished: updated.isPublished } },
      );
    }
    return this.present(updated);
  }

  @Delete('lessons/:id')
  @Roles(...ATTENDANCE_ROLES)
  async removeLesson(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const lesson = await this.courses.lessonInScope(user, id);
    await this.prisma.lesson.delete({ where: { id: lesson.id } });
    await this.files.release([lesson.fileId]);
    await this.audit.record(user, 'course.lesson.delete', 'Lesson', lesson.id, { before: lesson });
    return { deleted: true };
  }

  /** Students x lessons: who completed which lesson, with a percentage over published lessons. */
  @Get('courses/:id/progress')
  @Roles(...STAFF_ROLES)
  async progress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const course = await this.courses.courseInScope(user, id);
    const [units, enrolled] = await Promise.all([
      this.prisma.courseUnit.findMany({
        where: { courseId: course.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          lessons: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, title: true, kind: true, isPublished: true },
          },
        },
      }),
      this.courses.sectionStudents(course.sectionId),
    ]);
    const lessons = units.flatMap((u) => u.lessons.map((l) => ({ ...l, unitId: u.id, unitTitle: u.title })));
    const published = new Set(lessons.filter((l) => l.isPublished).map((l) => l.id));
    const progress = await this.prisma.lessonProgress.findMany({
      where: { lessonId: { in: lessons.map((l) => l.id) }, studentId: { in: enrolled.map((e) => e.student.id) } },
      select: { lessonId: true, studentId: true, completedAt: true },
    });
    const students = enrolled.map(({ rollNo, student }) => {
      const completed: Record<string, Date> = {};
      for (const p of progress) if (p.studentId === student.id) completed[p.lessonId] = p.completedAt;
      const done = Object.keys(completed).filter((lessonId) => published.has(lessonId)).length;
      return {
        id: student.id,
        name: [student.firstName, student.lastName].filter(Boolean).join(' '),
        admissionNo: student.admissionNo,
        rollNo,
        completed,
        completedCount: done,
        percent: progressPercent(done, published.size),
      };
    });
    return {
      course: { id: course.id, title: course.title, section: course.section, subject: course.subject },
      units: units.map((u) => ({ id: u.id, title: u.title })),
      lessons,
      publishedLessonCount: published.size,
      students,
      avgPercent: students.length
        ? Math.round(students.reduce((sum, s) => sum + s.percent, 0) / students.length)
        : 0,
    };
  }

  /** A lesson as staff see it: player URL for video links and a fresh link to its uploaded file. */
  private async present<T extends { url: string | null; fileId: string | null }>(lesson: T) {
    const file: StoredFile | null = lesson.fileId
      ? await this.prisma.storedFile.findUnique({ where: { id: lesson.fileId } })
      : null;
    return { ...CoursesService.withEmbed(lesson), file: file ? await this.files.link(file) : null };
  }

  /** Changing a lesson's kind keeps its file only when the file suits the new kind. */
  private async assertFileFits(fileId: string, kind: LessonKind) {
    const file = await this.prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
    const fits = LESSON_FILE_KINDS[kind];
    const fileKind = FilesService.view(file).kind;
    if (!fits || !fileKind || !fits.includes(fileKind)) {
      throw new BadRequestException('The uploaded file does not suit this lesson type. Remove it or upload another.');
    }
  }

  private publishChange(
    lesson: { isPublished: boolean; publishedAt: Date | null },
    isPublished: boolean | undefined,
  ): Prisma.LessonUncheckedUpdateInput {
    if (isPublished === undefined || isPublished === lesson.isPublished) return {};
    return isPublished ? { isPublished: true, publishedAt: new Date() } : { isPublished: false };
  }

  /** A staff user of this school who can teach; returns their id. */
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
    if (!teacher) throw new BadRequestException('Choose a teacher from this school');
    return teacher.id;
  }
}

/** The audited fields of a lesson (no body text, which can be long). */
function lessonSnapshot(l: {
  unitId: string;
  title: string;
  kind: string;
  url: string | null;
  fileId: string | null;
  durationMin: number | null;
  isPublished: boolean;
}) {
  const { unitId, title, kind, url, fileId, durationMin, isPublished } = l;
  return { unitId, title, kind, url, fileId, durationMin, isPublished };
}
