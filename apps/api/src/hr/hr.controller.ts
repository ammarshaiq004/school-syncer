import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AttendanceStatus,
  LeaveStatus,
  LeaveType,
  PayItemType,
  Prisma,
  Role,
  StaffStatus,
} from '@prisma/client';
import { z } from 'zod';
import { FEE_ROLES, hasAnyRole, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { daysBetween } from './payroll-calculator.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rupees = z.number().int().min(0).max(100_000_000);

const profileSchema = z.object({
  employeeNo: z.string().trim().min(1).max(30).optional(),
  designation: z.string().trim().min(2).max(60),
  department: z.string().trim().max(60).optional(),
  joinedOn: isoDate.optional(),
  cnic: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{7}-?\d$/, 'Use the 13-digit CNIC')
    .optional(),
  basicSalary: rupees,
  bankName: z.string().trim().max(60).optional(),
  bankAccount: z.string().trim().max(40).optional(),
  status: z.enum(StaffStatus).default(StaffStatus.ACTIVE),
  payItems: z
    .array(z.object({ name: z.string().trim().min(2).max(60), type: z.enum(PayItemType), amount: rupees }))
    .default([]),
});
const attendanceSchema = z.object({
  date: isoDate,
  records: z
    .array(
      z.object({
        userId: z.string().min(1),
        status: z.enum(AttendanceStatus),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1),
});
const leaveSchema = z
  .object({
    type: z.enum(LeaveType),
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().max(500).optional(),
  })
  .refine((l) => l.fromDate <= l.toDate, 'The leave must end on or after its first day');
const decideSchema = z.object({ approve: z.boolean() });

/** Anyone holding a staff role, as opposed to parents and students. */
const staffWhere = (schoolId: string): Prisma.UserWhereInput => ({
  schoolId,
  roles: { some: { role: { in: STAFF_ROLES } } },
});

@Controller('hr')
export class HrController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Staff records -------------------------------------------------------

  @Get('staff')
  @Roles(...FEE_ROLES)
  async staff(@CurrentUser() user: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: staffWhere(user.schoolId),
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        roles: { select: { role: true } },
        staffProfile: { include: { payItems: true } },
      },
    });
    return users;
  }

  /** Creates or updates a staff member's employment details and fixed pay items. */
  @Put('staff/:userId')
  @Roles(...SETUP_ROLES)
  async setProfile(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    const staff = await this.prisma.user.findFirst({
      where: { id: userId, ...staffWhere(user.schoolId) },
      include: { staffProfile: { include: { payItems: true } } },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const employeeNo =
      body.employeeNo ?? staff.staffProfile?.employeeNo ?? (await this.nextEmployeeNo(user.schoolId));
    const { payItems, ...fields } = body;
    const data = {
      ...fields,
      employeeNo,
      joinedOn: body.joinedOn ? dayStart(body.joinedOn) : null,
      cnic: body.cnic?.replace(/-/g, ''),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const profile = await tx.staffProfile.upsert({
          where: { userId },
          update: data,
          create: { ...data, schoolId: user.schoolId, userId },
        });
        await tx.staffPayItem.deleteMany({ where: { profileId: profile.id } });
        await tx.staffPayItem.createMany({
          data: payItems.map((i) => ({ ...i, profileId: profile.id })),
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Another staff member has this employee number');
      }
      throw e;
    }
    await this.audit.record(user, 'update', 'StaffProfile', userId, {
      before: staff.staffProfile,
      after: body,
    });
    return this.prisma.staffProfile.findUnique({ where: { userId }, include: { payItems: true } });
  }

  // ---- Staff attendance ----------------------------------------------------

  @Get('attendance')
  @Roles(...SETUP_ROLES)
  async attendanceSheet(
    @CurrentUser() user: AuthUser,
    @Query('date', new ZodValidationPipe(isoDate)) date: string,
  ) {
    const [staff, records] = await Promise.all([
      this.activeStaff(user.schoolId),
      this.prisma.staffAttendance.findMany({ where: { schoolId: user.schoolId, date: dayStart(date) } }),
    ]);
    return {
      date,
      taken: records.length > 0,
      staff: staff.map((s) => {
        const r = records.find((x) => x.userId === s.id);
        return {
          id: s.id,
          name: s.name,
          designation: s.staffProfile?.designation ?? null,
          status: r?.status ?? null,
          note: r?.note ?? null,
        };
      }),
    };
  }

  @Put('attendance')
  @Roles(...SETUP_ROLES)
  async saveAttendance(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(attendanceSchema)) body: z.infer<typeof attendanceSchema>,
  ) {
    const staffIds = new Set((await this.activeStaff(user.schoolId)).map((s) => s.id));
    if (body.records.some((r) => !staffIds.has(r.userId))) {
      throw new NotFoundException('Staff member not found');
    }
    const date = dayStart(body.date);
    await this.prisma.$transaction(
      body.records.map((r) =>
        this.prisma.staffAttendance.upsert({
          where: { userId_date: { userId: r.userId, date } },
          update: { status: r.status, note: r.note, markedById: user.sub },
          create: {
            schoolId: user.schoolId,
            userId: r.userId,
            date,
            status: r.status,
            note: r.note,
            markedById: user.sub,
          },
        }),
      ),
    );
    return { saved: body.records.length };
  }

  // ---- Leave ---------------------------------------------------------------

  /** Any staff member applies for their own leave. */
  @Post('leave')
  @Roles(...STAFF_ROLES)
  async applyLeave(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(leaveSchema)) body: z.infer<typeof leaveSchema>,
  ) {
    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        userId: user.sub,
        status: { not: LeaveStatus.REJECTED },
        fromDate: { lte: dayStart(body.toDate) },
        toDate: { gte: dayStart(body.fromDate) },
      },
    });
    if (overlapping) throw new ConflictException('You already have leave on some of these days');
    return this.prisma.leaveRequest.create({
      data: {
        schoolId: user.schoolId,
        userId: user.sub,
        type: body.type,
        fromDate: dayStart(body.fromDate),
        toDate: dayStart(body.toDate),
        reason: body.reason,
      },
    });
  }

  /** Administrators see every request; everyone else sees their own. */
  @Get('leave')
  @Roles(...STAFF_ROLES)
  async leave(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const parsed = z.enum(LeaveStatus).optional().safeParse(status || undefined);
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        schoolId: user.schoolId,
        ...(hasAnyRole(user, SETUP_ROLES) ? {} : { userId: user.sub }),
        ...(parsed.success && parsed.data ? { status: parsed.data } : {}),
      },
      orderBy: [{ status: 'asc' }, { fromDate: 'desc' }],
      include: { user: { select: { name: true } } },
    });
    return requests.map((r) => ({
      ...r,
      days: daysBetween(r.fromDate.toISOString().slice(0, 10), r.toDate.toISOString().slice(0, 10)).length,
    }));
  }

  /** Approving marks each working day of the leave on the staff register. */
  @Post('leave/:id/decide')
  @Roles(...SETUP_ROLES)
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== LeaveStatus.PENDING) throw new ConflictException('This request was already decided');
    if (request.userId === user.sub && !hasAnyRole(user, [Role.OWNER])) {
      throw new ForbiddenException('Someone else must decide your own leave');
    }
    const status = body.approve ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;
    const days = daysBetween(
      request.fromDate.toISOString().slice(0, 10),
      request.toDate.toISOString().slice(0, 10),
    );
    await this.prisma.$transaction([
      this.prisma.leaveRequest.update({
        where: { id },
        data: { status, decidedById: user.sub, decidedAt: new Date() },
      }),
      ...(body.approve
        ? days.map((d) =>
            this.prisma.staffAttendance.upsert({
              where: { userId_date: { userId: request.userId, date: dayStart(d) } },
              update: { status: AttendanceStatus.LEAVE, note: `${request.type.toLowerCase()} leave`, markedById: user.sub },
              create: {
                schoolId: user.schoolId,
                userId: request.userId,
                date: dayStart(d),
                status: AttendanceStatus.LEAVE,
                note: `${request.type.toLowerCase()} leave`,
                markedById: user.sub,
              },
            }),
          )
        : []),
    ]);
    await this.audit.record(user, status.toLowerCase(), 'LeaveRequest', id);
    return { status, days: days.length };
  }

  private activeStaff(schoolId: string) {
    return this.prisma.user.findMany({
      where: {
        ...staffWhere(schoolId),
        isActive: true,
        OR: [{ staffProfile: null }, { staffProfile: { status: StaffStatus.ACTIVE } }],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, staffProfile: { select: { designation: true } } },
    });
  }

  private async nextEmployeeNo(schoolId: string) {
    const count = await this.prisma.staffProfile.count({ where: { schoolId } });
    for (let n = count + 1; ; n++) {
      const candidate = `EMP-${String(n).padStart(4, '0')}`;
      const taken = await this.prisma.staffProfile.findFirst({ where: { schoolId, employeeNo: candidate } });
      if (!taken) return candidate;
    }
  }
}
