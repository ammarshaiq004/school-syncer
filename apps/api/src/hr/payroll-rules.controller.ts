import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { LeaveStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { adminScope, assertSchoolWide, FEE_ROLES, hasAnyRole, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_RULES, minutesOf, TIME_PATTERN } from './payroll-rules.js';
import { staffWhere } from './staff-where.js';

const time = z.string().regex(TIME_PATTERN, 'Use HH:MM, for example 08:30');
const rulesSchema = z.object({
  shiftStart: time,
  graceMinutes: z.number().int().min(0).max(120),
  latesPerDeduction: z.number().int().min(0).max(31),
  lateDeductionPercent: z.number().int().min(0).max(300),
  freeShortLeaves: z.number().int().min(0).max(31),
  shortLeaveDeductionPercent: z.number().int().min(0).max(300),
});
const shortLeaveSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    fromTime: time,
    toTime: time,
    reason: z.string().trim().max(300).optional(),
  })
  .refine((l) => minutesOf(l.fromTime) < minutesOf(l.toTime), 'The short leave must end after it starts');
const decideSchema = z.object({ approve: z.boolean() });

/** Late-arrival and short-leave rules for payroll, and staff short leave requests. */
@Controller('hr')
@Permission('hr')
@RequiresFeature('hr')
export class PayrollRulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('payroll-rules')
  @Roles(...FEE_ROLES)
  async rules(@CurrentUser() user: AuthUser) {
    const saved = await this.prisma.payrollRules.findUnique({ where: { schoolId: user.schoolId } });
    if (!saved) return DEFAULT_RULES;
    const { schoolId: _s, updatedAt: _u, ...rules } = saved;
    return rules;
  }

  @Put('payroll-rules')
  @Roles(...SETUP_ROLES)
  async saveRules(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(rulesSchema)) body: z.infer<typeof rulesSchema>,
  ) {
    assertSchoolWide(user, 'Only school-wide admins can change payroll rules');
    await this.prisma.payrollRules.upsert({
      where: { schoolId: user.schoolId },
      update: body,
      create: { ...body, schoolId: user.schoolId },
    });
    await this.audit.record(user, 'update', 'PayrollRules', user.schoolId, { after: body });
    return body;
  }

  /** Any staff member asks for a few hours off within one day. */
  @Post('short-leave')
  @Roles(...STAFF_ROLES)
  @Permission('hr', 'view')
  async apply(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(shortLeaveSchema)) body: z.infer<typeof shortLeaveSchema>,
  ) {
    const clash = await this.prisma.shortLeave.findFirst({
      where: {
        userId: user.sub,
        date: dayStart(body.date),
        status: { not: LeaveStatus.REJECTED },
        fromTime: { lt: body.toTime },
        toTime: { gt: body.fromTime },
      },
    });
    if (clash) throw new ConflictException('You already have a short leave at those hours');
    return this.prisma.shortLeave.create({
      data: {
        schoolId: user.schoolId,
        userId: user.sub,
        date: dayStart(body.date),
        fromTime: body.fromTime,
        toTime: body.toTime,
        reason: body.reason,
      },
    });
  }

  /** Administrators see every request on their campuses; everyone else sees their own. */
  @Get('short-leave')
  @Roles(...STAFF_ROLES)
  async list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const parsed = z.enum(LeaveStatus).optional().safeParse(status || undefined);
    const scope = adminScope(user);
    return this.prisma.shortLeave.findMany({
      where: {
        schoolId: user.schoolId,
        ...(hasAnyRole(user, SETUP_ROLES)
          ? scope
            ? { OR: [{ userId: user.sub }, { user: staffWhere(user.schoolId, scope) }] }
            : {}
          : { userId: user.sub }),
        ...(parsed.success && parsed.data ? { status: parsed.data } : {}),
      },
      orderBy: [{ status: 'asc' }, { date: 'desc' }],
      take: 200,
      include: { user: { select: { name: true } } },
    });
  }

  @Post('short-leave/:id/decide')
  @Roles(...SETUP_ROLES)
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>,
  ) {
    const request = await this.prisma.shortLeave.findFirst({
      where: { id, schoolId: user.schoolId, user: staffWhere(user.schoolId, adminScope(user)) },
    });
    if (!request) throw new NotFoundException('Short leave not found');
    if (request.userId === user.sub && !hasAnyRole(user, [Role.OWNER])) {
      throw new ForbiddenException('Someone else must decide your own short leave');
    }
    const status = body.approve ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;
    // Only a pending request can be decided, so two admins cannot both win.
    const { count } = await this.prisma.shortLeave.updateMany({
      where: { id, status: LeaveStatus.PENDING },
      data: { status, decidedById: user.sub, decidedAt: new Date() },
    });
    if (!count) throw new ConflictException('This request was already decided');
    await this.audit.record(user, status.toLowerCase(), 'ShortLeave', id);
    return { status };
  }
}
