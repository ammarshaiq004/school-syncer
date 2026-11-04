import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

const creditSchema = z.object({
  kind: z.enum(['REFERRAL', 'GOODWILL']),
  amount: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(3).max(200),
});

/** Credits waiting on a school's next bill: referral rewards and goodwill (SCHOOL-108), plus plan-change amounts. */
@Controller('platform/schools/:id/credits')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformCreditsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Param('id') id: string) {
    return this.prisma.platformAdjustment.findMany({
      where: { schoolId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { invoice: { select: { number: true } } },
    });
  }

  @Post()
  @PlatformOwnerOnly()
  async add(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(creditSchema)) body: z.infer<typeof creditSchema>,
  ) {
    if (!(await this.prisma.school.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('School not found');
    const credit = await this.prisma.platformAdjustment.create({
      data: { schoolId: id, kind: body.kind, amount: -body.amount, reason: body.reason, createdBy: admin.name },
    });
    await logPlatform(this.prisma, admin, 'credit.add', id, { kind: body.kind, amount: body.amount, reason: body.reason });
    return credit;
  }

  /** Takes back a credit that no bill has used yet. */
  @Delete(':creditId')
  @PlatformOwnerOnly()
  async remove(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Param('creditId') creditId: string) {
    const credit = await this.prisma.platformAdjustment.findFirst({ where: { id: creditId, schoolId: id } });
    if (!credit) throw new NotFoundException('Credit not found');
    if (credit.invoiceId) throw new ConflictException('A bill has already used this credit');
    await this.prisma.platformAdjustment.delete({ where: { id: creditId } });
    await logPlatform(this.prisma, admin, 'credit.remove', id, { kind: credit.kind, amount: credit.amount });
    return { removed: true };
  }
}
