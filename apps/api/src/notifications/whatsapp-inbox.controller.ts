import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { daysBefore, localToday, startOfLocalDay } from '../common/dates.js';
import { nextDay } from '../common/date-range.js';
import { CurrentUser, Permission, Public, Roles } from '../common/decorators.js';
import { normalizePhone } from '../common/identity.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsAppDriver } from './drivers.js';
import { MessagingSenders } from './senders.js';
import { canReply, deliveryReport, groupThreads, parseWebhook, validSignature } from './whatsapp-inbox.js';

const NOT_WIDE = 'Only school-wide administrators can use the WhatsApp inbox';
const replySchema = z.object({ text: z.string().trim().min(1).max(1000) });

/** Parents' WhatsApp messages to the school's number, and replies from it. */
@Controller('whatsapp')
@Roles(...SETUP_ROLES)
@Permission('messages')
export class WhatsappInboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: MessagingSenders,
  ) {}

  @Get('threads')
  async threads(@CurrentUser() user: AuthUser) {
    assertSchoolWide(user, NOT_WIDE);
    const rows = await this.prisma.whatsappMessage.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const threads = groupThreads(rows);
    const guardians = await this.guardiansByPhone(user.schoolId, threads.map((t) => t.phone));
    return threads.slice(0, 200).map((t) => ({ ...t, guardian: guardians.get(t.phone) ?? null }));
  }

  /** One conversation, oldest first; opening it marks the parent's messages read. */
  @Get('threads/:phone')
  async thread(@CurrentUser() user: AuthUser, @Param('phone') phone: string) {
    assertSchoolWide(user, NOT_WIDE);
    const messages = await this.prisma.whatsappMessage.findMany({
      where: { schoolId: user.schoolId, phone },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    await this.prisma.whatsappMessage.updateMany({
      where: { schoolId: user.schoolId, phone, direction: 'IN', readAt: null },
      data: { readAt: new Date() },
    });
    const lastIn = [...messages].reverse().find((m) => m.direction === 'IN');
    return {
      phone,
      guardian: (await this.guardiansByPhone(user.schoolId, [phone])).get(phone) ?? null,
      canReply: canReply(lastIn?.createdAt ?? null),
      messages,
    };
  }

  @Post('threads/:phone/reply')
  @HttpCode(200)
  async reply(
    @CurrentUser() user: AuthUser,
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(replySchema)) body: z.infer<typeof replySchema>,
  ) {
    assertSchoolWide(user, NOT_WIDE);
    const lastIn = await this.prisma.whatsappMessage.findFirst({
      where: { schoolId: user.schoolId, phone, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastIn) throw new BadRequestException('This number has not written to the school');
    if (!canReply(lastIn.createdAt)) {
      throw new BadRequestException(
        'WhatsApp only allows a free reply within 24 hours of the parent’s last message. Send a fee reminder or announcement instead.',
      );
    }
    const { driver } = await this.senders.forSchool(user.schoolId);
    if (!(driver instanceof WhatsAppDriver)) throw new BadRequestException('WhatsApp is not set up for this school');
    const sent = await driver.sendText(phone, body.text);
    return this.prisma.whatsappMessage.create({
      data: {
        schoolId: user.schoolId,
        phone,
        direction: 'OUT',
        body: body.text,
        providerMessageId: sent.providerMessageId ?? null,
        sentById: user.sub,
      },
    });
  }

  /** Delivery report for a period (default: the last 30 days) from the message log. */
  @Get('report')
  async report(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const end = to && day.test(to) ? to : localToday();
    const start = from && day.test(from) ? from : daysBefore(end, 29);
    const rows = await this.prisma.notificationLog.findMany({
      where: { schoolId: user.schoolId, createdAt: { gte: startOfLocalDay(start), lt: startOfLocalDay(nextDay(end)) } },
      select: { template: true, channel: true, status: true, error: true, createdAt: true, deliveredAt: true, readAt: true },
      take: 50_000,
    });
    const [received, replied] = await Promise.all([
      this.prisma.whatsappMessage.count({ where: { schoolId: user.schoolId, direction: 'IN', createdAt: { gte: startOfLocalDay(start), lt: startOfLocalDay(nextDay(end)) } } }),
      this.prisma.whatsappMessage.count({ where: { schoolId: user.schoolId, direction: 'OUT', createdAt: { gte: startOfLocalDay(start), lt: startOfLocalDay(nextDay(end)) } } }),
    ]);
    return { from: start, to: end, ...deliveryReport(rows), inbox: { received, replied } };
  }

  private async guardiansByPhone(schoolId: string, phones: string[]) {
    const local = new Map(phones.map((p) => [normalizePhone(`+${p}`) ?? '', p] as const));
    const guardians = await this.prisma.guardian.findMany({
      where: { schoolId, phone: { in: [...local.keys()].filter(Boolean) } },
      select: {
        phone: true,
        name: true,
        students: { select: { student: { select: { firstName: true, lastName: true } } } },
      },
    });
    return new Map(
      guardians.map((g) => [
        local.get(g.phone)!,
        { name: g.name, students: g.students.map((s) => [s.student.firstName, s.student.lastName].filter(Boolean).join(' ')) },
      ]),
    );
  }
}

/**
 * Meta's WhatsApp Cloud API webhook: set the callback URL to
 * /api/webhooks/whatsapp and the verify token to WHATSAPP_VERIFY_TOKEN; the
 * app secret (WHATSAPP_APP_SECRET) signs every delivery. Messages to a
 * school's own number go to that school; messages to the platform number go
 * to each school that has a guardian with the sender's phone.
 */
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
    if (!expected || mode !== 'subscribe' || token !== expected) throw new ForbiddenException('Verification failed');
    return challenge ?? '';
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Headers('x-hub-signature-256') signature: string | undefined, @Req() req: RawBodyRequest<Request>, @Body() payload: unknown) {
    const secret = process.env.WHATSAPP_APP_SECRET?.trim();
    if (!secret) throw new ServiceUnavailableException('WHATSAPP_APP_SECRET is not set');
    if (!req.rawBody || !validSignature(req.rawBody, signature, secret)) throw new UnauthorizedException('Bad signature');
    const { messages, receipts } = parseWebhook(payload);

    for (const r of receipts) {
      const at = r.at;
      if (r.status === 'delivered') await this.prisma.notificationLog.updateMany({ where: { providerMessageId: r.id, deliveredAt: null }, data: { deliveredAt: at } });
      else if (r.status === 'read') {
        await this.prisma.notificationLog.updateMany({ where: { providerMessageId: r.id, readAt: null }, data: { readAt: at } });
        await this.prisma.notificationLog.updateMany({ where: { providerMessageId: r.id, deliveredAt: null }, data: { deliveredAt: at } });
      } else if (r.status === 'failed') {
        await this.prisma.notificationLog.updateMany({ where: { providerMessageId: r.id, status: 'SENT' }, data: { status: 'FAILED', error: 'WhatsApp reported the message as not delivered' } });
      }
    }

    const platformNumber = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    for (const m of messages) {
      const own = await this.prisma.schoolMessagingSender.findFirst({ where: { phoneNumberId: m.phoneNumberId, enabled: true }, select: { schoolId: true } });
      let schoolIds: string[] = [];
      if (own) schoolIds = [own.schoolId];
      else if (platformNumber && m.phoneNumberId === platformNumber) {
        const local = normalizePhone(`+${m.from}`);
        const found = local ? await this.prisma.guardian.findMany({ where: { phone: local }, select: { schoolId: true } }) : [];
        schoolIds = [...new Set(found.map((g) => g.schoolId))];
      }
      for (const schoolId of schoolIds) {
        await this.prisma.whatsappMessage.createMany({
          data: [{ schoolId, phone: m.from, direction: 'IN', body: m.text, contactName: m.name, providerMessageId: m.id, createdAt: m.at }],
          skipDuplicates: true,
        });
      }
    }
    return { received: messages.length };
  }
}
