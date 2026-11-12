import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WhatsAppLinkService } from '../notifications/whatsapp-link.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard } from './platform-access.guard.js';
import { logPlatform, logToSchool } from './platform-audit.js';

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/**
 * Console > school: the number the school linked by QR (Settings > Messaging)
 * and an Unlink. Switching linking on or off for a school is the
 * "WhatsApp by QR link" module in the school's modules.
 */
@Controller('platform/schools/:id/whatsapp')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformWhatsAppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly link: WhatsAppLinkService,
  ) {}

  @Get()
  async view(@Param('id') id: string) {
    await this.requireSchool(id);
    return this.link.consoleView(id);
  }

  @Post('unlink')
  @HttpCode(200)
  async unlink(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    await this.requireSchool(id);
    const before = await this.link.consoleView(id);
    await this.link.disconnect(id);
    await logPlatform(this.prisma, admin, 'school.whatsapp.unlink', id, { reason: body.reason, number: before.number });
    await logToSchool(this.prisma, admin, id, 'messaging.link.unlink', 'SchoolMessagingSender', id, { before: { number: before.number } });
    return this.link.consoleView(id);
  }

  private async requireSchool(id: string) {
    if (!(await this.prisma.school.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('School not found');
  }
}
