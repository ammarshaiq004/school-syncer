import { Controller, Get, Query } from '@nestjs/common';
import { StaffStatus, StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { localToday } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { staffWhere } from '../hr/staff-where.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { birthdaysInMonth } from './birthdays.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthQuery = z.coerce.number().int().min(1).max(12).optional();

/** Lists of people for the school office: birthdays, localities, class information and the staff register. */
@Controller('reports/people')
@Permission('reports')
@RequiresFeature('reports')
@Roles(...SETUP_ROLES)
export class PeopleReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Students' and staff birthdays in a month (this month by default). */
  @Get('birthdays')
  async birthdays(@CurrentUser() user: AuthUser, @Query('month', new ZodValidationPipe(monthQuery)) month?: number) {
    const scope = adminScope(user);
    const today = localToday();
    const m = month ?? Number(today.slice(5, 7));
    const [students, staff] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId: user.schoolId, status: StudentStatus.ACTIVE, dateOfBirth: { not: null }, ...(scope ? { campusId: { in: scope } } : {}) },
        select: {
          firstName: true,
          lastName: true,
          admissionNo: true,
          dateOfBirth: true,
          enrollments: { where: { status: 'ACTIVE' }, take: 1, orderBy: { createdAt: 'desc' }, select: { section: { select: { name: true, class: { select: { name: true } } } } } },
        },
      }),
      this.prisma.user.findMany({
        where: { ...staffWhere(user.schoolId, scope), isActive: true, staffProfile: { is: { status: StaffStatus.ACTIVE, dateOfBirth: { not: null } } } },
        select: { name: true, staffProfile: { select: { employeeNo: true, designation: true, dateOfBirth: true } } },
      }),
    ]);
    const people = [
      ...students.map((s) => {
        const sec = s.enrollments[0]?.section;
        return {
          kind: 'student' as const,
          name: [s.firstName, s.lastName].filter(Boolean).join(' '),
          ref: s.admissionNo,
          detail: sec ? `${sec.class.name} ${sec.name}` : 'Not enrolled',
          dateOfBirth: iso(s.dateOfBirth!),
        };
      }),
      ...staff.map((u) => ({ kind: 'staff' as const, name: u.name, ref: u.staffProfile!.employeeNo, detail: u.staffProfile!.designation, dateOfBirth: iso(u.staffProfile!.dateOfBirth!) })),
    ];
    return { month: m, today, people: birthdaysInMonth(people, m, Number(today.slice(0, 4))) };
  }
}
