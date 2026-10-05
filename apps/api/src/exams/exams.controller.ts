import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ExamStatus, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import {
  ATTENDANCE_ROLES,
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { PermissionService } from '../common/permission.service.js';
import { satisfies } from '../common/permissions.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DEFAULT_BANDS,
  positions,
  studentResult,
  type SubjectResult,
} from './result-calculator.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const bandsSchema = z.object({
  bands: z
    .array(
      z.object({
        grade: z.string().trim().min(1).max(5),
        minPercent: z.number().min(0).max(100),
        remark: z.string().trim().max(60).optional(),
      }),
    )
    .min(1)
    .refine(
      (b) => new Set(b.map((x) => x.grade)).size === b.length,
      'Grades must be unique',
    )
    .refine(
      (b) => b.some((x) => x.minPercent === 0),
      'One grade must start at 0%',
    ),
});
const examSchema = z.object({
  name: z.string().trim().min(2).max(80),
  academicYearId: z.string().min(1),
  startsOn: isoDate.optional(),
  endsOn: isoDate.optional(),
});
const papersSchema = z.object({
  papers: z
    .array(
      z
        .object({
          classId: z.string().min(1),
          subjectId: z.string().min(1),
          maxMarks: z.number().positive().max(1000),
          passMarks: z.number().min(0),
          date: isoDate.optional(),
        })
        .refine(
          (p) => p.passMarks <= p.maxMarks,
          'Pass marks cannot exceed total marks',
        ),
    )
    .min(1),
});
const marksSchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  entries: z
    .array(
      z.object({
        studentId: z.string().min(1),
        marks: z.number().min(0).nullable(),
        isAbsent: z.boolean().default(false),
      }),
    )
    .min(1),
});
const remarksSchema = z.object({
  teacherRemark: z.string().trim().max(300).optional(),
  principalRemark: z.string().trim().max(300).optional(),
});
const publishSchema = z.object({ sendWhatsApp: z.boolean().default(false) });

type ExamInput = z.infer<typeof examSchema>;

const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

/**
 * Exams, marks entry and results. The permission matrix decides who may run an
 * exam: exams=manage creates exams and papers, edits the grading scale and
 * publishes, so a custom role such as "Exam coordinator" can do it without
 * being an administrator. Entering marks and writing remarks only needs
 * exams=view, because the gate there is teaching the subject (or being the
 * class teacher), checked per section below.
 */
