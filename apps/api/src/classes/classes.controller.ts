import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
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
    await this.assertOwned('class', user, classId);
    await this.assertOwned('academicYear', user, body.academicYearId);
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
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
    });
    if (!section) throw new NotFoundException('section not found');
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
