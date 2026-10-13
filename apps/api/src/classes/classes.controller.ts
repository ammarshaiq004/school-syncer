import {
  BadRequestException,
  Body,
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
import { z } from 'zod';
import { administers, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { assertUnused } from '../common/in-use.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const classSchema = z.object({
  campusId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  sortOrder: z.number().int().min(0).default(0),
});
type ClassInput = z.infer<typeof classSchema>;

const sectionSchema = z.object({
  academicYearId: z.string().min(1),
  name: z.string().trim().min(1).max(20),
  capacity: z.number().int().positive().optional(),
  classTeacherId: z.string().optional(),
});
type SectionInput = z.infer<typeof sectionSchema>;

const nothing = (b: object) => Object.values(b).some((v) => v !== undefined);

const updateClassSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine(nothing, 'Nothing to change');
type UpdateClassInput = z.infer<typeof updateClassSchema>;

const updateSectionSchema = z
  .object({
    name: z.string().trim().min(1).max(20).optional(),
    capacity: z.number().int().positive().nullable().optional(),
    /** null clears the class teacher. */
    classTeacherId: z.string().min(1).nullable().optional(),
  })
  .refine(nothing, 'Nothing to change');
type UpdateSectionInput = z.infer<typeof updateSectionSchema>;

const sectionSubjectsSchema = z.object({
  subjects: z.array(
    z.object({
      subjectId: z.string().min(1),
      teacherId: z.string().min(1).nullable().optional(),
    }),
  ),
});
type SectionSubjectsInput = z.infer<typeof sectionSubjectsSchema>;

