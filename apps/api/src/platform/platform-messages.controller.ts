import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PlatformMessageAudience, PlatformMessageTarget, PlatformNoticeSeverity, PlatformRole, Role } from '@prisma/client';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillingService } from './billing/billing.service.js';
import { recipientsWhere } from './messages.js';
import { PlatformAccessGuard } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

const audienceSchema = z.object({
  target: z.enum(PlatformMessageTarget),
  schoolIds: z.array(z.string().min(1)).max(500).default([]),
  audience: z.enum(PlatformMessageAudience),
});
// The preview is a GET, so the chosen schools come as one comma-separated list.
const previewSchema = audienceSchema.extend({
  schoolIds: z.string().default('').transform((v) => v.split(',').filter(Boolean)),
});
const sendSchema = audienceSchema.extend({
  severity: z.enum(PlatformNoticeSeverity),
  title: z.string().trim().min(3).max(100),
  body: z.string().trim().min(5).max(1000),
});

type Audience = z.infer<typeof audienceSchema>;

const closing = 'You can read this again under Plan and billing in SchoolSyncer.';

/** SchoolSyncer staff writing to schools (SCHOOL-155): shown in the app and sent by SMS and email. */
@Controller('platform/messages')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformMessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  list() {
    return this.prisma.platformMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** How many schools and people a message would reach, before anything is sent. */
  @Get('preview')
  async preview(@Query(new ZodValidationPipe(previewSchema)) body: z.output<typeof previewSchema>) {
    const schoolIds = await this.schools(body);
    return { schools: schoolIds.length, people: await this.people(body.audience, schoolIds) };
  }

  @Post()
  async send(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(sendSchema)) body: z.infer<typeof sendSchema>,
  ) {
    if (body.target === 'ALL' && admin.role !== PlatformRole.OWNER) {
      throw new ForbiddenException('Only a SchoolSyncer owner can message every school');
    }
    const schoolIds = await this.schools(body);
    if (!schoolIds.length) throw new BadRequestException('No school matches this audience');
    const { title, body: text, severity, target, audience } = body;
    const message = await this.prisma.platformMessage.create({
      data: {
        title,
        body: text,
        severity,
        target,
        audience,
        schoolIds: target === 'CHOSEN' ? body.schoolIds : [],
        schools: schoolIds.length,
        sentBy: admin.name,
      },
    });
    // shortcut: one school at a time in this request; fine for hundreds of schools, move to the job queue beyond that.
    for (const schoolId of schoolIds) {
      await this.billing.notify(schoolId, {
        kind: 'message',
        severity,
        title,
        body: text,
        dedupeKey: `${message.id}:message:${schoolId}`,
        audience: audience === 'STAFF' ? 'staff' : 'owners',
        footer: closing,
      });
    }
    await logPlatform(this.prisma, admin, 'message.send', null, { id: message.id, title, target, audience, severity, schools: schoolIds.length });
    return message;
  }

  private async schools(a: Audience) {
    if (a.target === 'CHOSEN' && !a.schoolIds.length) throw new BadRequestException('Pick at least one school');
    const rows = await this.prisma.subscription.findMany({ where: recipientsWhere(a.target, a.schoolIds, new Date()), select: { schoolId: true } });
    return rows.map((r) => r.schoolId);
  }

  private people(audience: PlatformMessageAudience, schoolIds: string[]) {
    return this.prisma.user.count({
      where: {
        schoolId: { in: schoolIds },
        isActive: true,
        roles: { some: { role: audience === 'STAFF' ? { notIn: [Role.PARENT, Role.STUDENT] } : Role.OWNER } },
      },
    });
  }
}
