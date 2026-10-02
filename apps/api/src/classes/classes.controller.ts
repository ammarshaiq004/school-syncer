import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
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

@Controller('classes')
export class ClassesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('campusId') campusId?: string) {
    return this.prisma.class.findMany({
      where: { schoolId: user.schoolId, ...(campusId ? { campusId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        campus: { select: { id: true, name: true } },
        sections: {
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
