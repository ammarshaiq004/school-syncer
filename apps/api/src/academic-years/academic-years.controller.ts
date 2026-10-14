import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { assertUnused } from '../common/in-use.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const academicYearSchema = z
  .object({
    name: z.string().trim().min(4).max(20),
    startsOn: z.coerce.date(),
    endsOn: z.coerce.date(),
    isCurrent: z.boolean().default(false),
  })
  .refine((y) => y.endsOn > y.startsOn, {
    message: 'End date must be after start date',
    path: ['endsOn'],
  });
type AcademicYearInput = z.infer<typeof academicYearSchema>;

const updateYearSchema = z
  .object({
    name: z.string().trim().min(4).max(20).optional(),
    startsOn: z.coerce.date().optional(),
    endsOn: z.coerce.date().optional(),
    /** Only true: making another year current is how this one stops being current. */
    isCurrent: z.literal(true).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
type UpdateYearInput = z.infer<typeof updateYearSchema>;

/** Years are school-wide (every campus runs on the same one). */
const SCHOOL_WIDE = 'Academic years are shared by every campus; ask a school-wide admin to change them';

@Controller('academic-years')
@Permission('classes')
export class AcademicYearsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.academicYear.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { startsOn: 'desc' },
    });
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(academicYearSchema)) body: AcademicYearInput,
  ) {
    // Only one year is current at a time.
    const year = await this.prisma.$transaction(async (tx) => {
      if (body.isCurrent) {
        await tx.academicYear.updateMany({
          where: { schoolId: user.schoolId },
          data: { isCurrent: false },
        });
      }
      return tx.academicYear.create({
        data: { ...body, schoolId: user.schoolId },
      });
    });
    await this.audit.record(user, 'academic_year.create', 'AcademicYear', year.id, {
      after: year,
    });
    return year;
  }

  /** Renames a year, corrects its dates, or makes it the current year. */
  @Patch(':id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateYearSchema)) body: UpdateYearInput,
  ) {
    assertSchoolWide(user, SCHOOL_WIDE);
    const before = await this.find(user, id);
    if ((body.endsOn ?? before.endsOn) <= (body.startsOn ?? before.startsOn)) {
      throw new BadRequestException('End date must be after start date');
    }
    const after = await this.prisma.$transaction(async (tx) => {
      if (body.isCurrent) {
        await tx.academicYear.updateMany({
          where: { schoolId: user.schoolId, id: { not: id } },
          data: { isCurrent: false },
        });
      }
      return tx.academicYear.update({ where: { id }, data: body });
    });
    await this.audit.record(user, 'academic_year.update', 'AcademicYear', id, { before, after });
    return after;
  }

  /** Deletes a year set up by mistake: never the current one, and only while nothing is in it. */
  @Delete(':id')
  @Roles(...SETUP_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertSchoolWide(user, SCHOOL_WIDE);
    const before = await this.find(user, id);
    if (before.isCurrent) {
      throw new ConflictException('This is the current year. Make another year current before deleting it.');
    }
    const where = { academicYearId: id };
    const [sections, students, fees, promotions, exams, courses] = await Promise.all([
      this.prisma.section.count({ where }),
      this.prisma.enrollment.count({ where }),
      this.prisma.feeStructure.count({ where }),
      this.prisma.promotion.count({ where: { fromYearId: id } }),
      this.prisma.exam.count({ where }),
      this.prisma.course.count({ where }),
    ]);
    assertUnused(before.name, {
      section: sections,
      enrollment: students,
      'fee amount': fees,
      promotion: promotions,
      exam: exams,
      course: courses,
    });
    await this.prisma.academicYear.delete({ where: { id } });
    await this.audit.record(user, 'academic_year.delete', 'AcademicYear', id, { before });
    return { deleted: true };
  }

  private async find(user: AuthUser, id: string) {
    const year = await this.prisma.academicYear.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!year) throw new NotFoundException('Academic year not found');
    return year;
  }
}