@Controller('classes')
@Permission('classes')
export class ClassesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('campusId') campusId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    // Sections belong to a year: this year's unless another is asked for, so
    // next year's (set up before promotions) don't show twice in pickers.
    return this.prisma.class.findMany({
      where: { schoolId: user.schoolId, ...(campusId ? { campusId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        campus: { select: { id: true, name: true } },
        sections: {
          where: academicYearId
            ? { academicYearId }
            : { academicYear: { isCurrent: true } },
          orderBy: { name: 'asc' },
          include: { classTeacher: { select: { id: true, name: true } } },
        },
      },
    });
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(classSchema)) body: ClassInput,
  ) {
    await this.assertOwned('campus', user, body.campusId);
    this.assertCampus(user, body.campusId);
    const created = await this.prisma.class.create({
      data: { ...body, schoolId: user.schoolId },
    });
    await this.audit.record(user, 'class.create', 'Class', created.id, {
      after: created,
    });
    return created;
  }

  @Post(':id/sections')
  @Roles(...SETUP_ROLES)
  async addSection(
    @CurrentUser() user: AuthUser,
    @Param('id') classId: string,
    @Body(new ZodValidationPipe(sectionSchema)) body: SectionInput,
  ) {
    const cls = await this.findClass(user, classId);
    await this.assertOwned('academicYear', user, body.academicYearId);
    this.assertCampus(user, cls.campusId);
    if (body.classTeacherId) {
      await this.assertOwned('user', user, body.classTeacherId);
    }
    const section = await this.prisma.section.create({
      data: { ...body, classId, schoolId: user.schoolId },
    });
    await this.audit.record(user, 'section.create', 'Section', section.id, {
      after: section,
    });
    return section;
  }

  /** Renames a class or changes where it is listed. */
  @Patch(':id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClassSchema)) body: UpdateClassInput,
  ) {
    const before = await this.findClass(user, id);
    this.assertCampus(user, before.campusId);
    const after = await this.prisma.class.update({ where: { id }, data: body });
    await this.audit.record(user, 'class.update', 'Class', id, { before, after });
    return after;
  }

  /** Deletes a class nothing uses yet (no sections in any year, fees, applications or exam papers). */
  @Delete(':id')
  @Roles(...SETUP_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const before = await this.findClass(user, id);
    this.assertCampus(user, before.campusId);
    const [sections, fees, applications, papers] = await Promise.all([
      this.prisma.section.count({ where: { classId: id } }),
      this.prisma.feeStructure.count({ where: { classId: id } }),
      this.prisma.application.count({ where: { classId: id } }),
      this.prisma.examPaper.count({ where: { classId: id } }),
    ]);
    assertUnused(before.name, { section: sections, 'fee amount': fees, application: applications, 'exam paper': papers });
    await this.prisma.class.delete({ where: { id } });
    await this.audit.record(user, 'class.delete', 'Class', id, { before });
    return { deleted: true };
  }

  /** Renames a section, changes its seats, or sets or clears its class teacher. */
  @Patch('sections/:sectionId')
  @Roles(...SETUP_ROLES)
  async updateSection(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(updateSectionSchema)) body: UpdateSectionInput,
  ) {
    const before = await this.findSection(user, sectionId);
    if (body.classTeacherId) await this.assertOwned('user', user, body.classTeacherId);
    if (body.capacity) {
      const enrolled = await this.prisma.enrollment.count({ where: { sectionId, status: 'ACTIVE' } });
      if (enrolled > body.capacity) {
        throw new BadRequestException(`${enrolled} students are already in this section; seats can't be fewer`);
      }
    }
    const { class: _class, ...plain } = before;
    const after = await this.prisma.section.update({
      where: { id: sectionId },
      data: body,
      include: { classTeacher: { select: { id: true, name: true } } },
    });
    await this.audit.record(user, 'section.update', 'Section', sectionId, { before: plain, after });
    return after;
  }

  /**
   * Deletes a section nothing has used yet. Once students are enrolled or
   * attendance, exams, timetable or e-school work exist, it stays.
   */
  @Delete('sections/:sectionId')
  @Roles(...SETUP_ROLES)
  async removeSection(@CurrentUser() user: AuthUser, @Param('sectionId') sectionId: string) {
    const before = await this.findSection(user, sectionId);
    const where = { sectionId };
    const [students, days, results, slots, homework, courses, live, assignments, quizzes, plans] = await Promise.all([
      this.prisma.enrollment.count({ where }),
      this.prisma.attendanceSession.count({ where }),
      this.prisma.examResult.count({ where }),
      this.prisma.timetableSlot.count({ where }),
      this.prisma.homework.count({ where }),
      this.prisma.course.count({ where }),
      this.prisma.liveClass.count({ where }),
      this.prisma.assignment.count({ where }),
      this.prisma.quiz.count({ where }),
      this.prisma.lessonPlan.count({ where }),
    ]);
    assertUnused(`${before.class.name} ${before.name}`, {
      student: students,
      'attendance day': days,
      'exam result': results,
      'timetable slot': slots,
      'homework task': homework,
      course: courses,
      'live class': live,
      assignment: assignments,
      quiz: quizzes,
      'lesson plan': plans,
    });
    await this.prisma.section.delete({ where: { id: sectionId } });
    const { class: _class, ...plain } = before;
    await this.audit.record(user, 'section.delete', 'Section', sectionId, { before: plain });
    return { deleted: true };
  }

  /** Subjects taught in a section and who teaches each. */
  @Get('sections/:sectionId/subjects')
  @Roles(...STAFF_ROLES)
  async sectionSubjects(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
  ) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
    });
    if (!section) throw new NotFoundException('section not found');
    const rows = await this.prisma.sectionSubject.findMany({
      where: { sectionId },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        teacher: { select: { id: true, name: true } },
      },
    });
    return rows.sort((a, b) => a.subject.name.localeCompare(b.subject.name));
  }

  /** Replaces the section's subject list and teachers. */
  @Put('sections/:sectionId/subjects')
  @Roles(...SETUP_ROLES)
  async setSectionSubjects(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(sectionSubjectsSchema))
    body: SectionSubjectsInput,
  ) {
    await this.findSection(user, sectionId);
    const subjectIds = [...new Set(body.subjects.map((s) => s.subjectId))];
    const teacherIds = [
      ...new Set(
        body.subjects
          .map((s) => s.teacherId)
          .filter((t): t is string => Boolean(t)),
      ),
    ];
    const [subjects, teachers] = await Promise.all([
      this.prisma.subject.count({
        where: { id: { in: subjectIds }, schoolId: user.schoolId },
      }),
      this.prisma.user.count({
        where: { id: { in: teacherIds }, schoolId: user.schoolId },
      }),
    ]);
    if (subjects !== subjectIds.length)
      throw new NotFoundException('subject not found');
    if (teachers !== teacherIds.length)
      throw new NotFoundException('user not found');

    const before = await this.prisma.sectionSubject.findMany({
      where: { sectionId },
    });
    await this.prisma.$transaction([
      this.prisma.sectionSubject.deleteMany({
        where: { sectionId, subjectId: { notIn: subjectIds } },
      }),
      ...body.subjects.map((s) =>
        this.prisma.sectionSubject.upsert({
          where: { sectionId_subjectId: { sectionId, subjectId: s.subjectId } },
          update: { teacherId: s.teacherId ?? null },
          create: {
            schoolId: user.schoolId,
            sectionId,
            subjectId: s.subjectId,
            teacherId: s.teacherId ?? null,
          },
        }),
      ),
    ]);
    await this.audit.record(user, 'section.subjects', 'Section', sectionId, {
      before,
      after: body.subjects,
    });
    return this.sectionSubjects(user, sectionId);
  }

  private async findClass(user: AuthUser, id: string) {
    const found = await this.prisma.class.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!found) throw new NotFoundException('class not found');
    return found;
  }

  /** A section of this school on a campus the user administers. */
  private async findSection(user: AuthUser, id: string) {
    const found = await this.prisma.section.findFirst({
      where: { id, schoolId: user.schoolId },
      include: { class: true },
    });
    if (!found) throw new NotFoundException('section not found');
    this.assertCampus(user, found.class.campusId);
    return found;
  }

  /** Campus-limited admins set up only their own campuses. */
  private assertCampus(user: AuthUser, campusId: string) {
    if (!administers(user, campusId)) {
      throw new ForbiddenException('That campus is not yours to manage');
    }
  }

  /** Guards against ids from another school being linked into this one. */
  private async assertOwned(
    model: 'campus' | 'class' | 'academicYear' | 'user',
    user: AuthUser,
    id: string,
  ) {
    const where = { id, schoolId: user.schoolId };
    const found =
      model === 'campus'
        ? await this.prisma.campus.findFirst({ where })
        : model === 'class'
          ? await this.prisma.class.findFirst({ where })
          : model === 'academicYear'
            ? await this.prisma.academicYear.findFirst({ where })
            : await this.prisma.user.findFirst({ where });
    if (!found) throw new NotFoundException(`${model} not found`);
  }
}
