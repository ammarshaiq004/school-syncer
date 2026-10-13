import {
  BadRequestException,
  ForbiddenException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
import { z } from 'zod';
import {
  administers,
  ATTENDANCE_ROLES,
  campusScope,
  workingSections,
} from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { localDate } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PermissionService } from '../common/permission.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { fullName } from '../elearning/assignments/teaching-scope.service.js';
import { DEFAULT_BANDS } from '../exams/result-calculator.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { quizScores } from '../student/student-rules.js';
import {
  assignmentCell,
  average,
  examCell,
  type GradeCell,
  letterGrade,
  overallPercent,
  quizCell,
} from './gradebook-rules.js';

type Kind = 'EXAM' | 'ASSIGNMENT' | 'QUIZ';

interface Column {
  key: string;
  kind: Kind;
  /** Exam id (save with PUT /exams/:refId/marks), assignment id or quiz id. */
  refId: string;
  title: string;
  maxPoints: number;
  /** YYYY-MM-DD, or null when the item has no date. */
  date: string | null;
  /** Whether this user may edit the column's cells. */
  editable: boolean;
  /** EXAM only. */
  paperId?: string;
  examStatus?: ExamStatus;
  passMarks?: number;
}

/** A @db.Date column (stored as UTC midnight) as YYYY-MM-DD. */
const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
/** A timestamp column as the school-local day it falls on. */
const local = (d: Date | null | undefined) => (d ? localDate(d) : null);

const sectionsQuerySchema = z.object({
  academicYearId: z.string().min(1).optional(),
});
type SectionsQuery = z.infer<typeof sectionsQuerySchema>;

const matrixQuerySchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  /** Optional; must be the section's own year (a section belongs to one year). */
  academicYearId: z.string().min(1).optional(),
});
type MatrixQuery = z.infer<typeof matrixQuerySchema>;

/**
 * The attempt quizScores() counts as best (earliest submitted with the top
 * percentage), so the cell's review flag follows the score it shows.
 */
function bestAttempt<
  T extends {
    submittedAt: Date | null;
    score: number | null;
    maxScore: number;
  },
>(attempts: T[]): T | null {
  const pct = (a: T) =>
    a.maxScore > 0 ? Math.round(((a.score ?? 0) / a.maxScore) * 1000) / 10 : 0;
  let top: T | null = null;
  for (const a of attempts
    .filter((x) => x.submittedAt !== null && x.score !== null)
    .sort(
      (x, y) =>
        (x.submittedAt as Date).getTime() - (y.submittedAt as Date).getTime(),
    )) {
    if (!top || pct(a) > pct(top)) top = a;
  }
  return top;
}

/**
 * The gradebook matrix (AcademiaOS module D): one section and subject, its
 * exam papers, published assignments and published quizzes as columns, every
 * active student as a row, with overall % and the school's letter grade.
 * Teachers see sections they class-teach or subjects they teach there; SETUP
 * roles see their campus scope. Out of scope -> 404, in scope but neither
 * teaching the subject nor class teacher -> 403.
 */
