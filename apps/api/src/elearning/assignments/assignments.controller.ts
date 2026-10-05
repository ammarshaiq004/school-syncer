import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FilePurpose, Prisma, SubmissionStatus, type StoredFile } from '@prisma/client';
import { z } from 'zod';
import {
  ATTENDANCE_ROLES,
  hasAnyRole,
  STAFF_ROLES,
} from '../../common/admin-roles.js';
import { AuditService } from '../../common/audit.service.js';
import type { AuthUser } from '../../common/auth-user.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assignmentState } from '../../student/student-rules.js';
import { isHttpsUrl } from '../courses/course-rules.js';
import { FilesService } from '../files/files.service.js';
import { gradeProblem } from './assignment-rules.js';
import { fullName, TeachingScopeService } from './teaching-scope.service.js';

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpsUrl, 'Links must start with https://');
const fields = {
  title: z.string().trim().min(2).max(160),
  instructions: z.string().trim().max(20000).nullable().optional(),
  attachmentUrl: httpsUrl.nullable().optional(),
  /** An uploaded worksheet (POST /elearning/files?purpose=ASSIGNMENT); null removes it. */
  attachmentId: z.string().min(1).nullable().optional(),
  dueAt: z.coerce.date(),
  maxPoints: z.number().int().min(1).max(1000).optional(),
  allowLate: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  courseId: z.string().min(1).nullable().optional(),
};
const createSchema = z.object({
  ...fields,
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
});
const updateSchema = z.object(fields).partial();
const gradeSchema = z.object({
  points: z.number().int().min(0),
  feedback: z.string().trim().max(5000).nullable().optional(),
  status: z
    .enum([SubmissionStatus.GRADED, SubmissionStatus.RETURNED])
    .default(SubmissionStatus.GRADED),
});

type Create = z.infer<typeof createSchema>;
type Update = z.infer<typeof updateSchema>;
type Grade = z.infer<typeof gradeSchema>;

const summary = {
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { id: true, name: true, campusId: true } },
    },
  },
  subject: { select: { id: true, name: true, code: true } },
  course: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true } },
  attachment: true,
} satisfies Prisma.AssignmentInclude;

/**
 * Assignments for teachers and admins (SCHOOL-104): CRUD, the submissions
 * table for a whole section (missing students included) and grading. Reads
 * are open to staff in scope; writes to teachers and SETUP roles.
 */