@Controller('exams')
@Permission('exams')
@RequiresFeature('exams')
export class ExamsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionService,
  ) {}

  // ---- Grading scale -------------------------------------------------------

  @Get('grade-bands')
  @Roles(...STAFF_ROLES)
  async gradeBands(@CurrentUser() user: AuthUser) {
    return this.bandsFor(user.schoolId);
  }

  /** Replaces the school's grading scale. Published results keep the grades they were given. */
  @Put('grade-bands')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async setGradeBands(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bandsSchema)) body: z.infer<typeof bandsSchema>,
  ) {
    const before = await this.bandsFor(user.schoolId);
    await this.prisma.$transaction([
      this.prisma.gradeBand.deleteMany({ where: { schoolId: user.schoolId } }),
      this.prisma.gradeBand.createMany({
        data: body.bands.map((b) => ({ ...b, schoolId: user.schoolId })),
      }),
    ]);
    await this.audit.record(user, 'update', 'GradeBand', null, {
      before,
      after: body.bands,
    });
    return this.bandsFor(user.schoolId);
  }

  // ---- Exams and papers ----------------------------------------------------

  @Get()
  @Roles(...STAFF_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.prisma.exam.findMany({
      where: {
        schoolId: user.schoolId,
        ...(academicYearId ? { academicYearId } : {}),
      },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
      include: {
        academicYear: { select: { name: true } },
        _count: { select: { papers: true, results: true } },
      },
    });
  }

  @Post()
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(examSchema)) body: ExamInput,
  ) {
    const year = await this.prisma.academicYear.findFirst({
      where: { id: body.academicYearId, schoolId: user.schoolId },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    try {
      const exam = await this.prisma.exam.create({
        data: {
          schoolId: user.schoolId,
          academicYearId: year.id,
          name: body.name,
          startsOn: body.startsOn ? dayStart(body.startsOn) : null,
          endsOn: body.endsOn ? dayStart(body.endsOn) : null,
        },
      });
      await this.audit.record(user, 'create', 'Exam', exam.id, { after: exam });
      return exam;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'An exam with this name already exists for the year',
        );
      }
      throw e;
    }
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        academicYear: { select: { name: true } },
        papers: {
          include: {
            class: { select: { name: true, sortOrder: true } },
            subject: { select: { name: true } },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    exam.papers.sort(
      (a, b) =>
        a.class.sortOrder - b.class.sortOrder ||
        a.subject.name.localeCompare(b.subject.name),
    );
    return exam;
  }

  /** Adds papers or updates their marks and dates. Only while the exam is a draft. */
  @Put(':id/papers')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async setPapers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(papersSchema))
    body: z.infer<typeof papersSchema>,
  ) {
    const exam = await this.draftExam(user, id);
    const classIds = [...new Set(body.papers.map((p) => p.classId))];
    const subjectIds = [...new Set(body.papers.map((p) => p.subjectId))];
    const [classes, subjects] = await Promise.all([
      this.prisma.class.count({
        where: { id: { in: classIds }, schoolId: user.schoolId },
      }),
      this.prisma.subject.count({
        where: { id: { in: subjectIds }, schoolId: user.schoolId },
      }),
    ]);
    if (classes !== classIds.length)
      throw new NotFoundException('Class not found');
    if (subjects !== subjectIds.length)
      throw new NotFoundException('Subject not found');

    await this.prisma.$transaction(
      body.papers.map((p) => {
        const data = {
          maxMarks: p.maxMarks,
          passMarks: p.passMarks,
          date: p.date ? dayStart(p.date) : null,
        };
        return this.prisma.examPaper.upsert({
          where: {
            examId_classId_subjectId: {
              examId: exam.id,
              classId: p.classId,
              subjectId: p.subjectId,
            },
          },
          update: data,
          create: {
            examId: exam.id,
            classId: p.classId,
            subjectId: p.subjectId,
            ...data,
          },
        });
      }),
    );
    await this.audit.record(user, 'update', 'ExamPaper', exam.id, {
      after: body.papers,
    });
    return this.get(user, id);
  }

  @Delete(':id/papers/:paperId')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async deletePaper(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('paperId') paperId: string,
  ) {
    const exam = await this.draftExam(user, id);
    const paper = await this.prisma.examPaper.findFirst({
      where: { id: paperId, examId: exam.id },
      include: { _count: { select: { marks: true } } },
    });
    if (!paper) throw new NotFoundException('Paper not found');
    if (paper._count.marks) {
      throw new ConflictException(
        'Marks have been entered for this paper; clear them first',
      );
    }
    await this.prisma.examPaper.delete({ where: { id: paper.id } });
    await this.audit.record(user, 'delete', 'ExamPaper', paper.id, {
      before: paper,
    });
    return { deleted: true };
  }

  // ---- Marks entry ---------------------------------------------------------

  /** The marks sheet for one section and subject: every enrolled student and their marks, if entered. */
  @Get(':id/marks')
  @Roles(...ATTENDANCE_ROLES)
  @Permission('exams', 'view')
  async marksSheet(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('sectionId') sectionId: string,
    @Query('subjectId') subjectId: string,
  ) {
    const { exam, section, paper, canEnter } = await this.sheetContext(
      user,
      id,
      sectionId,
      subjectId,
    );
    // Teachers only open their own subjects; whoever runs the exam may read
    // every sheet (the Marks tab shows those rows read-only).
    if (!canEnter && !(await this.managesExams(user))) {
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    }
    const [enrollments, marks] = await Promise.all([
      this.activeEnrollments(section.id, exam.academicYearId),
      this.prisma.mark.findMany({ where: { paperId: paper.id } }),
    ]);
    return {
      exam: { id: exam.id, name: exam.name, status: exam.status },
      section: {
        id: section.id,
        name: `${section.class.name} ${section.name}`,
      },
      paper: {
        id: paper.id,
        subject: paper.subject.name,
        maxMarks: paper.maxMarks,
        passMarks: paper.passMarks,
      },
      locked: exam.status === ExamStatus.PUBLISHED,
      canEnter,
      students: enrollments.map((e) => {
        const mark = marks.find((m) => m.studentId === e.studentId);
        return {
          ...e.student,
          name: fullName(e.student),
          rollNo: e.rollNo,
          marks: mark?.marks ?? null,
          isAbsent: mark?.isAbsent ?? false,
          entered: Boolean(mark),
        };
      }),
    };
  }

  @Put(':id/marks')
  @Roles(...ATTENDANCE_ROLES)
  @Permission('exams', 'view')
  async saveMarks(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(marksSchema)) body: z.infer<typeof marksSchema>,
  ) {
    const { exam, section, paper } = await this.assertCanEnterMarks(
      user,
      id,
      body.sectionId,
      body.subjectId,
    );
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'Results are published; unpublish the exam to change marks',
      );
    }
    const enrolled = new Set(
      (await this.activeEnrollments(section.id, exam.academicYearId)).map(
        (e) => e.studentId,
      ),
    );
    for (const entry of body.entries) {
      if (!enrolled.has(entry.studentId)) {
        throw new NotFoundException(
          'A student is not enrolled in this section',
        );
      }
      if (entry.marks !== null && entry.marks > paper.maxMarks) {
        throw new ConflictException(
          `Marks cannot be more than ${paper.maxMarks}`,
        );
      }
      if (!entry.isAbsent && entry.marks === null) {
        throw new ConflictException('Enter marks or mark the student absent');
      }
    }
    await this.prisma.$transaction(
      body.entries.map((entry) => {
        const data = {
          marks: entry.isAbsent ? null : entry.marks,
          isAbsent: entry.isAbsent,
          enteredById: user.sub,
        };
        return this.prisma.mark.upsert({
          where: {
            paperId_studentId: {
              paperId: paper.id,
              studentId: entry.studentId,
            },
          },
          update: data,
          create: { paperId: paper.id, studentId: entry.studentId, ...data },
        });
      }),
    );
    return { saved: body.entries.length };
  }

  /** How many marks are still missing, per section and subject, so admins can chase them before publishing. */
  @Get(':id/progress')
  @Roles(...STAFF_ROLES)
  async progress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const exam = await this.findExam(user, id);
    return this.missingMarks(user, exam);
  }

  // ---- Publishing ----------------------------------------------------------

  /**
   * Freezes every student's result, with class positions per section, and
   * optionally sends parents a WhatsApp summary. Refuses while marks are missing.
   */
  @Post(':id/publish')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishSchema))
    body: z.infer<typeof publishSchema>,
  ) {
    const exam = await this.draftExam(user, id);
    if (campusScope(user)) {
      throw new ForbiddenException(
        'Only school-wide administrators can publish results',
      );
    }
    const progress = await this.missingMarks(user, exam);
    const missing = progress.reduce((sum, p) => sum + p.missing, 0);
    if (!progress.length)
      throw new ConflictException('Add papers before publishing');
    if (missing) {
      throw new ConflictException(
        `${missing} marks are still missing; see the progress tab`,
      );
    }

    const [papers, bands, school] = await Promise.all([
      this.prisma.examPaper.findMany({
        where: { examId: exam.id },
        include: { subject: { select: { name: true } }, marks: true },
      }),
      this.bandsFor(user.schoolId),
      this.prisma.school.findUniqueOrThrow({
        where: { id: user.schoolId },
        select: { name: true },
      }),
    ]);
    const sections = await this.prisma.section.findMany({
      where: {
        academicYearId: exam.academicYearId,
        classId: { in: papers.map((p) => p.classId) },
      },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            student: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    // Remarks written before an unpublish carry over to the new results.
    const remarks = new Map(
      (
        await this.prisma.examResult.findMany({
          where: { examId: exam.id },
          select: {
            studentId: true,
            teacherRemark: true,
            principalRemark: true,
          },
        })
      ).map((r) => [r.studentId, r]),
    );
    const rows: Prisma.ExamResultCreateManyInput[] = [];
    for (const section of sections) {
      const classPapers = papers
        .filter((p) => p.classId === section.classId)
        .sort((a, b) => a.subject.name.localeCompare(b.subject.name));
      const results = section.enrollments.map((e) => ({
        studentId: e.studentId,
        ...studentResult(
          classPapers.map((p) => ({
            id: p.id,
            subject: p.subject.name,
            maxMarks: p.maxMarks,
            passMarks: p.passMarks,
          })),
          classPapers.flatMap((p) =>
            p.marks.filter((m) => m.studentId === e.studentId),
          ),
          bands,
        ),
      }));
      const ranks = positions(
        results.map((r) => ({ id: r.studentId, percent: r.percent })),
      );
      for (const r of results) {
        rows.push({
          examId: exam.id,
          studentId: r.studentId,
          sectionId: section.id,
          obtained: r.obtained,
          maxTotal: r.maxTotal,
          percent: r.percent,
          grade: r.grade,
          position: ranks.get(r.studentId)!,
          passed: r.passed,
          subjects: r.subjects as unknown as Prisma.InputJsonValue,
          teacherRemark: remarks.get(r.studentId)?.teacherRemark,
          principalRemark: remarks.get(r.studentId)?.principalRemark,
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.examResult.deleteMany({ where: { examId: exam.id } }),
      this.prisma.examResult.createMany({ data: rows }),
      this.prisma.exam.update({
        where: { id: exam.id },
        data: { status: ExamStatus.PUBLISHED, publishedAt: new Date() },
      }),
    ]);
    await this.audit.record(user, 'publish', 'Exam', exam.id, {
      after: { results: rows.length },
    });

    let messagesSent = 0;
    if (body.sendWhatsApp && rows.length) {
      const studentIds = rows.map((r) => r.studentId);
      const phones = await guardianPhones(this.prisma, studentIds);
      const names = new Map(
        sections.flatMap((s) =>
          s.enrollments.map((e) => [e.studentId, fullName(e.student)]),
        ),
      );
      messagesSent = await this.notifications.send(
        user.schoolId,
        rows.flatMap((r) =>
          (phones.get(r.studentId) ?? []).map((to) => ({
            to,
            template: 'exam.result' as const,
            params: {
              studentName: names.get(r.studentId) ?? '',
              examName: exam.name,
              percent: String(r.percent),
              grade: r.grade,
              schoolName: school.name,
            },
          })),
        ),
      );
    }
    return { published: rows.length, messagesSent };
  }

  /** Takes results down so marks can be corrected. Remarks are kept for the next publish. */
  @Post(':id/unpublish')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async unpublish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const exam = await this.findExam(user, id);
    if (exam.status !== ExamStatus.PUBLISHED)
      throw new ConflictException('Exam is not published');
    if (campusScope(user)) {
      throw new ForbiddenException(
        'Only school-wide administrators can unpublish results',
      );
    }
    await this.prisma.exam.update({
      where: { id: exam.id },
      data: { status: ExamStatus.DRAFT, publishedAt: null },
    });
    await this.audit.record(user, 'unpublish', 'Exam', exam.id);
    return { status: ExamStatus.DRAFT };
  }

  /** The published result sheet for a section, in position order. */
  @Get(':id/results')
  @Roles(...STAFF_ROLES)
  async results(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('sectionId') sectionId: string,
  ) {
    const exam = await this.findExam(user, id);
    const section = await this.sectionInScope(user, sectionId);
    const results = await this.prisma.examResult.findMany({
      where: { examId: exam.id, sectionId: section.id },
      orderBy: [{ position: 'asc' }],
      include: {
        student: {
          select: { firstName: true, lastName: true, admissionNo: true },
        },
      },
    });
    return {
      exam: { id: exam.id, name: exam.name, status: exam.status },
      section: {
        id: section.id,
        name: `${section.class.name} ${section.name}`,
      },
      published: exam.status === ExamStatus.PUBLISHED,
      results: results.map((r) => ({
        studentId: r.studentId,
        name: fullName(r.student),
        admissionNo: r.student.admissionNo,
        obtained: r.obtained,
        maxTotal: r.maxTotal,
        percent: r.percent,
        grade: r.grade,
        position: r.position,
        passed: r.passed,
        teacherRemark: r.teacherRemark,
        principalRemark: r.principalRemark,
      })),
    };
  }

  /** Class teachers write the teacher remark; administrators write either remark. */
  @Put(':id/results/:studentId/remarks')
  @Roles(...ATTENDANCE_ROLES)
  @Permission('exams', 'view')
  async setRemarks(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(remarksSchema))
    body: z.infer<typeof remarksSchema>,
  ) {
    const exam = await this.findExam(user, id);
    const result = await this.prisma.examResult.findUnique({
      where: { examId_studentId: { examId: exam.id, studentId } },
      include: {
        section: { include: { class: { select: { campusId: true } } } },
      },
    });
    if (!result)
      throw new NotFoundException(
        'No result for this student; publish the exam first',
      );
    const isAdmin = this.adminFor(user, result.section.class.campusId);
    if (!isAdmin) {
      if (result.section.classTeacherId !== user.sub) {
        throw new ForbiddenException('Only the class teacher can add remarks');
      }
      if (body.principalRemark !== undefined) {
        throw new ForbiddenException(
          "Only administrators can write the principal's remark",
        );
      }
    }
    return this.prisma.examResult.update({
      where: { id: result.id },
      data: body,
      select: { teacherRemark: true, principalRemark: true },
    });
  }

  /** A printable report card. Parents can open their own children's once results are published. */
  @Get(':id/report-cards/:studentId')
  @Roles(...STAFF_ROLES, Role.PARENT)
  async reportCard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    const exam = await this.findExam(user, id);
    if (exam.status !== ExamStatus.PUBLISHED)
      throw new NotFoundException('Results are not published');
    const result = await this.prisma.examResult.findUnique({
      where: { examId_studentId: { examId: exam.id, studentId } },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            admissionNo: true,
            dateOfBirth: true,
          },
        },
        section: {
          select: {
            name: true,
            classTeacherId: true,
            class: { select: { name: true, campusId: true } },
            _count: { select: { examResults: { where: { examId: exam.id } } } },
          },
        },
      },
    });
    if (!result) throw new NotFoundException('No result for this student');
    if (hasAnyRole(user, STAFF_ROLES)) {
      const scope = campusScope(user);
      if (scope && !scope.includes(result.section.class.campusId)) {
        throw new NotFoundException('No result for this student');
      }
    } else {
      const link = await this.prisma.studentGuardian.findFirst({
        where: { studentId, guardian: { userId: user.sub } },
      });
      if (!link) throw new NotFoundException('No result for this student');
    }

    const [school, attendance, bands, enrollment] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({
        where: { id: user.schoolId },
        select: { name: true, logoUrl: true },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          studentId,
          session: {
            section: { academicYearId: exam.academicYearId },
            ...(exam.endsOn ? { date: { lte: exam.endsOn } } : {}),
          },
        },
        _count: true,
      }),
      this.bandsFor(user.schoolId),
      this.prisma.enrollment.findUnique({
        where: {
          studentId_academicYearId: {
            studentId,
            academicYearId: exam.academicYearId,
          },
        },
        select: { rollNo: true },
      }),
    ]);
    const days = Object.fromEntries(
      attendance.map((a) => [a.status, a._count]),
    );
    return {
      school,
      exam: {
        id: exam.id,
        name: exam.name,
        academicYear: exam.academicYear.name,
        publishedAt: exam.publishedAt,
      },
      student: {
        id: studentId,
        name: fullName(result.student),
        admissionNo: result.student.admissionNo,
        dateOfBirth: result.student.dateOfBirth,
        rollNo: enrollment?.rollNo ?? null,
        class: `${result.section.class.name} ${result.section.name}`,
      },
      subjects: result.subjects as unknown as SubjectResult[],
      obtained: result.obtained,
      maxTotal: result.maxTotal,
      percent: result.percent,
      grade: result.grade,
      position: result.position,
      outOf: result.section._count.examResults,
      passed: result.passed,
      teacherRemark: result.teacherRemark,
      principalRemark: result.principalRemark,
      attendance: {
        present: (days.PRESENT ?? 0) + (days.LATE ?? 0),
        absent: days.ABSENT ?? 0,
        leave: days.LEAVE ?? 0,
      },
      gradeScale: bands,
    };
  }

  // ---- Helpers -------------------------------------------------------------

  private async bandsFor(schoolId: string) {
    const bands = await this.prisma.gradeBand.findMany({
      where: { schoolId },
      orderBy: { minPercent: 'desc' },
      select: { grade: true, minPercent: true, remark: true },
    });
    return bands.length ? bands : DEFAULT_BANDS;
  }

  private async findExam(user: AuthUser, id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId: user.schoolId },
      include: { academicYear: { select: { name: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  private async draftExam(user: AuthUser, id: string) {
    const exam = await this.findExam(user, id);
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'Results are published; unpublish the exam first',
      );
    }
    return exam;
  }

  private adminFor(user: AuthUser, campusId: string) {
    if (!hasAnyRole(user, SETUP_ROLES)) return false;
    const scope = campusScope(user);
    return !scope || scope.includes(campusId);
  }

  private async sectionInScope(user: AuthUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId ?? '', schoolId: user.schoolId },
      include: {
        class: { select: { name: true, campusId: true } },
        subjects: { select: { subjectId: true, teacherId: true } },
      },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    return section;
  }

  private activeEnrollments(sectionId: string, academicYearId: string) {
    return this.prisma.enrollment.findMany({
      where: { sectionId, academicYearId, status: 'ACTIVE' },
      orderBy: [{ rollNo: 'asc' }],
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
          },
        },
      },
    });
  }

  /** True when the user's role runs exams (create, papers, grading scale, publish). */
  private async managesExams(user: AuthUser) {
    return satisfies(await this.permissions.levelFor(user, 'exams'), 'manage');
  }

  /**
   * One marks sheet: the exam, the section and the paper, with `canEnter` for
   * whether this user may change its marks. Administrators may enter any
   * marks; teachers only the subjects they teach in that section.
   */
  private async sheetContext(
    user: AuthUser,
    examId: string,
    sectionId: string,
    subjectId: string,
  ) {
    const exam = await this.findExam(user, examId);
    const section = await this.sectionInScope(user, sectionId);
    if (section.academicYearId !== exam.academicYearId) {
      throw new NotFoundException('This section is not part of the exam year');
    }
    const paper = await this.prisma.examPaper.findUnique({
      where: {
        examId_classId_subjectId: {
          examId: exam.id,
          classId: section.classId,
          subjectId: subjectId ?? '',
        },
      },
      include: { subject: { select: { name: true } } },
    });
    if (!paper)
      throw new NotFoundException(
        'This subject has no paper for the class in this exam',
      );
    const canEnter =
      this.adminFor(user, section.class.campusId) ||
      section.subjects.some(
        (s) => s.subjectId === subjectId && s.teacherId === user.sub,
      );
    return { exam, section, paper, canEnter };
  }

  /** Like sheetContext, for the endpoints that change marks. */
  private async assertCanEnterMarks(
    user: AuthUser,
    examId: string,
    sectionId: string,
    subjectId: string,
  ) {
    const ctx = await this.sheetContext(user, examId, sectionId, subjectId);
    if (!ctx.canEnter)
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    return ctx;
  }

  private async missingMarks(
    user: AuthUser,
    exam: { id: string; academicYearId: string },
  ) {
    const scope = campusScope(user);
    const papers = await this.prisma.examPaper.findMany({
      where: { examId: exam.id },
      include: {
        subject: { select: { name: true } },
        class: {
          select: {
            name: true,
            sortOrder: true,
            campusId: true,
            sections: {
              where: { academicYearId: exam.academicYearId },
              select: {
                id: true,
                name: true,
                enrollments: {
                  where: { status: 'ACTIVE' },
                  select: { studentId: true },
                },
                subjects: { select: { subjectId: true, teacherId: true } },
              },
            },
          },
        },
        marks: { select: { studentId: true } },
      },
    });
    return papers
      .filter((p) => !scope || scope.includes(p.class.campusId))
      .flatMap((p) =>
        p.class.sections.map((s) => {
          const entered = new Set(p.marks.map((m) => m.studentId));
          const enrolled = s.enrollments.map((e) => e.studentId);
          return {
            sortOrder: p.class.sortOrder,
            sectionId: s.id,
            section: `${p.class.name} ${s.name}`,
            subjectId: p.subjectId,
            subject: p.subject.name,
            enrolled: enrolled.length,
            entered: enrolled.filter((id) => entered.has(id)).length,
            missing: enrolled.filter((id) => !entered.has(id)).length,
            canEnter:
              this.adminFor(user, p.class.campusId) ||
              s.subjects.some(
                (x) => x.subjectId === p.subjectId && x.teacherId === user.sub,
              ),
          };
        }),
      )
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.section.localeCompare(b.section) ||
          a.subject.localeCompare(b.subject),
      )
      .map(({ sortOrder: _sortOrder, ...row }) => row);
  }
}
