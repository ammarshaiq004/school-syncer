import { Controller, Get } from '@nestjs/common';
import { Role, StudentStatus } from '@prisma/client';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INACTIVE_AFTER_DAYS, parentLoginStats } from './parent-logins.js';

/** Parent login statistics for the school: how many families use the portal and app. */
@Controller('school/parent-logins')
@Roles(...SETUP_ROLES)
@Permission('students')
export class ParentLoginsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async stats(@CurrentUser() user: AuthUser) {
    const campuses = adminScope(user);
    const today = localToday();
    const guardians = await this.prisma.guardian.findMany({
      where: {
        schoolId: user.schoolId,
        students: { some: { student: { status: StudentStatus.ACTIVE, ...(campuses ? { campusId: { in: campuses } } : {}) } } },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        userId: true,
        user: { select: { lastLoginAt: true } },
        students: {
          where: { student: { status: StudentStatus.ACTIVE, ...(campuses ? { campusId: { in: campuses } } : {}) } },
          select: {
            student: {
              select: {
                firstName: true,
                lastName: true,
                enrollments: { where: { status: 'ACTIVE' }, select: { section: { select: { class: { select: { name: true } } } } }, take: 1 },
              },
            },
          },
        },
      },
    });
    const userIds = guardians.map((g) => g.userId).filter((id): id is string => !!id);
    const activity = userIds.length
      ? await this.prisma.userActivityDay.findMany({
          where: { schoolId: user.schoolId, userId: { in: userIds }, roles: { has: Role.PARENT }, date: { gte: dayStart(daysBefore(today, INACTIVE_AFTER_DAYS * 3)) } },
          select: { userId: true, date: true },
        })
      : [];
    return parentLoginStats(
      guardians.map((g) => ({
        id: g.id,
        name: g.name,
        phone: g.phone,
        userId: g.userId,
        lastLoginAt: g.user?.lastLoginAt ?? null,
        students: g.students.map((s) => ({
          name: [s.student.firstName, s.student.lastName].filter(Boolean).join(' '),
          className: s.student.enrollments[0]?.section.class.name ?? 'No class',
        })),
      })),
      activity.map((a) => ({ userId: a.userId, date: a.date.toISOString().slice(0, 10) })),
      today,
    );
  }
}
