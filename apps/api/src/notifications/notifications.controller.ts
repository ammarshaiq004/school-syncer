import { Controller, Get, Query } from '@nestjs/common';
import { SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MessagingSenders } from './senders.js';

@Controller('notifications')
@Permission('messages')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: MessagingSenders,
  ) {}

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

  /** How the school's messages go out now: its own WhatsApp number, the platform's, or nowhere (log only). */
  @Get('delivery')
  @Roles(...SETUP_ROLES)
  async delivery(@CurrentUser() user: AuthUser) {
    const { source, driver } = await this.senders.forSchool(user.schoolId);
    return { source, channel: driver.kind === 'log' ? null : driver.channel, delivers: source !== 'log' };
  }
}
