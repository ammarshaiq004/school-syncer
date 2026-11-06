import { Controller, Get } from '@nestjs/common';
import { ExamStatus, StudentStatus } from '@prisma/client';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dropoutRow, genderSplit, passFail } from './insights.js';

/** School insights: who the students are, who leaves, and how they do in exams. */
@Controller('reports/insights')
@Permission('reports')
@RequiresFeature('reports')
@Roles(...SETUP_ROLES)
export class InsightsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async insights(@CurrentUser() user: AuthUser) {
    const { schoolId } = user;
    const scope = adminScope(user);
    const campus = scope ? { campusId: { in: scope } } : {};
    const years = await this.prisma.academicYear.findMany({ where: { schoolId }, orderBy: { startsOn: 'asc' } });
    const current = years.find((y) => y.isCurrent) ?? years.at(-1);

    const [active, enrollments, results] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId, status: StudentStatus.ACTIVE, ...campus },
        select: {
          gender: true,
          enrollments: {
            where: { academicYearId: current?.id ?? '', status: 'ACTIVE' },
            select: { section: { select: { class: { select: { name: true } } } } },
          },
        },
      }),
      this.prisma.enrollment.groupBy({
        by: ['academicYearId', 'status'],
        where: { schoolId, student: campus },
        _count: true,
      }),
      this.prisma.examResult.findMany({
        where: { exam: { schoolId, status: ExamStatus.PUBLISHED, academicYearId: current?.id ?? '' }, section: { class: campus } },
        select: { passed: true, exam: { select: { name: true } }, section: { select: { class: { select: { name: true } } } } },
      }),
    ]);

    const counts = new Map<string, Record<string, number>>();
    for (const e of enrollments) counts.set(e.academicYearId, { ...counts.get(e.academicYearId), [e.status]: e._count });
    return {
      year: current ? { id: current.id, name: current.name } : null,
      gender: genderSplit(active.map((s) => ({ gender: s.gender, className: s.enrollments[0]?.section.class.name ?? 'Not enrolled' }))),
      dropout: years.map((y) => dropoutRow(y.name, counts.get(y.id) ?? {})).filter((r) => r.enrolled > 0),
      passFail: {
        byExam: passFail(results.map((r) => ({ label: r.exam.name, passed: r.passed }))),
        byClass: passFail(results.map((r) => ({ label: r.section.class.name, passed: r.passed }))).sort((a, b) =>
          a.name.localeCompare(b.name, 'en', { numeric: true }),
        ),
      },
    };
  }
}
