import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { AttendanceStatus, LeaveStatus, LeaveType, PayrollStatus, Prisma, StaffStatus } from '@prisma/client';
import { z } from 'zod';
import { assertSchoolWide, campusScopeFor, FEE_ROLES, hasAnyRole, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { staffWhere } from './staff-where.js';
import { calculatePayslip, daysBetween, workingDays, type PayItem } from './payroll-calculator.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const runSchema = z.object({ period });
const paySchema = z.object({ method: z.enum(['CASH', 'BANK', 'CHEQUE']).default('BANK') });

const slipInclude = {
  user: {
    select: {
      name: true,
      staffProfile: {
        select: { employeeNo: true, designation: true, department: true, bankName: true, bankAccount: true },
      },
    },
  },
  run: { select: { id: true, period: true, status: true, school: { select: { name: true } } } },
} as const;

/**
 * Payroll is run for the whole school at once, so a campus-limited payroll
 * user sees and pays only the payslips of staff on their campuses and cannot
 * generate or finalise a month.
 */
const payrollScope = (user: AuthUser) => campusScopeFor(user, FEE_ROLES);

const slipsInScope = (user: AuthUser): Prisma.PayslipWhereInput => {
  const scope = payrollScope(user);
  return scope ? { user: staffWhere(user.schoolId, scope) } : {};
};
const WHOLE_SCHOOL = 'Only school-wide staff can run or finalise payroll';

@Controller('hr')
@Permission('hr')
@RequiresFeature('hr')
export class PayrollController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('payroll')
  @Roles(...FEE_ROLES)
  async runs(@CurrentUser() user: AuthUser) {
    const runs = await this.prisma.payrollRun.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { period: 'desc' },
      include: { payslips: { where: slipsInScope(user), select: { net: true, paidAt: true } } },
    });
    return runs.map(({ payslips, ...run }) => ({
      ...run,
      staff: payslips.length,
      totalNet: payslips.reduce((s, p) => s + p.net, 0),
      paid: payslips.filter((p) => p.paidAt).length,
    }));
  }

  /**
   * Works out every active staff member's pay for the month. Re-running a
   * draft recalculates it (after attendance or salary changes); a finalised
   * month is locked.
   */
  @Post('payroll')
  @Roles(...FEE_ROLES)
  async generate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(runSchema)) body: z.infer<typeof runSchema>,
  ) {
    assertSchoolWide(user, WHOLE_SCHOOL, FEE_ROLES);
    const existing = await this.prisma.payrollRun.findUnique({
      where: { schoolId_period: { schoolId: user.schoolId, period: body.period } },
    });
    if (existing?.status === PayrollStatus.FINALIZED) {
      throw new ConflictException('This month is finalised');
    }

    const days = workingDays(body.period);
    const monthStart = dayStart(`${body.period}-01`);
    const monthEnd = dayStart(days.at(-1) ?? `${body.period}-28`);
    const profiles = await this.prisma.staffProfile.findMany({
      where: { schoolId: user.schoolId, status: StaffStatus.ACTIVE, user: { isActive: true } },
      include: {
        payItems: true,
        user: {
          select: {
            staffAttendance: {
              where: { date: { gte: monthStart, lte: monthEnd } },
              select: { date: true, status: true },
            },
            leaveRequests: {
              where: {
                status: LeaveStatus.APPROVED,
                type: LeaveType.UNPAID,
                fromDate: { lte: monthEnd },
                toDate: { gte: monthStart },
              },
              select: { fromDate: true, toDate: true },
            },
          },
        },
      },
    });
    if (!profiles.length) throw new ConflictException('Add staff salary details on the Staff tab first');

    const slips = profiles.map((p) => {
      const working = new Set(days);
      const unpaid = new Set(
        p.user.staffAttendance
          .filter((a) => a.status === AttendanceStatus.ABSENT)
          .map((a) => a.date.toISOString().slice(0, 10)),
      );
      for (const leave of p.user.leaveRequests) {
        for (const d of daysBetween(leave.fromDate.toISOString().slice(0, 10), leave.toDate.toISOString().slice(0, 10))) {
          if (working.has(d)) unpaid.add(d);
        }
      }
      const slip = calculatePayslip({
        basic: p.basicSalary,
        items: p.payItems as PayItem[],
        unpaidDays: [...unpaid].filter((d) => working.has(d)).length,
        workingDays: days.length,
      });
      return { userId: p.userId, ...slip, lines: slip.lines as unknown as Prisma.InputJsonValue };
    });

    const run = await this.prisma.$transaction(async (tx) => {
      const r =
        existing ??
        (await tx.payrollRun.create({ data: { schoolId: user.schoolId, period: body.period } }));
      await tx.payslip.deleteMany({ where: { runId: r.id } });
      await tx.payslip.createMany({ data: slips.map((s) => ({ ...s, runId: r.id })) });
      return r;
    });
    await this.audit.record(user, existing ? 'recalculate' : 'create', 'PayrollRun', run.id, {
      after: { period: body.period, staff: slips.length },
    });
    return this.run(user, run.id);
  }

  @Get('payroll/:id')
  @Roles(...FEE_ROLES)
  async run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, schoolId: user.schoolId },
      include: { payslips: { where: slipsInScope(user), include: slipInclude, orderBy: { user: { name: 'asc' } } } },
    });
    if (!run) throw new NotFoundException('Payroll not found');
    return {
      ...run,
      workingDays: workingDays(run.period).length,
      totalNet: run.payslips.reduce((s, p) => s + p.net, 0),
    };
  }

  @Post('payroll/:id/finalize')
  @Roles(...FEE_ROLES)
  async finalize(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertSchoolWide(user, WHOLE_SCHOOL, FEE_ROLES);
    const run = await this.prisma.payrollRun.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!run) throw new NotFoundException('Payroll not found');
    if (run.status === PayrollStatus.FINALIZED) throw new ConflictException('Already finalised');
    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollStatus.FINALIZED, finalizedAt: new Date() },
    });
    await this.audit.record(user, 'finalize', 'PayrollRun', id);
    return this.run(user, id);
  }

  @Post('payroll/:id/payslips/:payslipId/pay')
  @Roles(...FEE_ROLES)
  async markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('payslipId') payslipId: string,
    @Body(new ZodValidationPipe(paySchema)) body: z.infer<typeof paySchema>,
  ) {
    const slip = await this.prisma.payslip.findFirst({
      where: { id: payslipId, runId: id, run: { schoolId: user.schoolId }, ...slipsInScope(user) },
      include: { run: true },
    });
    if (!slip) throw new NotFoundException('Payslip not found');
    if (slip.run.status !== PayrollStatus.FINALIZED) {
      throw new ConflictException('Finalise the month before paying salaries');
    }
    if (slip.paidAt) throw new ConflictException('Already paid');
    const paid = await this.prisma.payslip.update({
      where: { id: slip.id },
      data: { paidAt: new Date(), paymentMethod: body.method },
    });
    await this.audit.record(user, 'pay', 'Payslip', slip.id, { after: { net: slip.net, method: body.method } });
    return paid;
  }

  /** A staff member's own payslips, once the month is finalised. */
  @Get('payslips/mine')
  @Roles(...STAFF_ROLES)
  async mine(@CurrentUser() user: AuthUser) {
    return this.prisma.payslip.findMany({
      where: { userId: user.sub, run: { schoolId: user.schoolId, status: PayrollStatus.FINALIZED } },
      orderBy: { run: { period: 'desc' } },
      include: { run: { select: { period: true } } },
    });
  }

  @Get('payslips/:payslipId')
  @Roles(...STAFF_ROLES)
  async payslip(@CurrentUser() user: AuthUser, @Param('payslipId') payslipId: string) {
    const isPayroll = hasAnyRole(user, FEE_ROLES);
    const slip = await this.prisma.payslip.findFirst({
      where: {
        id: payslipId,
        run: { schoolId: user.schoolId, ...(isPayroll ? {} : { status: PayrollStatus.FINALIZED }) },
        ...(isPayroll ? { OR: [{ userId: user.sub }, slipsInScope(user)] } : { userId: user.sub }),
      },
      include: slipInclude,
    });
    if (!slip) throw new NotFoundException('Payslip not found');
    return { ...slip, workingDays: workingDays(slip.run.period).length };
  }
}
