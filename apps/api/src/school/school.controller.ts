import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SchoolMode } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** An optional field the form can clear: "" or null stores null. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable()).optional();

const updateSchoolSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  city: clearable(z.string().trim().max(80)),
  phone: clearable(z.string().trim().max(20)),
  email: clearable(z.email()),
  logoUrl: clearable(z.url()),
  locale: z.enum(['en', 'ur']).optional(),
  // Fees tab of System settings. Fine per day overdue, in PKR (0 = none).
  lateFeePerDay: z.number().int().min(0).max(100_000).optional(),
  // Day of the month monthly invoices fall due; capped to the month's last day.
  feeDueDay: z.number().int().min(1).max(31).optional(),
  // School mode tab: drives which modules the app shows (e-school vs campus-only).
  mode: z.enum(SchoolMode).optional(),
});
type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;

@Controller('school')
@Permission('settings')
export class SchoolController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      include: { _count: { select: { campuses: true, users: true } } },
    });
  }

  @Patch()
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateSchoolSchema)) body: UpdateSchoolInput,
  ) {
    const before = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
    });
    const after = await this.prisma.school.update({
      where: { id: user.schoolId },
      data: body,
    });
    await this.audit.record(user, 'school.update', 'School', after.id, {
      before,
      after,
    });
    return after;
  }
}
