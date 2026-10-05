import {
  BadRequestException,
  Body,
  ConflictException,
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
import { Prisma, QuestionKind } from '@prisma/client';
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
import { quizScores } from '../../student/student-rules.js';
import { reorderProblem } from '../courses/course-rules.js';
import {
  fullName,
  TeachingScopeService,
} from '../assignments/teaching-scope.service.js';
import {
  asAnswers,
  asReview,
  QuizAttemptsService,
  questionOrder,
  questionSelect,
} from './quiz-attempts.service.js';
import {
  gradeAttempt,
  maxScore,
  reviewProblems,
  sanitizeReview,
} from './quiz-grader.js';
import {
  normalizeQuestion,
  type QuestionInput,
  questionProblem,
  quizWindow,
  scorePercent,
  windowProblem,
} from './quiz-rules.js';

const questionFields = {
  kind: z.enum(QuestionKind),
  prompt: z.string().trim().min(1).max(2000),
  options: z.array(z.string().max(500)).max(10),
  correct: z.array(z.union([z.number().int(), z.string().max(200)])).max(20),
  points: z.number().int().min(0).max(100),
};
const questionSchema = z.object({
  ...questionFields,
  options: questionFields.options.default([]),
  correct: questionFields.correct.default([]),
  points: questionFields.points.default(1),
});
// No defaults here: a missing field means "leave as is".
const updateQuestionSchema = z.object(questionFields).partial();
const settings = {
  title: z.string().trim().min(2).max(160),
  instructions: z.string().trim().max(5000).nullable().optional(),
  timeLimitMin: z.number().int().min(1).max(300).nullable().optional(),
  opensAt: z.coerce.date().nullable().optional(),
  closesAt: z.coerce.date().nullable().optional(),
  attemptsAllowed: z.number().int().min(1).max(20).optional(),
  shuffleQuestions: z.boolean().optional(),
  showResults: z.boolean().optional(),
  courseId: z.string().min(1).nullable().optional(),
};
const createSchema = z.object({
  ...settings,
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  questions: z.array(questionSchema).max(200).optional(),
});
const updateSchema = z.object(settings).partial();
const publishSchema = z.object({ isPublished: z.boolean() });
const orderSchema = z.object({ ids: z.array(z.string().min(1)).max(500) });
const reviewSchema = z.object({
  pointsByQuestion: z.record(z.string(), z.number().min(0).max(100)),
});

type Create = z.infer<typeof createSchema>;
type Update = z.infer<typeof updateSchema>;
type QuestionBody = z.infer<typeof questionSchema>;

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
} satisfies Prisma.QuizInclude;

/** Validated, normalised question data ready for Prisma, or a 400. */
function checkedQuestion(input: QuestionInput) {
  const q = normalizeQuestion(input);
  const problem = questionProblem(q);
  if (problem) throw new BadRequestException(problem);
  return q;
}

/**
 * Quizzes for teachers and admins (SCHOOL-103): settings, questions (with
 * answer keys), publishing, results per student and manual review of SHORT
 * answers. Once students have attempted a quiz its questions are locked
 * except for wording, so earlier scores stay meaningful.
 */