@Controller('elearning')
@Permission('elearning')
@RequiresFeature('elearning')
export class ElearningAssignmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: TeachingScopeService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  @Get('assignments')
  @Roles(...STAFF_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('courseId') courseId?: string,
  ) {
    const rows = await this.prisma.assignment.findMany({
      where: {
        AND: [
          await this.scope.where(user),
          sectionId ? { sectionId } : {},
          subjectId ? { subjectId } : {},
          courseId ? { courseId } : {},
        ],
      },
      include: {
        ...summary,
        submissions: { select: { status: true, isLate: true } },
      },
      orderBy: [{ dueAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const counts = await this.scope.studentCounts(rows.map((r) => r.sectionId));
    const canManage = hasAnyRole(user, ATTENDANCE_ROLES);
    return rows.map(({ submissions, attachment, ...a }) => ({
      ...a,
      attachment: attachment ? FilesService.view(attachment) : null,
      ...this.stats(submissions, counts.get(a.sectionId) ?? 0),
      canManage,
    }));
  }

  @Post('assignments')
  @Roles(...ATTENDANCE_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: Create,
  ) {
    const target = await this.scope.target(
      user,
      body.sectionId,
      body.subjectId,
      body.courseId,
    );
    if (body.attachmentId) await this.files.claim(user, body.attachmentId, FilePurpose.ASSIGNMENT);
    const assignment = await this.prisma.assignment.create({
      data: {
        schoolId: user.schoolId,
        ...target,
        courseId: body.courseId ?? null,
        createdById: user.sub,
        title: body.title,
        instructions: body.instructions || null,
        attachmentUrl: body.attachmentUrl || null,
        attachmentId: body.attachmentId || null,
        dueAt: body.dueAt,
        maxPoints: body.maxPoints ?? 100,
        allowLate: body.allowLate ?? true,
        isPublished: body.isPublished ?? false,
      },
      include: summary,
    });
    await this.audit.record(
      user,
      'assignment.create',
      'Assignment',
      assignment.id,
      { after: assignment },
    );
    return this.present(assignment);
  }

  @Get('assignments/:id')
  @Roles(...STAFF_ROLES)
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const a = await this.inScope(user, id);
    const [submissions, counts] = await Promise.all([
      this.prisma.submission.findMany({
        where: { assignmentId: a.id },
        select: { status: true, isLate: true },
      }),
      this.scope.studentCounts([a.sectionId]),
    ]);
    return {
      ...(await this.present(a)),
      ...this.stats(submissions, counts.get(a.sectionId) ?? 0),
      canManage: hasAnyRole(user, ATTENDANCE_ROLES),
    };
  }

  @Patch('assignments/:id')
  @Roles(...ATTENDANCE_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: Update,
  ) {
    const before = await this.inScope(user, id);
    if (body.courseId)
      await this.scope.target(
        user,
        before.sectionId,
        before.subjectId,
        body.courseId,
      );
    const attachmentChanged = body.attachmentId !== undefined && body.attachmentId !== before.attachmentId;
    if (attachmentChanged && body.attachmentId) {
      await this.files.claim(user, body.attachmentId, FilePurpose.ASSIGNMENT);
    }
    if (body.maxPoints !== undefined) {
      const top = await this.prisma.submission.aggregate({
        where: { assignmentId: before.id },
        _max: { points: true },
      });
      if ((top._max.points ?? 0) > body.maxPoints) {
        throw new BadRequestException(
          'Some work is already graded higher than this maximum',
        );
      }
    }
    const assignment = await this.prisma.assignment.update({
      where: { id: before.id },
      data: {
        title: body.title,
        instructions:
          body.instructions === undefined
            ? undefined
            : body.instructions || null,
        attachmentUrl:
          body.attachmentUrl === undefined
            ? undefined
            : body.attachmentUrl || null,
        attachmentId: attachmentChanged ? body.attachmentId || null : undefined,
        dueAt: body.dueAt,
        maxPoints: body.maxPoints,
        allowLate: body.allowLate,
        isPublished: body.isPublished,
        courseId: body.courseId,
      },
      include: summary,
    });
    if (body.dueAt && body.dueAt.getTime() !== before.dueAt.getTime()) {
      // A new due date re-decides which work counts as late.
      await this.prisma.$transaction([
        this.prisma.submission.updateMany({
          where: { assignmentId: before.id, submittedAt: { gt: body.dueAt } },
          data: { isLate: true },
        }),
        this.prisma.submission.updateMany({
          where: { assignmentId: before.id, submittedAt: { lte: body.dueAt } },
          data: { isLate: false },
        }),
      ]);
    }
    await this.audit.record(
      user,
      'assignment.update',
      'Assignment',
      assignment.id,
      { before, after: assignment },
    );
    if (attachmentChanged) await this.files.release([before.attachmentId]);
    return this.present(assignment);
  }

  /** Deletes the assignment and every submission. */
  @Delete('assignments/:id')
  @Roles(...ATTENDANCE_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const a = await this.inScope(user, id);
    const work = await this.prisma.submission.findMany({
      where: { assignmentId: a.id, fileId: { not: null } },
      select: { fileId: true },
    });
    await this.prisma.assignment.delete({ where: { id: a.id } });
    await this.files.release([a.attachmentId, ...work.map((w) => w.fileId)]);
    await this.audit.record(user, 'assignment.delete', 'Assignment', a.id, {
      before: a,
    });
    return { deleted: true };
  }

  /** Every active student of the section with their submission (or none yet). */
  @Get('assignments/:id/submissions')
  @Roles(...STAFF_ROLES)
  async submissions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const a = await this.inScope(user, id);
    const [enrolled, subs] = await Promise.all([
      this.scope.sectionStudents(a.sectionId),
      this.prisma.submission.findMany({
        where: { assignmentId: a.id },
        include: { gradedBy: { select: { id: true, name: true } }, file: true },
      }),
    ]);
    const links = await this.files.links(subs.map((s) => s.file));
    const byStudent = new Map(
      subs.map(({ file, ...s }) => [s.studentId, { ...s, file: file ? (links.get(file.id) ?? null) : null }]),
    );
    const now = new Date();
    const students = enrolled.map(({ rollNo, student }) => {
      const submission = byStudent.get(student.id) ?? null;
      return {
        student: {
          id: student.id,
          name: fullName(student),
          admissionNo: student.admissionNo,
          rollNo,
          photoUrl: student.photoUrl,
        },
        state: assignmentState(a, submission, now),
        submission,
      };
    });
    // Work from students who have since left the section still shows (and can be graded).
    const enrolledIds = new Set(enrolled.map((e) => e.student.id));
    const leftIds = subs
      .filter((s) => !enrolledIds.has(s.studentId))
      .map((s) => s.studentId);
    if (leftIds.length) {
      const left = await this.prisma.student.findMany({
        where: { id: { in: leftIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNo: true,
          photoUrl: true,
        },
      });
      for (const s of left) {
        const submission = byStudent.get(s.id) ?? null;
        students.push({
          student: {
            id: s.id,
            name: fullName(s),
            admissionNo: s.admissionNo,
            rollNo: null,
            photoUrl: s.photoUrl,
          },
          state: assignmentState(a, submission, now),
          submission,
        });
      }
    }
    const tally = (state: string) =>
      students.filter((s) => s.state === state).length;
    return {
      assignment: await this.present(a),
      students,
      summary: {
        students: enrolled.length,
        submitted: subs.length,
        toGrade: subs.filter((s) => s.status === SubmissionStatus.SUBMITTED)
          .length,
        graded: subs.filter((s) => s.status !== SubmissionStatus.SUBMITTED)
          .length,
        late: subs.filter((s) => s.isLate).length,
        missing: tally('missing') + tally('overdue'),
        pending: tally('pending'),
      },
    };
  }

  @Put('submissions/:id/grade')
  @Roles(...ATTENDANCE_ROLES)
  async grade(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(gradeSchema)) body: Grade,
  ) {
    const before = await this.prisma.submission.findFirst({
      where: { id: id ?? '', assignment: await this.scope.where(user) },
      include: { assignment: { select: { id: true, maxPoints: true } } },
    });
    if (!before) throw new NotFoundException('Submission not found');
    const problem = gradeProblem(body.points, before.assignment.maxPoints);
    if (problem) throw new BadRequestException(problem);
    const submission = await this.prisma.submission.update({
      where: { id: before.id },
      data: {
        points: body.points,
        feedback:
          body.feedback === undefined ? undefined : body.feedback || null,
        status: body.status,
        gradedById: user.sub,
        gradedAt: new Date(),
      },
      include: { gradedBy: { select: { id: true, name: true } } },
    });
    const { assignment: _a, ...prior } = before;
    await this.audit.record(
      user,
      'assignment.grade',
      'Submission',
      submission.id,
      {
        before: prior,
        after: {
          points: submission.points,
          feedback: submission.feedback,
          status: submission.status,
        },
      },
    );
    return submission;
  }

  /**
   * Gradebook entry (AcademiaOS module D): grades one student's work for the
   * assignment, creating the submission record when the student never
   * submitted online (e.g. work handed in on paper). The student must be
   * active in the section or already have a submission.
   */
  @Put('assignments/:id/grades/:studentId')
  @Roles(...ATTENDANCE_ROLES)
  async gradeStudent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(gradeSchema)) body: Grade,
  ) {
    const a = await this.inScope(user, id);
    const [enrolled, before] = await Promise.all([
      this.prisma.enrollment.findFirst({
        where: { sectionId: a.sectionId, studentId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId: a.id, studentId } },
      }),
    ]);
    if (!enrolled && !before)
      throw new NotFoundException('Student not found in this section');
    const problem = gradeProblem(body.points, a.maxPoints);
    if (problem) throw new BadRequestException(problem);
    const now = new Date();
    const graded = {
      points: body.points,
      status: body.status,
      gradedById: user.sub,
      gradedAt: now,
    };
    const submission = await this.prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: a.id, studentId } },
      update: {
        ...graded,
        feedback:
          body.feedback === undefined ? undefined : body.feedback || null,
      },
      create: {
        ...graded,
        assignmentId: a.id,
        studentId,
        submittedAt: now,
        isLate: false,
        feedback: body.feedback || null,
      },
      include: { gradedBy: { select: { id: true, name: true } } },
    });
    await this.audit.record(
      user,
      'assignment.grade',
      'Submission',
      submission.id,
      {
        before: before
          ? {
              points: before.points,
              feedback: before.feedback,
              status: before.status,
            }
          : null,
        after: {
          points: submission.points,
          feedback: submission.feedback,
          status: submission.status,
        },
      },
    );
    return { ...submission, created: !before };
  }

  /** The assignment with a fresh link to its uploaded attachment. */
  private async present<T extends { attachment: StoredFile | null }>(a: T) {
    return { ...a, attachment: a.attachment ? await this.files.link(a.attachment) : null };
  }

  private stats(
    subs: { status: SubmissionStatus; isLate: boolean }[],
    students: number,
  ) {
    return {
      studentCount: students,
      submittedCount: subs.length,
      toGradeCount: subs.filter((s) => s.status === SubmissionStatus.SUBMITTED)
        .length,
      gradedCount: subs.filter((s) => s.status !== SubmissionStatus.SUBMITTED)
        .length,
      lateCount: subs.filter((s) => s.isLate).length,
    };
  }

  private async inScope(user: AuthUser, id: string) {
    const a = await this.prisma.assignment.findFirst({
      where: { AND: [{ id: id ?? '' }, await this.scope.where(user)] },
      include: summary,
    });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }
}
