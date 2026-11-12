import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { FEE_ROLES, campusScopeFor } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { creditEntry } from './credits.js';
import { applyOpeningBalance } from './opening-balance.js';

const entrySchema = z.object({
  studentId: z.string().min(1),
  /** Positive: money received ahead of a voucher. Negative: credit refunded or used up. */
  amount: z.number().int(),
  note: z.string().trim().max(200).optional(),
  /** The day the money was received (YYYY-MM-DD); defaults to today. */
  effectiveOn: z.iso.date().optional(),
});

const openingSchema = z.object({
  studentId: z.string().min(1),
  /** Positive: the student owes this much from before. Negative: the family is this far ahead. */
  amount: z.number().int().min(-10_000_000).max(10_000_000),
  note: z.string().trim().max(200).optional(),
  /** The day the balance stood (YYYY-MM-DD); defaults to today. */
  asOf: z.iso.date().optional(),
});

/** Advance credits: money a family paid ahead of any voucher, kept per student. */
@Controller('fees/credits')
@Permission('fees')
export class CreditsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async student(user: AuthUser, studentId: string) {
    const scope = campusScopeFor(user, FEE_ROLES);
    const found = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId, ...(scope ? { campusId: { in: scope } } : {}) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Student not found');
  }

  /** A student's credit and the entries behind it. */
  @Get()
  @Roles(...FEE_ROLES)
  async list(@CurrentUser() user: AuthUser, @Query('studentId') studentId: string) {
    await this.student(user, studentId);
    const entries = await this.prisma.studentCredit.findMany({
      where: { schoolId: user.schoolId, studentId },
      orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
    });
    return { balance: entries.reduce((s, e) => s + e.amount, 0), entries };
  }

  @Post()
  @Roles(...FEE_ROLES)
  async add(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(entrySchema)) body: z.infer<typeof entrySchema>) {
    await this.student(user, body.studentId);
    const held = await this.prisma.studentCredit.aggregate({
      where: { schoolId: user.schoolId, studentId: body.studentId },
      _sum: { amount: true },
    });
    const today = localToday();
    const effectiveOn = body.effectiveOn ?? today;
    const amount = creditEntry(body.amount, held._sum.amount ?? 0, effectiveOn, today);
    const entry = await this.prisma.studentCredit.create({
      data: {
        schoolId: user.schoolId,
        studentId: body.studentId,
        amount,
        note: body.note,
        effectiveOn: dayStart(effectiveOn),
        createdById: user.sub,
      },
    });
    await this.audit.record(user, 'credit.add', 'StudentCredit', entry.id, { after: entry });
    return entry;
  }

  /** A balance brought forward: arrears become a back-dated voucher, an advance becomes credit. */
  @Post('opening-balance')
  @Roles(...FEE_ROLES)
  async opening(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(openingSchema)) body: z.infer<typeof openingSchema>) {
    await this.student(user, body.studentId);
    const result = await this.prisma.$transaction((tx) =>
      applyOpeningBalance(tx, { schoolId: user.schoolId, ...body, userId: user.sub }),
    );
    await this.audit.record(user, 'opening_balance.set', 'Student', body.studentId, { after: { ...body, result } });
    return result ?? { kind: 'none' as const };
  }
}