@Controller('elearning')
@Permission('elearning')
@RequiresFeature('elearning')
export class ElearningQuizzesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: TeachingScopeService,
    private readonly attempts: QuizAttemptsService,
    private readonly audit: AuditService,
  ) {}

  @Get('quizzes')
  @Roles(...STAFF_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('courseId') courseId?: string,
  ) {
    const rows = await this.prisma.quiz.findMany({
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
        questions: { select: { points: true } },
        attempts: {
          select: {
            studentId: true,
            submittedAt: true,
            score: true,
            maxScore: true,
            needsReview: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    const counts = await this.scope.studentCounts(rows.map((r) => r.sectionId));
    const now = new Date();
    const canManage = hasAnyRole(user, ATTENDANCE_ROLES);
    return rows.map(({ questions, attempts, ...quiz }) => ({
      ...quiz,
      questionCount: questions.length,
      totalPoints: maxScore(questions),
      studentCount: counts.get(quiz.sectionId) ?? 0,
      window: quizWindow(quiz, now),
      ...this.attemptStats(attempts),
      canManage,
    }));
  }

  @Post('quizzes')
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
    const problem = windowProblem(body.opensAt ?? null, body.closesAt ?? null);
    if (problem) throw new BadRequestException(problem);
    const questions = (body.questions ?? []).map((q) => checkedQuestion(q));
    const quiz = await this.prisma.quiz.create({
      data: {
        schoolId: user.schoolId,
        ...target,
        courseId: body.courseId ?? null,
        createdById: user.sub,
        title: body.title,
        instructions: body.instructions || null,
        timeLimitMin: body.timeLimitMin ?? null,
        opensAt: body.opensAt ?? null,
        closesAt: body.closesAt ?? null,
        attemptsAllowed: body.attemptsAllowed ?? 1,
        shuffleQuestions: body.shuffleQuestions ?? false,
        showResults: body.showResults ?? true,
        questions: {
          create: questions.map((q, sortOrder) => ({ ...q, sortOrder })),
        },
      },
      include: summary,
    });
    await this.audit.record(user, 'quiz.create', 'Quiz', quiz.id, {
      after: quiz,
    });
    return this.detail(user, quiz.id);
  }

  /** The quiz with every question and its answer key (staff only). */
  @Get('quizzes/:id')
  @Roles(...STAFF_ROLES)
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const quiz = await this.inScope(user, id);
    const [questions, attempts, counts] = await Promise.all([
      this.prisma.quizQuestion.findMany({
        where: { quizId: quiz.id },
        orderBy: questionOrder,
        select: questionSelect,
      }),
      this.prisma.quizAttempt.findMany({
        where: { quizId: quiz.id },
        select: {
          studentId: true,
          submittedAt: true,
          score: true,
          maxScore: true,
          needsReview: true,
        },
      }),
      this.scope.studentCounts([quiz.sectionId]),
    ]);
    return {
      ...quiz,
      questions,
      questionCount: questions.length,
      totalPoints: maxScore(questions),
      studentCount: counts.get(quiz.sectionId) ?? 0,
      window: quizWindow(quiz, new Date()),
      locked: attempts.length > 0,
      ...this.attemptStats(attempts),
      canManage: hasAnyRole(user, ATTENDANCE_ROLES),
    };
  }

  @Patch('quizzes/:id')
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
    const opensAt = body.opensAt === undefined ? before.opensAt : body.opensAt;
    const closesAt =
      body.closesAt === undefined ? before.closesAt : body.closesAt;
    const problem = windowProblem(opensAt, closesAt);
    if (problem) throw new BadRequestException(problem);
    const quiz = await this.prisma.quiz.update({
      where: { id: before.id },
      data: {
        title: body.title,
        instructions:
          body.instructions === undefined
            ? undefined
            : body.instructions || null,
        timeLimitMin: body.timeLimitMin,
        opensAt: body.opensAt,
        closesAt: body.closesAt,
        attemptsAllowed: body.attemptsAllowed,
        shuffleQuestions: body.shuffleQuestions,
        showResults: body.showResults,
        courseId: body.courseId,
      },
      include: summary,
    });
    await this.audit.record(user, 'quiz.update', 'Quiz', quiz.id, {
      before,
      after: quiz,
    });
    return quiz;
  }

  /** Publishing needs at least one question worth points. */
  @Put('quizzes/:id/publish')
  @Roles(...ATTENDANCE_ROLES)
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishSchema))
    body: z.infer<typeof publishSchema>,
  ) {
    const quiz = await this.inScope(user, id);
    if (body.isPublished) {
      const questions = await this.prisma.quizQuestion.findMany({
        where: { quizId: quiz.id },
        select: { points: true },
      });
      if (!questions.length)
        throw new BadRequestException(
          'Add at least one question before publishing',
        );
      if (maxScore(questions) <= 0)
        throw new BadRequestException('Give at least one question some points');
    }
    const updated = await this.prisma.quiz.update({
      where: { id: quiz.id },
      data: { isPublished: body.isPublished },
      include: summary,
    });
    await this.audit.record(
      user,
      body.isPublished ? 'quiz.publish' : 'quiz.unpublish',
      'Quiz',
      quiz.id,
    );
    return updated;
  }

  /** Deletes the quiz with its questions and every attempt. */
  @Delete('quizzes/:id')
  @Roles(...ATTENDANCE_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const quiz = await this.inScope(user, id);
    await this.prisma.quiz.delete({ where: { id: quiz.id } });
    await this.audit.record(user, 'quiz.delete', 'Quiz', quiz.id, {
      before: quiz,
    });
    return { deleted: true };
  }

  // Questions

  @Post('quizzes/:id/questions')
  @Roles(...ATTENDANCE_ROLES)
  async addQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(questionSchema)) body: QuestionBody,
  ) {
    const quiz = await this.inScope(user, id);
    await this.assertUnlocked(quiz.id);
    const q = checkedQuestion(body);
    const last = await this.prisma.quizQuestion.aggregate({
      where: { quizId: quiz.id },
      _max: { sortOrder: true },
    });
    const created = await this.prisma.quizQuestion.create({
      data: {
        ...q,
        quizId: quiz.id,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
      select: questionSelect,
    });
    await this.audit.record(user, 'quiz.question.create', 'QuizQuestion', created.id, {
      after: { quizId: quiz.id, ...questionSnapshot(created) },
    });
    return created;
  }

  /** Wording can always change; kind, options, answer key and points only before any attempt. */
  @Patch('questions/:id')
  @Roles(...ATTENDANCE_ROLES)
  async updateQuestion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateQuestionSchema))
    body: z.infer<typeof updateQuestionSchema>,
  ) {
    const existing = await this.questionInScope(user, id);
    const structural = (['kind', 'options', 'correct', 'points'] as const).some(
      (k) => body[k] !== undefined,
    );
    if (structural) await this.assertUnlocked(existing.quizId);
    const q = checkedQuestion({
      kind: body.kind ?? existing.kind,
      prompt: body.prompt ?? existing.prompt,
      options: body.options ?? (existing.options as string[]),
      correct: body.correct ?? (existing.correct as (number | string)[]),
      points: body.points ?? existing.points,
    });
    const updated = await this.prisma.quizQuestion.update({
      where: { id: existing.id },
      data: q,
      select: questionSelect,
    });
    await this.audit.record(user, 'quiz.question.update', 'QuizQuestion', existing.id, {
      before: { quizId: existing.quizId, ...questionSnapshot(existing) },
      after: { quizId: existing.quizId, ...questionSnapshot(updated) },
    });
    return updated;
  }

  @Delete('questions/:id')
  @Roles(...ATTENDANCE_ROLES)
  async removeQuestion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const existing = await this.questionInScope(user, id);
    await this.assertUnlocked(existing.quizId);
    await this.prisma.quizQuestion.delete({ where: { id: existing.id } });
    await this.audit.record(user, 'quiz.question.delete', 'QuizQuestion', existing.id, {
      before: { quizId: existing.quizId, ...questionSnapshot(existing) },
    });
    return { deleted: true };
  }

  @Put('quizzes/:id/questions/order')
  @Roles(...ATTENDANCE_ROLES)
  async reorder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ) {
    const quiz = await this.inScope(user, id);
    const questions = await this.prisma.quizQuestion.findMany({
      where: { quizId: quiz.id },
      select: { id: true },
    });
    const problem = reorderProblem(
      questions.map((q) => q.id),
      body.ids,
    );
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction(
      body.ids.map((qid, sortOrder) =>
        this.prisma.quizQuestion.update({
          where: { id: qid },
          data: { sortOrder },
        }),
      ),
    );
    return { ids: body.ids };
  }

  // Results

  /** Every active student of the section with best/latest score, plus per-question stats. */
  @Get('quizzes/:id/results')
  @Roles(...STAFF_ROLES)
  async results(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const quiz = await this.inScope(user, id);
    await this.attempts.closeExpired({ quizId: quiz.id });
    const [questions, attempts, enrolled] = await Promise.all([
      this.prisma.quizQuestion.findMany({
        where: { quizId: quiz.id },
        orderBy: questionOrder,
        select: questionSelect,
      }),
      this.prisma.quizAttempt.findMany({
        where: { quizId: quiz.id },
        orderBy: { startedAt: 'asc' },
      }),
      this.scope.sectionStudents(quiz.sectionId),
    ]);
    const students = enrolled.map(({ rollNo, student }) => {
      const mine = attempts.filter((a) => a.studentId === student.id);
      const scores = quizScores(mine);
      return {
        student: {
          id: student.id,
          name: fullName(student),
          admissionNo: student.admissionNo,
          rollNo,
          photoUrl: student.photoUrl,
        },
        ...scores,
        needsReview: mine.some((a) => a.submittedAt && a.needsReview),
        attemptList: mine.map((a) => ({
          id: a.id,
          startedAt: a.startedAt,
          submittedAt: a.submittedAt,
          score: a.score,
          maxScore: a.maxScore,
          percent: a.submittedAt ? scorePercent(a.score, a.maxScore) : null,
          needsReview: a.needsReview,
        })),
      };
    });
    const submitted = attempts.filter((a) => a.submittedAt);
    const graded = submitted.map((a) =>
      gradeAttempt(questions, asAnswers(a.answers), asReview(a.review)),
    );
    const questionStats = questions.map((q, i) => {
      const rows = graded.map((g) => g.results[i]);
      return {
        questionId: q.id,
        prompt: q.prompt,
        kind: q.kind,
        points: q.points,
        answered: rows.filter((r) => r.outcome !== 'unanswered').length,
        correct: rows.filter(
          (r) =>
            r.outcome === 'correct' ||
            (r.outcome === 'reviewed' && r.earned >= r.points),
        ).length,
        pending: rows.filter((r) => r.outcome === 'pending').length,
        avgEarned: rows.length
          ? Math.round(
              (rows.reduce((s, r) => s + r.earned, 0) / rows.length) * 10,
            ) / 10
          : null,
      };
    });
    const bests = students
      .map((s) => s.best?.percent)
      .filter((p): p is number => p !== undefined);
    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        section: quiz.section,
        subject: quiz.subject,
        showResults: quiz.showResults,
      },
      maxScore: maxScore(questions),
      summary: {
        students: enrolled.length,
        attempted: students.filter((s) => s.submitted > 0).length,
        inProgress: students.filter((s) => s.inProgress).length,
        needsReview: submitted.filter((a) => a.needsReview).length,
        avgPercent: bests.length
          ? Math.round((bests.reduce((s, p) => s + p, 0) / bests.length) * 10) /
            10
          : null,
      },
      students,
      questionStats,
    };
  }

  /** One attempt with the student's answers, per-question marks and the answer key. */
  @Get('attempts/:id')
  @Roles(...STAFF_ROLES)
  async attempt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const attempt = await this.attemptInScope(user, id);
    return this.attemptView(attempt);
  }

  /**
   * Teacher marks for SHORT answers: {pointsByQuestion: {questionId: points}}.
   * Points are clamped to each question's value and merged with earlier
   * review; the attempt is re-marked and leaves needsReview once nothing is
   * pending.
   */
  @Put('attempts/:id/review')
  @Roles(...ATTENDANCE_ROLES)
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewSchema))
    body: z.infer<typeof reviewSchema>,
  ) {
    const attempt = await this.attemptInScope(user, id);
    if (!attempt.submittedAt)
      throw new ConflictException('This attempt has not been submitted yet');
    const questions = attempt.quiz.questions;
    const bad = reviewProblems(questions, body.pointsByQuestion);
    if (bad.length)
      throw new BadRequestException(
        'Only short-answer questions of this quiz can be reviewed',
      );
    const review = {
      ...asReview(attempt.review),
      ...sanitizeReview(questions, body.pointsByQuestion),
    };
    const grade = gradeAttempt(questions, asAnswers(attempt.answers), review);
    await this.prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        review,
        score: grade.score,
        maxScore: grade.maxScore,
        needsReview: grade.needsReview,
      },
    });
    await this.audit.record(user, 'quiz.review', 'QuizAttempt', attempt.id, {
      before: { score: attempt.score, review: attempt.review },
      after: { score: grade.score, review },
    });
    return this.attemptView(await this.attemptInScope(user, id));
  }

  private attemptView(
    attempt: Awaited<ReturnType<ElearningQuizzesController['attemptInScope']>>,
  ) {
    const { quiz, student, ...rest } = attempt;
    const review = asReview(attempt.review);
    const answers = asAnswers(attempt.answers);
    const grade = gradeAttempt(quiz.questions, answers, review);
    return {
      ...rest,
      percent: attempt.submittedAt
        ? scorePercent(attempt.score, attempt.maxScore)
        : null,
      student: {
        id: student.id,
        name: fullName(student),
        admissionNo: student.admissionNo,
      },
      quiz: {
        id: quiz.id,
        title: quiz.title,
        sectionId: quiz.sectionId,
        subjectId: quiz.subjectId,
      },
      questions: quiz.questions.map((q, i) => ({
        ...q,
        answer: answers[q.id] ?? null,
        earned: grade.results[i].earned,
        outcome: grade.results[i].outcome,
        reviewPoints: review[q.id] ?? null,
      })),
    };
  }

  private attemptStats(
    attempts: {
      studentId: string;
      submittedAt: Date | null;
      score: number | null;
      maxScore: number;
      needsReview: boolean;
    }[],
  ) {
    const submitted = attempts.filter((a) => a.submittedAt);
    const pcts = submitted
      .map((a) => scorePercent(a.score, a.maxScore))
      .filter((p): p is number => p !== null);
    return {
      attemptCount: submitted.length,
      studentsAttempted: new Set(submitted.map((a) => a.studentId)).size,
      inProgressCount: attempts.length - submitted.length,
      needsReviewCount: submitted.filter((a) => a.needsReview).length,
      avgPercent: pcts.length
        ? Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 10) / 10
        : null,
    };
  }

  private async inScope(user: AuthUser, id: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { AND: [{ id: id ?? '' }, await this.scope.where(user)] },
      include: summary,
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    return quiz;
  }

  private async questionInScope(user: AuthUser, id: string) {
    const q = await this.prisma.quizQuestion.findFirst({
      where: { id: id ?? '', quiz: await this.scope.where(user) },
    });
    if (!q) throw new NotFoundException('Question not found');
    return q;
  }

  private async attemptInScope(user: AuthUser, id: string) {
    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: id ?? '', quiz: await this.scope.where(user) },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
          },
        },
        quiz: {
          select: {
            id: true,
            title: true,
            sectionId: true,
            subjectId: true,
            questions: { orderBy: questionOrder, select: questionSelect },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  /** Questions are frozen once any student has started the quiz. */
  private async assertUnlocked(quizId: string) {
    const started = await this.prisma.quizAttempt.count({ where: { quizId } });
    if (started) {
      throw new ConflictException(
        'Students have already attempted this quiz, so only the wording can change',
      );
    }
  }
}

/** The audited fields of a question: the wording, answer key and points. */
function questionSnapshot(q: {
  kind: string;
  prompt: string;
  options: unknown;
  correct: unknown;
  points: number;
}) {
  const { kind, prompt, options, correct, points } = q;
  return { kind, prompt, options, correct, points };
}
