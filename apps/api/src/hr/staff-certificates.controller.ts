import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { adminScope, hasAnyRole, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { retryOnConflict } from '../common/serializable.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { nextSerial, verifyCode } from '../certificates/certificate-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { staffWhere } from './staff-where.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const issueSchema = z.object({
  userId: z.string().min(1),
  issuedOn: isoDate.optional(),
  /** Last working day. Leave out for someone still working here. */
  leftOn: isoDate.optional(),
  conduct: z.enum(['Excellent', 'Very good', 'Good', 'Satisfactory']).default('Good'),
  remarks: z.string().trim().max(300).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().min(3).max(200) });

/** What an experience certificate prints, kept as it was the day it was issued. */
export interface StaffCertificateDetails {
  staffName: string;
  employeeNo: string;
  designation: string;
  department: string | null;
  cnic: string | null;
  joinedOn: string;
  leftOn: string | null;
  conduct: string;
  remarks: string | null;
}

const include = {
  school: { select: { name: true, city: true, phone: true, email: true, logoUrl: true } },
  issuedBy: { select: { name: true } },
} satisfies Prisma.StaffCertificateInclude;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Experience certificates for staff, printed on the school letterhead and checkable online. */
@Controller('hr/experience-certificates')
@Permission('hr')
@RequiresFeature('hr')
@Roles(...SETUP_ROLES)
export class StaffCertificatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('userId') userId?: string) {
    const rows = await this.prisma.staffCertificate.findMany({
      where: {
        schoolId: user.schoolId,
        user: staffWhere(user.schoolId, adminScope(user)),
        ...(userId ? { userId } : {}),
      },
      orderBy: [{ issuedOn: 'desc' }, { serialNo: 'desc' }],
      take: 200,
      include: { user: { select: { name: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      serialNo: c.serialNo,
      issuedOn: iso(c.issuedOn),
      staffName: c.user.name,
      userId: c.userId,
      cancelled: !!c.cancelledAt,
    }));
  }

  @Post()
  async issue(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(issueSchema)) body: z.infer<typeof issueSchema>,
  ) {
    const staff = await this.prisma.user.findFirst({
      where: { id: body.userId, ...staffWhere(user.schoolId, adminScope(user)) },
      select: { name: true, staffProfile: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    if (body.userId === user.sub && !hasAnyRole(user, [Role.OWNER])) {
      throw new ForbiddenException('Someone else must issue your own certificate');
    }
    const profile = staff.staffProfile;
    if (!profile?.joinedOn) throw new ConflictException('Add the staff member’s joining date on the Staff tab first');
    const joinedOn = iso(profile.joinedOn);
    const issuedOn = body.issuedOn ?? localToday();
    if (body.leftOn && body.leftOn < joinedOn) throw new ConflictException('The last day cannot be before the joining date');
    if (!body.leftOn && profile.status === 'LEFT') {
      throw new ConflictException('This staff member has left; give their last working day');
    }
    const details: StaffCertificateDetails = {
      staffName: staff.name,
      employeeNo: profile.employeeNo,
      designation: profile.designation,
      department: profile.department,
      cnic: profile.cnic,
      joinedOn,
      leftOn: body.leftOn ?? null,
      conduct: body.conduct,
      remarks: body.remarks ?? null,
    };
    const year = Number(issuedOn.slice(0, 4));
    const created = await retryOnConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const existing = await tx.staffCertificate.findMany({
            where: { schoolId: user.schoolId },
            select: { serialNo: true },
          });
          return tx.staffCertificate.create({
            data: {
              schoolId: user.schoolId,
              userId: body.userId,
              serialNo: nextSerial('EXPERIENCE', year, existing.map((e) => e.serialNo)),
              verifyCode: verifyCode(),
              issuedOn: dayStart(issuedOn),
              details: details as unknown as Prisma.InputJsonValue,
              issuedById: user.sub,
            },
          });
        }),
      { codes: ['P2002'], attempts: 3 },
    );
    await this.audit.record(user, 'issue', 'StaffCertificate', created.id, { after: { serialNo: created.serialNo, userId: body.userId } });
    return this.get(user, created.id);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const c = await this.prisma.staffCertificate.findFirst({
      where: { id, schoolId: user.schoolId, user: staffWhere(user.schoolId, adminScope(user)) },
      include,
    });
    if (!c) throw new NotFoundException('Certificate not found');
    return {
      id: c.id,
      serialNo: c.serialNo,
      verifyCode: c.verifyCode,
      issuedOn: iso(c.issuedOn),
      cancelledAt: c.cancelledAt,
      cancelReason: c.cancelReason,
      details: c.details as unknown as StaffCertificateDetails,
      school: c.school,
      issuedBy: c.issuedBy.name,
      userId: c.userId,
    };
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: z.infer<typeof cancelSchema>,
  ) {
    await this.get(user, id);
    const { count } = await this.prisma.staffCertificate.updateMany({
      where: { id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelReason: body.reason },
    });
    if (!count) throw new ConflictException('This certificate is already cancelled');
    await this.audit.record(user, 'cancel', 'StaffCertificate', id, { after: { reason: body.reason } });
    return this.get(user, id);
  }
}