@Controller('gradebook')
@Permission('gradebook')
@Roles(...ATTENDANCE_ROLES)
export class GradebookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Sections and subjects this user can open, for the pickers (current year unless one is given). */
  @Get('sections')
  async sections(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(sectionsQuerySchema))
    { academicYearId }: SectionsQuery,
  ) {
    const scope = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        ...(academicYearId
          ? { academicYearId }
          : { academicYear: { isCurrent: true } }),
        ...(scope ? { class: { campusId: { in: scope } } } : {}),
        ...workingSections(user),
      },
      orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        academicYearId: true,
        classTeacherId: true,
        class: { select: { id: true, name: true, campusId: true } },
        subjects: {
          orderBy: { subject: { name: 'asc' } },
          select: {
            teacherId: true,
            subject: { select: { id: true, name: true } },
          },
        },
      },
    });
    return sections.map((s) => {
      const all = administers(user, s.class.campusId) || s.classTeacherId === user.sub;
      return {
        id: s.id,
        name: `${s.class.name} ${s.name}`,
        className: s.class.name,
        sectionName: s.name,
        academicYearId: s.academicYearId,
        isClassTeacher: s.classTeacherId === user.sub,
        subjects: s.subjects
          .filter((x) => all || x.teacherId === user.sub)
          .map((x) => ({
            id: x.subject.id,
            name: x.subject.name,
            teachesIt: x.teacherId === user.sub,
          })),
      };
    });
  }

  @Get()
  async matrix(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(matrixQuerySchema)) q: MatrixQuery,
  ) {
    const { sectionId, subjectId } = q;
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
      select: {
        id: true,
        name: true,
        classId: true,
        academicYearId: true,
        classTeacherId: true,
        class: { select: { name: true, campusId: true } },
        subjects: {
          where: { subjectId },
          select: {
            teacherId: true,
            subject: { select: { id: true, name: true } },
          },
        },
      },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    const taught = section.subjects[0];
    if (!taught)
      throw new NotFoundException('This subject is not taught in this section');
    const admin = administers(user, section.class.campusId);
    const teachesSubject = taught.teacherId === user.sub;
    if (!admin && !teachesSubject && section.classTeacherId !== user.sub) {
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    }

    // Roster, assignments and quizzes all come from the section, so exam
    // columns must come from the same year.
    if (q.academicYearId && q.academicYearId !== section.academicYearId) {
      throw new BadRequestException(
        "This section belongs to a different academic year; pick that year's section",
      );
    }
    const academicYearId = section.academicYearId;

    const [plan, perms] = await Promise.all([
      this.subscriptions.forSchool(user.schoolId),
      this.permissions.permissionsFor(user),
    ]);
    const writable = plan.access === 'full';
    const examsOn = plan.features.includes('exams') && perms.exams !== 'none';
    const elearningOn =
      plan.features.includes('elearning') && perms.elearning !== 'none';
    // Subject teachers enter marks with view access (as on the marks sheet);
    // anyone else needs exams manage and an admin role.
    const canEditExams =
      writable &&
      (teachesSubject
        ? perms.exams !== 'none'
        : admin && perms.exams === 'manage');
    const canGradeAssignments = writable && perms.elearning === 'manage';

    const [enrolled, papers, assignments, quizzes, bandRows] =
      await Promise.all([
        this.prisma.enrollment.findMany({
          where: { sectionId: section.id, status: 'ACTIVE' },
          orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
          select: {
            rollNo: true,
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNo: true,
                photoUrl: true,
              },
            },
          },
        }),
        examsOn
          ? this.prisma.examPaper.findMany({
              where: {
                classId: section.classId,
                subjectId: taught.subject.id,
                exam: { schoolId: user.schoolId, academicYearId },
              },
              include: {
                exam: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    startsOn: true,
                  },
                },
              },
            })
          : [],
        elearningOn
          ? this.prisma.assignment.findMany({
              where: {
                schoolId: user.schoolId,
                sectionId: section.id,
                subjectId: taught.subject.id,
                isPublished: true,
              },
              select: { id: true, title: true, maxPoints: true, dueAt: true },
            })
          : [],
        elearningOn
          ? this.prisma.quiz.findMany({
              where: {
                schoolId: user.schoolId,
                sectionId: section.id,
                subjectId: taught.subject.id,
                isPublished: true,
              },
              select: {
                id: true,
                title: true,
                opensAt: true,
                closesAt: true,
                createdAt: true,
                questions: { select: { points: true } },
              },
            })
          : [],
        this.prisma.gradeBand.findMany({
          where: { schoolId: user.schoolId },
          orderBy: { minPercent: 'desc' },
          select: { grade: true, minPercent: true, remark: true },
        }),
      ]);
    const gradeBands = bandRows.length ? bandRows : DEFAULT_BANDS;
    const studentIds = enrolled.map((e) => e.student.id);

    const [marks, submissions, attempts] = await Promise.all([
      papers.length
        ? this.prisma.mark.findMany({
            where: {
              paperId: { in: papers.map((p) => p.id) },
              studentId: { in: studentIds },
            },
            select: {
              paperId: true,
              studentId: true,
              marks: true,
              isAbsent: true,
            },
          })
        : [],
      assignments.length
        ? this.prisma.submission.findMany({
            where: {
              assignmentId: { in: assignments.map((a) => a.id) },
              studentId: { in: studentIds },
            },
            select: { assignmentId: true, studentId: true, points: true },
          })
        : [],
      quizzes.length
        ? this.prisma.quizAttempt.findMany({
            where: {
              quizId: { in: quizzes.map((q) => q.id) },
              studentId: { in: studentIds },
            },
            select: {
              quizId: true,
              studentId: true,
              submittedAt: true,
              score: true,
              maxScore: true,
              needsReview: true,
            },
          })
        : [],
    ]);

    const columns: Column[] = [
      ...papers.map((p): Column => ({
        key: `exam:${p.id}`,
        kind: 'EXAM',
        refId: p.exam.id,
        title: p.exam.name,
        maxPoints: p.maxMarks,
        date: iso(p.date ?? p.exam.startsOn),
        editable: canEditExams && p.exam.status === ExamStatus.DRAFT,
        paperId: p.id,
        examStatus: p.exam.status,
        passMarks: p.passMarks,
      })),
      ...assignments.map((a): Column => ({
        key: `assignment:${a.id}`,
        kind: 'ASSIGNMENT',
        refId: a.id,
        title: a.title,
        maxPoints: a.maxPoints,
        date: local(a.dueAt),
        editable: canGradeAssignments,
      })),
      ...quizzes.map((q): Column => ({
        key: `quiz:${q.id}`,
        kind: 'QUIZ',
        refId: q.id,
        title: q.title,
        maxPoints: q.questions.reduce((s, x) => s + x.points, 0),
        date: local(q.closesAt ?? q.opensAt ?? q.createdAt),
        editable: false,
      })),
    ];
    const kindOrder: Record<Kind, number> = { EXAM: 0, ASSIGNMENT: 1, QUIZ: 2 };
    columns.sort(
      (a, b) =>
        (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
        kindOrder[a.kind] - kindOrder[b.kind] ||
        a.title.localeCompare(b.title),
    );

    const markBy = new Map(
      marks.map((m) => [`${m.paperId}:${m.studentId}`, m]),
    );
    const subBy = new Map(
      submissions.map((s) => [`${s.assignmentId}:${s.studentId}`, s]),
    );
    const attemptsBy = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const k = `${a.quizId}:${a.studentId}`;
      attemptsBy.set(k, [...(attemptsBy.get(k) ?? []), a]);
    }

    const rows = enrolled.map(({ rollNo, student }) => {
      const cells: Record<string, GradeCell & { editable: boolean }> = {};
      for (const col of columns) {
        let cell: GradeCell;
        if (col.kind === 'EXAM') {
          cell = examCell(
            markBy.get(`${col.paperId}:${student.id}`),
            col.maxPoints,
          );
        } else if (col.kind === 'ASSIGNMENT') {
          cell = assignmentCell(
            subBy.get(`${col.refId}:${student.id}`),
            col.maxPoints,
          );
        } else {
          const mine = attemptsBy.get(`${col.refId}:${student.id}`) ?? [];
          cell = quizCell(
            quizScores(mine).best,
            bestAttempt(mine)?.needsReview ?? false,
            col.maxPoints,
          );
        }
        cells[col.key] = { ...cell, editable: col.editable };
      }
      const percent = overallPercent(Object.values(cells));
      return {
        studentId: student.id,
        name: fullName(student),
        admissionNo: student.admissionNo,
        rollNo,
        photoUrl: student.photoUrl,
        cells,
        overallPercent: percent,
        letterGrade: letterGrade(percent, gradeBands),
      };
    });

    return {
      section: {
        id: section.id,
        name: `${section.class.name} ${section.name}`,
        academicYearId: section.academicYearId,
      },
      subject: taught.subject,
      academicYearId,
      columns,
      rows,
      classAverage: {
        overallPercent: average(rows.map((r) => r.overallPercent)),
        byColumn: Object.fromEntries(
          columns.map((c) => [
            c.key,
            average(
              rows.map((r) => {
                const cell = r.cells[c.key];
                return overallPercent([cell]);
              }),
            ),
          ]),
        ),
      },
      gradeBands,
    };
  }
}
