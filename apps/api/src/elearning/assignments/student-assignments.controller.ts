import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { FilePurpose, Prisma, Role, SubmissionStatus, type StoredFile } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolveStudent } from '../../student/student-context.js';
import { assignmentState } from '../../student/student-rules.js';
import { isHttpsUrl } from '../courses/course-rules.js';
import { FilesService } from '../files/files.service.js';
import {
  hoursLeft,
  isLate,
  openUrgency,
  studentOrder,
  SUBMIT_BLOCK_MESSAGE,
  submitBlock,
} from './assignment-rules.js';

const submitSchema = z.object({
  body: z.string().trim().max(20000).nullable().optional(),
  linkUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(isHttpsUrl, 'Links must start with https://')
    .nullable()
    .optional()
    .or(z.literal('')),
  /** Uploaded work (POST /student/files); null removes it. */
  fileId: z.string().min(1).nullable().optional(),
});

const submissionSelect = {
  id: true,
  body: true,
  linkUrl: true,
  fileId: true,
  file: true,
  submittedAt: true,
  isLate: true,
  status: true,
  points: true,
  feedback: true,
  gradedAt: true,
} as const;

type Sub = {
  status: SubmissionStatus;
  points: number | null;
  feedback: string | null;
  gradedAt: Date | null;
};

/** Points and feedback are only shown once the teacher has graded or returned the work. */
function visible<T extends Sub>(s: T | null | undefined) {
  if (!s) return null;
  if (s.status === SubmissionStatus.SUBMITTED)
    return { ...s, points: null, feedback: null, gradedAt: null };
  return s;
}

/**
 * A student's assignments (SCHOOL-104): published work for their current
 * section, their own submission, and (re)submitting before the due date (or
 * late when the teacher allows it) until the work is graded.
 */
@Controller('student')
@Roles(Role.STUDENT)
// Students only ever act on their own work, so view access is enough for their writes too.
@Permission('elearning', 'view')
@RequiresFeature('elearning')
export class StudentAssignmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  @Get('assignments')
  async list(@CurrentUser() user: AuthUser) {
    const me = await resolveStudent(this.prisma, user);
    if (!me.sectionId) return [];
    const rows = await this.prisma.assignment.findMany({
      where: {
        schoolId: user.schoolId,
        sectionId: me.sectionId,
        isPublished: true,
      },
      // Newest due dates first, so current work is never the part cut off;
      // the list is re-sorted for display below.
      orderBy: { dueAt: 'desc' },
      take: 300,
      select: {
        id: true,
        title: true,
        dueAt: true,
        maxPoints: true,
        allowLate: true,
        attachmentUrl: true,
        attachment: true,
        subject: { select: { id: true, name: true } },
        course: { select: { id: true, title: true } },
        submissions: { where: { studentId: me.id }, select: submissionSelect },
      },
    });
    const now = new Date();
    return rows
      .map(({ submissions, attachment, ...a }) => {
        const found = submissions[0] ?? null;
        const sub = found ? { ...found, file: found.file ? FilesService.view(found.file) : null } : null;
        const state = assignmentState(a, sub, now);
        return {
          ...a,
          attachment: attachment ? FilesService.view(attachment) : null,
          state,
          urgency: openUrgency(state, a.dueAt, now),
          hoursLeft: hoursLeft(a.dueAt, now),
          canSubmit: submitBlock(a, sub, now) === null,
          submission: visible(sub),
        };
      })
      .sort(studentOrder);
  }

  @Get('assignments/:id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const me = await resolveStudent(this.prisma, user);
    const a = await this.find(user, me, id);
    const now = new Date();
    const sub = a.submissions[0] ?? null;
    const block = submitBlock(a, sub, now);
    const { submissions: _s, attachment, ...rest } = a;
    const state = assignmentState(a, sub, now);
    return {
      ...rest,
      attachment: attachment ? await this.files.link(attachment) : null,
      state,
      urgency: openUrgency(state, a.dueAt, now),
      hoursLeft: hoursLeft(a.dueAt, now),
      canSubmit: block === null,
      blockedReason: block ? SUBMIT_BLOCK_MESSAGE[block] : null,
      submission: await this.withFileLink(visible(sub)),
    };
  }

  /**
   * Hands in (or replaces) the student's work. Needs text or a link. Blocked
   * after the due date when late work is not allowed, and once graded. A
   * resubmission after the teacher returned the work goes back to SUBMITTED.
   */
  @Put('assignments/:id/submission')
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitSchema))
    body: z.infer<typeof submitSchema>,
  ) {
    const me = await resolveStudent(this.prisma, user);
    const a = await this.find(user, me, id);
    const text = body.body?.trim() || null;
    const link = body.linkUrl || null;
    const existing = a.submissions[0] ?? null;
    // Omitted keeps the file already handed in; null removes it.
    const fileId = body.fileId === undefined ? (existing?.fileId ?? null) : body.fileId;
    if (!text && !link && !fileId)
      throw new BadRequestException(
        'Write your answer, add a link or upload a file of your work',
      );
    const now = new Date();
    const block = submitBlock(a, existing, now);
    if (block) throw new ConflictException(SUBMIT_BLOCK_MESSAGE[block]);
    const fileChanged = fileId !== (existing?.fileId ?? null);
    if (fileChanged && fileId) await this.files.claim(user, fileId, FilePurpose.SUBMISSION);
    const data = {
      body: text,
      linkUrl: link,
      fileId,
      submittedAt: now,
      isLate: isLate(a.dueAt, now),
      status: SubmissionStatus.SUBMITTED,
      points: null,
      gradedAt: null,
      gradedById: null,
    };
    // A teacher may grade between the check above and this write: the update
    // only applies to work that is still ungraded, and a create that loses a
    // race to another submit is refused rather than overwriting it.
    const changed = () =>
      new ConflictException(
        'Your work changed while you were handing it in. Reload and try again.',
      );
    let savedId: string;
    if (existing) {
      const { count } = await this.prisma.submission.updateMany({
        where: { id: existing.id, status: { not: SubmissionStatus.GRADED } },
        data,
      });
      if (!count) throw changed();
      savedId = existing.id;
    } else {
      try {
        savedId = (
          await this.prisma.submission.create({
            data: { assignmentId: a.id, studentId: me.id, ...data },
            select: { id: true },
          })
        ).id;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          throw changed();
        throw e;
      }
    }
    const saved = await this.prisma.submission.findUniqueOrThrow({
      where: { id: savedId },
      select: submissionSelect,
    });
    if (fileChanged) await this.files.release([existing?.fileId]);
    return { ...(await this.withFileLink(visible(saved))), state: assignmentState(a, saved, now) };
  }

  private async withFileLink<T extends { file: StoredFile | null }>(s: T | null) {
    if (!s) return null;
    return { ...s, file: s.file ? await this.files.link(s.file) : null };
  }

  private async find(
    user: AuthUser,
    me: { id: string; sectionId: string | null },
    id: string,
  ) {
    const a = await this.prisma.assignment.findFirst({
      where: {
        id: id ?? '',
        schoolId: user.schoolId,
        sectionId: me.sectionId ?? '',
        isPublished: true,
      },
      select: {
        id: true,
        title: true,
        instructions: true,
        attachmentUrl: true,
        attachment: true,
        dueAt: true,
        maxPoints: true,
        allowLate: true,
        createdAt: true,
        subject: { select: { id: true, name: true } },
        course: { select: { id: true, title: true } },
        createdBy: { select: { id: true, name: true } },
        submissions: { where: { studentId: me.id }, select: submissionSelect },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }
}
