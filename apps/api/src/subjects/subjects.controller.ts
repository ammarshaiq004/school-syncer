import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const subjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().max(20).optional(),
});
type SubjectInput = z.infer<typeof subjectSchema>;

@Controller('subjects')
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
}
