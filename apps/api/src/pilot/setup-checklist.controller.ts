import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { AllowWhenReadOnly, CurrentUser, Permission, Roles } from '../common/decorators.js';
import { OnlinePaymentsService } from '../fees/online-payments.service.js';
import { MessagingSenders } from '../notifications/senders.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checklistSummary, setupChecklist } from './setup-checklist.js';

const NON_OWNER_STAFF = STAFF_ROLES.filter((r) => r !== Role.OWNER);

/** The setup checklist card on the owner's dashboard (SCHOOL-150). */
@Controller('dashboard/setup-checklist')
@Permission('dashboard')
@Roles(Role.OWNER)
export class SetupChecklistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: MessagingSenders,
    private readonly payments: OnlinePaymentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const schoolId = user.schoolId;
    const currentYear = { schoolId, isCurrent: true };
    const [school, years, sections, activeStudents, feeHeads, feeStructures, staff, sender, online, attendanceSessions, vouchers] =
      await Promise.all([
        this.prisma.school.findUniqueOrThrow({
          where: { id: schoolId },
          select: { phone: true, city: true, setupChecklistDismissedAt: true },
        }),
        this.prisma.academicYear.count({ where: currentYear }),
        this.prisma.section.count({ where: { schoolId, academicYear: currentYear } }),
        this.prisma.student.count({ where: { schoolId, status: 'ACTIVE' } }),
        this.prisma.feeHead.count({ where: { schoolId } }),
        this.prisma.feeStructure.count({ where: { schoolId, academicYear: currentYear } }),
        this.prisma.user.count({
          where: { schoolId, isActive: true, roles: { some: { role: { in: NON_OWNER_STAFF } } } },
        }),
        this.senders.forSchool(schoolId),
        this.payments.options(schoolId),
        this.prisma.attendanceSession.count({ where: { schoolId } }),
        this.prisma.invoice.count({ where: { schoolId } }),
      ]);
    const items = setupChecklist({
      profile: Boolean(school.phone?.trim() && school.city?.trim()),
      currentYear: years > 0,
      sections,
      activeStudents,
      feeHeads,
      feeStructures,
      staff,
      messaging: sender.source !== 'log',
      // Mock checkouts are for trying the app out; they take no money.
      onlinePayments: (online.mode === 'live' || online.mode === 'sandbox') && online.providers.length > 0,
      attendanceSessions,
      vouchers,
    });
    return checklistSummary(items, school.setupChecklistDismissedAt);
  }

  /** Hides the card before everything is done; it can be brought back. */
  @Post('dismiss')
  @HttpCode(200)
  @AllowWhenReadOnly()
  async dismiss(@CurrentUser() user: AuthUser) {
    await this.prisma.school.update({ where: { id: user.schoolId }, data: { setupChecklistDismissedAt: new Date() } });
    await this.audit.record(user, 'setup_checklist.dismiss', 'School', user.schoolId);
    return this.get(user);
  }

  @Delete('dismiss')
  @AllowWhenReadOnly()
  async restore(@CurrentUser() user: AuthUser) {
    await this.prisma.school.update({ where: { id: user.schoolId }, data: { setupChecklistDismissedAt: null } });
    await this.audit.record(user, 'setup_checklist.restore', 'School', user.schoolId);
    return this.get(user);
  }
}
