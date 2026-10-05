import { Controller, Get, Query } from '@nestjs/common';
import { SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('notifications')
@Permission('messages')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Delivery log of outbound messages, newest first. */
  @Get()
  @Roles(...SETUP_ROLES)
  list(@CurrentUser() user: AuthUser, @Query('take') take = '100') {
    return this.prisma.notificationLog.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take) || 100, 500),
    });
  }
}
