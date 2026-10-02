import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const updateSchoolSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  city: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.email().optional(),
  logoUrl: z.url().optional(),
  locale: z.enum(['en', 'ur']).optional(),
});
type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;

@Controller('school')
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
