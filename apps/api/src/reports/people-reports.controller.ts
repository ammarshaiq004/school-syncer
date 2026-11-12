import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
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
import { localitySummary } from './localities.js';

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

  /**
   * Active students by the area they live in. With `localityId` (or `none`
   * for students with no area) it also lists that area's students with a
   * parent's name and number.
   */
  @Get('localities')
  async localities(@CurrentUser() user: AuthUser, @Query('localityId') localityId?: string) {
    const scope = adminScope(user);
    const where = { schoolId: user.schoolId, status: StudentStatus.ACTIVE, ...(scope ? { campusId: { in: scope } } : {}) };
    const all = await this.prisma.student.findMany({ where, select: { gender: true, localityId: true, locality: { select: { name: true } } } });
    const summary = localitySummary(all.map((s) => ({ localityId: s.localityId, localityName: s.locality?.name ?? null, gender: s.gender })));
    if (!localityId) return { localities: summary, students: [] };
    const students = await this.prisma.student.findMany({
      where: { ...where, localityId: localityId === 'none' ? null : localityId },
      orderBy: [{ firstName: 'asc' }],
      take: 1000,
      select: {
        firstName: true,
        lastName: true,
        admissionNo: true,
        address: true,
        enrollments: { where: { status: 'ACTIVE' }, take: 1, orderBy: { createdAt: 'desc' }, select: { section: { select: { name: true, class: { select: { name: true } } } } } },
        guardians: { orderBy: { isPrimary: 'desc' }, take: 1, select: { relation: true, guardian: { select: { name: true, phone: true } } } },
      },
    });
    return {
      localities: summary,
      students: students.map((s) => ({
        name: [s.firstName, s.lastName].filter(Boolean).join(' '),
        admissionNo: s.admissionNo,
        section: s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}` : 'Not enrolled',
        address: s.address ?? '',
        guardian: s.guardians[0] ? `${s.guardians[0].guardian.name} (${s.guardians[0].relation})` : '',
        phone: s.guardians[0]?.guardian.phone ?? '',
      })),
    };
  }

  /** Everything the office keeps about a section's students on one sheet: a class list to print or file. */
  @Get('class-info')
  async classInfo(@CurrentUser() user: AuthUser, @Query('sectionId', new ZodValidationPipe(z.string().min(1))) sectionId: string) {
    const scope = adminScope(user);
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, class: { schoolId: user.schoolId, ...(scope ? { campusId: { in: scope } } : {}) } },
      select: { name: true, class: { select: { name: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId, status: 'ACTIVE', student: { schoolId: user.schoolId } },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
      select: {
        rollNo: true,
        student: {
          select: {
            admissionNo: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            bFormNo: true,
            address: true,
            admittedOn: true,
            locality: { select: { name: true } },
            guardians: { orderBy: { isPrimary: 'desc' }, take: 2, select: { relation: true, guardian: { select: { name: true, phone: true } } } },
          },
        },
      },
    });
    return {
      section: `${section.class.name} ${section.name}`,
      students: enrollments.map(({ rollNo, student: s }) => ({
        rollNo,
        admissionNo: s.admissionNo,
        name: [s.firstName, s.lastName].filter(Boolean).join(' '),
        gender: s.gender,
        dateOfBirth: s.dateOfBirth ? iso(s.dateOfBirth) : null,
        bFormNo: s.bFormNo,
        admittedOn: iso(s.admittedOn),
        address: s.address ?? '',
        locality: s.locality?.name ?? '',
        guardians: s.guardians.map((g) => ({ relation: g.relation, name: g.guardian.name, phone: g.guardian.phone })),
      })),
    };
  }
}
