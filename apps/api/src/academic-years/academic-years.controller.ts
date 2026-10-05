import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
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
}
