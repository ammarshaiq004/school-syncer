import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const campusSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(250).optional(),
  phone: z.string().trim().max(20).optional(),
});
type CampusInput = z.infer<typeof campusSchema>;

@Controller('campuses')
export class CampusesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.campus.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { classes: true } } },
    });
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(campusSchema)) body: CampusInput,
  ) {
    await this.subscriptions.assertCampusRoom(user.schoolId);
    const campus = await this.prisma.campus.create({
      data: { ...body, schoolId: user.schoolId },
    });
    await this.audit.record(user, 'campus.create', 'Campus', campus.id, {
      after: campus,
    });
    return campus;
  }

  @Patch(':id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(campusSchema.partial())) body: Partial<CampusInput>,
  ) {
    const before = await this.findOwned(user, id);
    const after = await this.prisma.campus.update({ where: { id }, data: body });
    await this.audit.record(user, 'campus.update', 'Campus', id, { before, after });
    return after;
  }

  @Delete(':id')
  @Roles(...SETUP_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const before = await this.findOwned(user, id);
    await this.prisma.campus.delete({ where: { id } });
    await this.audit.record(user, 'campus.delete', 'Campus', id, { before });
    return { deleted: true };
  }

  private async findOwned(user: AuthUser, id: string) {
    const campus = await this.prisma.campus.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!campus) throw new NotFoundException('Campus not found');
    return campus;
  }
}
