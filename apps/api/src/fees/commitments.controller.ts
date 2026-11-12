import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { FEE_ROLES, campusScopeFor } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkCommitment, commitmentsWithStatus } from './commitments.js';

const createSchema = z.object({
  studentId: z.string().min(1),
  amount: z.number().int().min(1).max(10_000_000),
  promisedOn: z.iso.date(),
  note: z.string().trim().max(200).optional(),
});
const remarkSchema = z.object({ remark: z.string().trim().max(300).nullable() });

/** Promise-to-pay commitments and the fee remark on a student's account. */
@Controller('fees')
@Permission('fees')
export class CommitmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(user: AuthUser) {
    const campuses = campusScopeFor(user, FEE_ROLES);
    return campuses ? { campusId: { in: campuses } } : {};
  }

  private async student(user: AuthUser, studentId: string) {
    const found = await this.prisma.student.findFirst({ where: { id: studentId, schoolId: user.schoolId, ...this.scope(user) }, select: { id: true } });
    if (!found) throw new NotFoundException('Student not found');
  }

  /** Commitments with kept / broken worked out; filter by student or by `due=today|open|broken`. */
  @Get('commitments')
  @Roles(...FEE_ROLES)
  async list(@CurrentUser() user: AuthUser, @Query('studentId') studentId?: string, @Query('due') due?: string) {
    const today = localToday();
    const rows = await commitmentsWithStatus(
      this.prisma,
      { schoolId: user.schoolId, student: this.scope(user), ...(studentId ? { studentId } : {}), ...(due === 'today' ? { promisedOn: dayStart(today) } : {}) },
      today,
    );
    return due === 'open' ? rows.filter((r) => r.status === 'PENDING') : due === 'broken' ? rows.filter((r) => r.status === 'BROKEN') : rows;
  }

  @Post('commitments')
  @Roles(...FEE_ROLES)
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    await this.student(user, body.studentId);
    checkCommitment(body.amount, body.promisedOn, localToday());
    const row = await this.prisma.feeCommitment.create({
      data: { schoolId: user.schoolId, studentId: body.studentId, amount: body.amount, promisedOn: dayStart(body.promisedOn), note: body.note, createdById: user.sub },
    });
    await this.audit.record(user, 'commitment.create', 'FeeCommitment', row.id, { after: row });
    return row;
  }

  @Delete('commitments/:id')
  @Roles(...FEE_ROLES)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const found = await this.prisma.feeCommitment.findFirst({ where: { id, schoolId: user.schoolId, cancelledAt: null, student: this.scope(user) } });
    if (!found) throw new NotFoundException('Commitment not found');
    const row = await this.prisma.feeCommitment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await this.audit.record(user, 'commitment.cancel', 'FeeCommitment', id, { before: found });
    return row;
  }

  @Put('students/:studentId/remark')
  @Roles(...FEE_ROLES)
  async remark(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Body(new ZodValidationPipe(remarkSchema)) body: z.infer<typeof remarkSchema>) {
    await this.student(user, studentId);
    const before = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { feeRemark: true } });
    const feeRemark = body.remark || null;
    await this.prisma.student.update({ where: { id: studentId }, data: { feeRemark } });
    await this.audit.record(user, 'fee_remark.set', 'Student', studentId, { before, after: { feeRemark } });
    return { feeRemark };
  }
}
