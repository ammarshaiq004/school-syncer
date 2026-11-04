import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ContactKind } from '@prisma/client';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

/** A follow-up is listed from this many days ahead, so staff see what is coming. */
const FOLLOW_UP_DAYS_AHEAD = 7;

const contactSchema = z
  .object({
    kind: z.enum(ContactKind),
    note: z.string().trim().min(3).max(1000),
    promisedAmount: z.number().int().min(1).max(100_000_000).optional(),
    followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((c) => c.kind === ContactKind.PROMISE_TO_PAY || c.promisedAmount === undefined, {
    message: 'An amount only goes with a promise to pay',
    path: ['promisedAmount'],
  });

/** What SchoolSyncer staff did or were promised with a school, and the follow-ups due (SCHOOL-129). */
@Controller('platform')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('schools/:id/contacts')
  contacts(@Param('id') id: string) {
    return this.prisma.schoolContact.findMany({ where: { schoolId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Post('schools/:id/contacts')
  async add(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contactSchema)) body: z.infer<typeof contactSchema>,
  ) {
    if (body.followUpOn && body.followUpOn < localToday()) throw new BadRequestException('The follow-up date cannot be in the past');
    if (!(await this.prisma.school.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('School not found');
    const contact = await this.prisma.schoolContact.create({
      data: {
        schoolId: id,
        kind: body.kind,
        note: body.note,
        promisedAmount: body.promisedAmount ?? null,
        followUpOn: body.followUpOn ? dayStart(body.followUpOn) : null,
        adminId: admin.sub,
        adminName: admin.name,
      },
    });
    await logPlatform(this.prisma, admin, 'school.contact', id, { kind: body.kind, followUpOn: body.followUpOn ?? null });
    return contact;
  }

  /** Marks a follow-up as dealt with. */
  @Post('contacts/:contactId/done')
  async done(@CurrentAdmin() admin: PlatformUser, @Param('contactId') contactId: string) {
    const contact = await this.prisma.schoolContact.findUnique({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.schoolContact.updateMany({ where: { id: contactId, doneAt: null }, data: { doneAt: new Date() } });
    await logPlatform(this.prisma, admin, 'school.contact_done', contact.schoolId, { contactId });
    return this.prisma.schoolContact.findUniqueOrThrow({ where: { id: contactId } });
  }

  /** Open follow-ups due within the next week, soonest first; `overdue` once the day has passed. */
  @Get('follow-ups')
  async followUps() {
    const today = localToday();
    const rows = await this.prisma.schoolContact.findMany({
      where: { doneAt: null, followUpOn: { lte: dayStart(daysBefore(today, -FOLLOW_UP_DAYS_AHEAD)) } },
      include: { school: { select: { id: true, name: true, slug: true } } },
      orderBy: { followUpOn: 'asc' },
      take: 200,
    });
    return rows.map(({ school, ...c }) => ({ ...c, school, overdue: c.followUpOn!.toISOString().slice(0, 10) < today }));
  }
}
