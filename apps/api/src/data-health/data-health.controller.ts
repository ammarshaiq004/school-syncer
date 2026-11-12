import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { healthScore, runHealthChecks } from './data-health-rules.js';

const STAFF_LOGIN_ROLES: Role[] = [Role.PRINCIPAL, Role.ADMIN, Role.ACCOUNTANT, Role.TEACHER, Role.CLASS_TEACHER, Role.STAFF];

/** School-side data health checker: finds records that break attendance, fees, messages and certificates. Read-only. */
@Controller('data-health')
@Permission('settings')
@Roles(...SETUP_ROLES)
export class DataHealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const schoolId = user.schoolId;
    const year = { schoolId, isCurrent: true };
    const [students, enrollments, sections, classes, feeStructures, slots, staff, overpaid] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId, status: 'ACTIVE' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNo: true,
          dateOfBirth: true,
          bFormNo: true,
          gender: true,
          guardians: { select: { guardian: { select: { phone: true, cnic: true } } } },
        },
      }),
      this.prisma.enrollment.findMany({
        where: { schoolId, status: 'ACTIVE', academicYear: year },
        select: { studentId: true, sectionId: true, rollNo: true },
      }),
      this.prisma.section.findMany({
        where: { schoolId, academicYear: year },
        select: {
          id: true,
          name: true,
          capacity: true,
          classTeacherId: true,
          class: { select: { name: true, sortOrder: true } },
          subjects: { select: { teacherId: true, subject: { select: { name: true } } } },
          _count: { select: { timetable: true } },
        },
      }),
      this.prisma.class.findMany({ where: { schoolId }, select: { id: true, name: true } }),
      this.prisma.feeStructure.findMany({ where: { schoolId, academicYear: year }, select: { classId: true } }),
      this.prisma.timetableSlot.count({ where: { schoolId } }),
      this.prisma.user.findMany({
        where: { schoolId, isActive: true, roles: { some: { role: { in: STAFF_LOGIN_ROLES } } } },
        select: { id: true, name: true, phone: true },
      }),
      this.prisma.$queryRaw<{ id: string; voucherNo: string; total: number; paid: number }[]>`
        SELECT "id", "voucherNo", "total", "paid" FROM "Invoice"
        WHERE "schoolId" = ${schoolId} AND "status" <> 'CANCELLED' AND "paid" > "total" LIMIT 200`,
    ]);

    const enrolledIds = new Set(enrollments.map((e) => e.studentId));
    const enrolledBySection = new Map<string, number>();
    for (const e of enrollments) enrolledBySection.set(e.sectionId, (enrolledBySection.get(e.sectionId) ?? 0) + 1);
    const withFees = new Set(feeStructures.map((f) => f.classId));

    const checks = runHealthChecks({
      students: students.map((s) => ({
        id: s.id,
        name: [s.firstName, s.lastName].filter(Boolean).join(' '),
        admissionNo: s.admissionNo,
        dateOfBirth: s.dateOfBirth,
        bFormNo: s.bFormNo,
        enrolled: enrolledIds.has(s.id),
        guardianPhones: s.guardians.map((g) => g.guardian.phone),
        gender: s.gender,
        guardianCnics: s.guardians.map((g) => g.guardian.cnic),
      })),
      enrollments,
      sections: sections
        .sort((a, b) => a.class.sortOrder - b.class.sortOrder || a.name.localeCompare(b.name))
        .map((s) => ({
          id: s.id,
          name: `${s.class.name} ${s.name}`,
          capacity: s.capacity,
          enrolled: enrolledBySection.get(s.id) ?? 0,
          hasClassTeacher: !!s.classTeacherId,
          subjectsWithoutTeacher: s.subjects.filter((x) => !x.teacherId).map((x) => x.subject.name),
          lessons: s._count.timetable,
        })),
      classesWithoutFees: feeStructures.length ? classes.filter((c) => !withFees.has(c.id)).map((c) => c.name) : null,
      usesTimetable: slots > 0,
      staff,
      overpaid,
    });
    return { checkedAt: new Date().toISOString(), students: students.length, score: healthScore(checks, students.length), checks };
  }
}
