import { Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';
import { AllowWhenReadOnly, CurrentUser, Roles } from '../common/decorators.js';
import { UserStatusService } from '../common/user-status.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The school owner sees SchoolSyncer staff signed in to the school, and can end it early (SCHOOL-142). */
@Controller('support-sessions')
@Roles(Role.OWNER)
export class SupportSessionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly status: UserStatusService,
  ) {}

  /** Sessions still open: not ended and not expired. */
  @Get()
  @AllowWhenReadOnly()
  async open(@CurrentUser() user: AuthUser) {
    if (user.support) return [];
    return this.prisma.supportSession.findMany({
      where: { schoolId: user.schoolId, endedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, adminName: true, scope: true, reason: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post(':id/end')
  @AllowWhenReadOnly()
  async end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    // Staff cannot end (or hide) a session from inside it.
    if (user.support) throw new ForbiddenException('Only the school owner can end a support session');
    const { count } = await this.prisma.supportSession.updateMany({
      where: { id, schoolId: user.schoolId, endedAt: null },
      data: { endedAt: new Date(), endedBy: user.name },
    });
    if (!count) throw new NotFoundException('That support session is not open');
    this.status.forgetSession(id);
    await this.prisma.auditLog.create({
      data: { schoolId: user.schoolId, userId: user.sub, action: 'platform.support_ended', entity: 'SupportSession', entityId: id },
    });
    return { ended: true };
  }
}
