import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { assertUnused } from '../common/in-use.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const subjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().max(20).optional(),
});
type SubjectInput = z.infer<typeof subjectSchema>;

const updateSubjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    /** null or "" clears the code. */
    code: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((c) => (c === '' ? null : c)),
  })
  .refine((b) => b.name !== undefined || b.code !== undefined, 'Nothing to change');
type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

/** Subjects are shared by every campus, so changing one is for school-wide admins. */
const SCHOOL_WIDE = 'Subjects are shared by every campus; ask a school-wide admin to change them';

@Controller('subjects')
@Permission('classes')
export class SubjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.subject.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(subjectSchema)) body: SubjectInput,
  ) {
    const subject = await this.prisma.subject.create({
      data: { ...body, schoolId: user.schoolId },
    });
    await this.audit.record(user, 'subject.create', 'Subject', subject.id, {
      after: subject,
    });
    return subject;
  }

  @Patch(':id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSubjectSchema)) body: UpdateSubjectInput,
  ) {
    assertSchoolWide(user, SCHOOL_WIDE);
    const before = await this.find(user, id);
    const after = await this.prisma.subject.update({ where: { id }, data: body });
    await this.audit.record(user, 'subject.update', 'Subject', id, { before, after });
    return after;
  }

  /** Deletes a subject no section, timetable, exam or e-school work uses. */
  @Delete(':id')
  @Roles(...SETUP_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertSchoolWide(user, SCHOOL_WIDE);
    const before = await this.find(user, id);
    const where = { subjectId: id };
    const [sections, papers, slots, homework, courses, live, assignments, quizzes, plans] = await Promise.all([
      this.prisma.sectionSubject.count({ where }),
      this.prisma.examPaper.count({ where }),
      this.prisma.timetableSlot.count({ where }),
      this.prisma.homework.count({ where }),
      this.prisma.course.count({ where }),
      this.prisma.liveClass.count({ where }),
      this.prisma.assignment.count({ where }),
      this.prisma.quiz.count({ where }),
      this.prisma.lessonPlan.count({ where }),
    ]);
    assertUnused(before.name, {
      section: sections,
      'exam paper': papers,
      'timetable slot': slots,
      'homework task': homework,
      course: courses,
      'live class': live,
      assignment: assignments,
      quiz: quizzes,
      'lesson plan': plans,
    });
    await this.prisma.subject.delete({ where: { id } });
    await this.audit.record(user, 'subject.delete', 'Subject', id, { before });
    return { deleted: true };
  }

  private async find(user: AuthUser, id: string) {
    const subject = await this.prisma.subject.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }
}
