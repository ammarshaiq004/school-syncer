import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { DiscountKind } from '@prisma/client';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    kind: z.enum(DiscountKind),
    value: z.number().int().min(1).max(10_000_000),
    schoolId: z.string().min(1).nullable().default(null),
    startsOn: day,
    endsOn: day.nullable().default(null),
  })
  .refine((d) => d.kind !== 'PERCENT' || d.value <= 100, { message: 'A percent discount cannot be more than 100', path: ['value'] })
  .refine((d) => !d.endsOn || d.endsOn >= d.startsOn, { message: 'The end date cannot be before the start date', path: ['endsOn'] });
const activeSchema = z.object({ isActive: z.boolean() });

/** Discounts off SchoolSyncer's bills (SCHOOL-154); owners create them, every staff member can read them. */
@Controller('platform/discounts')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformDiscountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.platformDiscount.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { uses: true } }, uses: { select: { amount: true } } },
      take: 200,
    });
    const schoolIds = rows.flatMap((r) => (r.schoolId ? [r.schoolId] : []));
    const schools = new Map(
      (await this.prisma.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]),
    );
    return rows.map(({ _count, uses, ...d }) => ({
      ...d,
      schoolName: d.schoolId ? (schools.get(d.schoolId) ?? null) : null,
      timesUsed: _count.uses,
      totalTaken: uses.reduce((sum, u) => sum + u.amount, 0),
    }));
  }

  @Post()
  @PlatformOwnerOnly()
  async create(@CurrentAdmin() admin: PlatformUser, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    if (body.schoolId && !(await this.prisma.school.findUnique({ where: { id: body.schoolId }, select: { id: true } })))
      throw new BadRequestException('No such school');
    const discount = await this.prisma.platformDiscount.create({
      data: { ...body, startsOn: dayStart(body.startsOn), endsOn: body.endsOn ? dayStart(body.endsOn) : null, createdBy: admin.name },
    });
    await logPlatform(this.prisma, admin, 'discount.create', body.schoolId, { name: body.name, kind: body.kind, value: body.value });
    return discount;
  }

  /** Switching a discount off stops new bills using it; bills already issued keep theirs. */
  @Patch(':id')
  @PlatformOwnerOnly()
  async setActive(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(activeSchema)) body: z.infer<typeof activeSchema>,
  ) {
    const found = await this.prisma.platformDiscount.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Discount not found');
    await logPlatform(this.prisma, admin, body.isActive ? 'discount.enable' : 'discount.disable', found.schoolId, { name: found.name });
    return this.prisma.platformDiscount.update({ where: { id }, data: { isActive: body.isActive } });
  }
}
