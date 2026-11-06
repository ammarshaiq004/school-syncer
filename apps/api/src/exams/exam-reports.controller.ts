import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
import { campusScope, STAFF_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  failures,
  multiExam,
  subjectStats,
  teacherStats,
  toppers,
  type ReportRow,
} from './exam-reports.js';
import type { SubjectResult } from './result-calculator.js';

const MAX_EXAMS = 6;

/**
 * Reports over published results: toppers, failures, subject comparison,
 * teacher performance and several exams side by side. Draft exams have no
 * frozen results, so they are refused rather than shown half-marked.
 */
@Controller('exam-reports')
@Permission('exams')
@RequiresFeature('exams')
export class ExamReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('toppers')
  @Roles(...STAFF_ROLES)
  async toppers(
    @CurrentUser() user: AuthUser,
    @Query('examId') examId: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 3, 1), 10);
    const { exam, rows } = await this.load(user, examId);
    return { exam, limit: n, sections: toppers(rows, n) };
  }

  @Get('failures')
  @Roles(...STAFF_ROLES)
  async failures(
    @CurrentUser() user: AuthUser,
    @Query('examId') examId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    const { exam, rows } = await this.load(user, examId, sectionId);
    return { exam, ...failures(rows) };
  }

  @Get('subjects')
  @Roles(...STAFF_ROLES)
  async subjects(
    @CurrentUser() user: AuthUser,
    @Query('examId') examId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    const { exam, rows } = await this.load(user, examId, sectionId);
    return { exam, stats: subjectStats(rows) };
  }

  /** Who taught the sections that did best. Judging staff is for exam managers only. */
  @Get('teachers')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async teachers(
    @CurrentUser() user: AuthUser,
    @Query('examId') examId: string,
  ) {
    const { exam, rows } = await this.load(user, examId);
    const assigned = await this.prisma.sectionSubject.findMany({
      where: {
        schoolId: user.schoolId,
        sectionId: { in: [...new Set(rows.map((r) => r.sectionId))] },
        teacherId: { not: null },
      },
      include: {
        subject: { select: { name: true } },
        teacher: { select: { id: true, name: true } },
      },
    });
    const teachers = new Map(
      assigned.map((a) => [`${a.sectionId}|${a.subject.name}`, a.teacher!]),
    );
    return { exam, teachers: teacherStats(subjectStats(rows), teachers) };
  }

  /** `examIds` is comma separated, in the order the columns should appear. */
  @Get('multi')
  @Roles(...STAFF_ROLES)
  async multi(
    @CurrentUser() user: AuthUser,
    @Query('examIds') examIds: string,
    @Query('sectionId') sectionId: string,
  ) {
    const ids = [...new Set((examIds ?? '').split(',').filter(Boolean))];
    if (ids.length < 2 || ids.length > MAX_EXAMS) {
      throw new BadRequestException(`Choose between 2 and ${MAX_EXAMS} exams`);
    }
    if (!sectionId) throw new BadRequestException('Choose a section');
    const loaded = await Promise.all(
      ids.map((id) => this.load(user, id, sectionId)),
    );
    return {
      exams: loaded.map((l) => l.exam),
      students: multiExam(loaded.map((l) => l.rows)),
    };
  }

  private async load(user: AuthUser, examId: string, sectionId?: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId ?? '', schoolId: user.schoolId },
      select: { id: true, name: true, status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new BadRequestException(
        `${exam.name} has no published results yet`,
      );
    }
    const scope = campusScope(user);
    const results = await this.prisma.examResult.findMany({
      where: {
        examId: exam.id,
        ...(sectionId ? { sectionId } : {}),
        ...(scope ? { section: { class: { campusId: { in: scope } } } } : {}),
      },
      include: {
        student: {
          select: { firstName: true, lastName: true, admissionNo: true },
        },
        section: {
          select: {
            name: true,
            class: {
              select: { name: true, campus: { select: { name: true } } },
            },
          },
        },
      },
    });
    // Campuses often reuse class names, so name the campus once there is more than one.
    const multiCampus =
      new Set(results.map((r) => r.section.class.campus.name)).size > 1;
    const rows: ReportRow[] = results.map((r) => ({
      studentId: r.studentId,
      name: [r.student.firstName, r.student.lastName].filter(Boolean).join(' '),
      admissionNo: r.student.admissionNo,
      sectionId: r.sectionId,
      section: `${r.section.class.name} ${r.section.name}${multiCampus ? `, ${r.section.class.campus.name}` : ''}`,
      obtained: r.obtained,
      maxTotal: r.maxTotal,
      percent: r.percent,
      grade: r.grade,
      position: r.position,
      passed: r.passed,
      subjects: r.subjects as unknown as SubjectResult[],
    }));
    return { exam: { id: exam.id, name: exam.name }, rows };
  }
}
