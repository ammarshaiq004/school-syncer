import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
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
import {
  resolveStudent,
  type StudentContext,
} from '../../student/student-context.js';
import { quizScores } from '../../student/student-rules.js';
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
  optionList,
  sanitizeAnswers,
} from './quiz-grader.js';
import {
  attemptDeadline,
  GRACE_MS,
  isPastGrace,
  quizWindow,
  scorePercent,
  seededShuffle,
} from './quiz-rules.js';

const answersSchema = z.object({ answers: z.record(z.string(), z.unknown()) });
const submitSchema = z
  .object({ answers: z.record(z.string(), z.unknown()).optional() })
  .default({});

const quizSelect = {
  id: true,
  title: true,
  instructions: true,
  timeLimitMin: true,
  opensAt: true,
  closesAt: true,
  attemptsAllowed: true,
  shuffleQuestions: true,
  showResults: true,
  sectionId: true,
  subject: { select: { id: true, name: true } },
  course: { select: { id: true, title: true } },
  questions: { orderBy: questionOrder, select: questionSelect },
} satisfies Prisma.QuizSelect;

type QuizRow = Prisma.QuizGetPayload<{ select: typeof quizSelect }>;
type AttemptRow = Prisma.QuizAttemptGetPayload<object>;

/**
 * A student's quizzes (SCHOOL-103). Questions go out without answer keys;
 * after submission the key is shown only when the teacher allows results and
 * the student cannot try again (no attempts left or the quiz has closed), so
 * a second attempt cannot be copied from the first one's corrections. Scores
 * are hidden entirely when results are off.
 */
@Controller('student')
@Roles(Role.STUDENT)
// Students only ever act on their own work, so view access is enough for their writes too.
@Permission('elearning', 'view')
@RequiresFeature('elearning')
export class StudentQuizzesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: QuizAttemptsService,
  ) {}

  @Get('quizzes')
  async list(@CurrentUser() user: AuthUser) {
    const me = await resolveStudent(this.prisma, user);
    if (!me.sectionId) return [];
    await this.attempts.closeExpired({ studentId: me.id });
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        schoolId: user.schoolId,
        sectionId: me.sectionId,
        isPublished: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      select: quizSelect,
    });
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { studentId: me.id, quizId: { in: quizzes.map((q) => q.id) } },
    });
    const now = new Date();
    const items = quizzes.map((q) =>
      this.card(
        q,
        attempts.filter((a) => a.quizId === q.id),
        now,
      ),
    );
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return items.sort((a, b) => rank[a.window] - rank[b.window]);
  }

  @Get('quizzes/:id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const me = await resolveStudent(this.prisma, user);
    const quiz = await this.findQuiz(user, me, id);
    await this.attempts.closeExpired({ studentId: me.id, quizId: quiz.id });
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { studentId: me.id, quizId: quiz.id },
      orderBy: { startedAt: 'asc' },
    });
    const now = new Date();
    return {
      ...this.card(quiz, attempts, now),
      attempts: attempts
        .filter((a) => a.submittedAt)
        .map((a) => ({
          id: a.id,
          startedAt: a.startedAt,
          submittedAt: a.submittedAt,
          score: quiz.showResults ? a.score : null,
          maxScore: a.maxScore,
          percent: quiz.showResults ? scorePercent(a.score, a.maxScore) : null,
          needsReview: a.needsReview,
        })),
    };
  }

  /**
   * Starts an attempt, or resumes the one already in progress. 409 when the
   * quiz is not open, has no questions, or no attempts are left.
   */
  @Post('quizzes/:id/start')
  @HttpCode(200)
  async start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const me = await resolveStudent(this.prisma, user);
    const quiz = await this.findQuiz(user, me, id);
    await this.attempts.closeExpired({ studentId: me.id, quizId: quiz.id });
    const now = new Date();
    const window = quizWindow(quiz, now);
    // Count and create in one serializable transaction so a double click or a
    // second tab cannot open more attempts than allowed; the loser of a
    // conflict resumes the attempt the winner created.
    const begin = () =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.quizAttempt.findMany({
            where: { studentId: me.id, quizId: quiz.id },
          });
          const open = existing.find((a) => !a.submittedAt);
          if (open) return open;
          if (window === 'upcoming')
            throw new ConflictException('This quiz has not opened yet');
          if (window === 'closed')
            throw new ConflictException('This quiz has closed');
          if (!quiz.questions.length)
            throw new ConflictException('This quiz has no questions yet');
          if (existing.length >= quiz.attemptsAllowed) {
            throw new ConflictException(
              'You have used all your attempts for this quiz',
            );
          }
          return tx.quizAttempt.create({
            data: {
              quizId: quiz.id,
              studentId: me.id,
              startedAt: now,
              maxScore: maxScore(quiz.questions),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    let attempt: Awaited<ReturnType<typeof begin>> | undefined;
    for (let tries = 0; !attempt; tries++) {
      try {
        attempt = await begin();
      } catch (e) {
        const clash =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2034';
        if (!clash) throw e;
        if (tries >= 2)
          throw new ConflictException('Could not start the quiz. Try again.');
      }
    }
    return this.inProgressView(quiz, attempt);
  }

  /** An attempt: the question paper while in progress, the result once submitted. */
  @Get('attempts/:id')
  async getAttempt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const me = await resolveStudent(this.prisma, user);
    let { attempt, quiz } = await this.findAttempt(user, me, id);
    if (
      !attempt.submittedAt &&
      isPastGrace(attemptDeadline(attempt.startedAt, quiz), new Date())
    ) {
      await this.attempts.finalize(attempt, quiz);
      ({ attempt, quiz } = await this.findAttempt(user, me, id));
    }
    return attempt.submittedAt
      ? this.resultView(me, quiz, attempt)
      : this.inProgressView(quiz, attempt);
  }

  /**
   * Autosave: merges `answers` ({questionId: number[] | string}) into the
   * attempt. Unknown questions and invalid options are dropped. After the
   * time limit plus grace, nothing is saved: the attempt is submitted with
   * what it had and this answers 409.
   */
  @Put('attempts/:id')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(answersSchema))
    body: z.infer<typeof answersSchema>,
  ) {
    const me = await resolveStudent(this.prisma, user);
    const { attempt, quiz } = await this.findAttempt(user, me, id);
    if (attempt.submittedAt)
      throw new ConflictException('This attempt has already been submitted');
    const now = new Date();
    const deadline = attemptDeadline(attempt.startedAt, quiz);
    if (isPastGrace(deadline, now)) {
      await this.attempts.finalize(attempt, quiz, undefined, now);
      throw new ConflictException(
        'Time is up. Your attempt was submitted with the answers saved so far',
      );
    }
    const answers = {
      ...asAnswers(attempt.answers),
      ...sanitizeAnswers(quiz.questions, body.answers),
    };
    const { count } = await this.prisma.quizAttempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: { answers: answers as Prisma.InputJsonValue },
    });
    if (!count)
      throw new ConflictException('This attempt has already been submitted');
    return {
      attemptId: attempt.id,
      savedAt: now,
      answered: Object.values(answers).filter((a) =>
        Array.isArray(a) ? a.length : a.trim(),
      ).length,
      deadline,
      serverNow: now,
    };
  }

  /**
   * Submits the attempt (optionally with last answers) and returns the
   * result. Answers sent after the time limit plus grace are ignored.
   * Submitting twice returns the same result.
   */
  @Post('attempts/:id/submit')
  @HttpCode(200)
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitSchema))
    body: z.infer<typeof submitSchema>,
  ) {
    const me = await resolveStudent(this.prisma, user);
    const found = await this.findAttempt(user, me, id);
    if (!found.attempt.submittedAt)
      await this.attempts.finalize(found.attempt, found.quiz, body.answers);
    const { attempt, quiz } = await this.findAttempt(user, me, id);
    return this.resultView(me, quiz, attempt);
  }

  private card(quiz: QuizRow, attempts: AttemptRow[], now: Date) {
    const scores = quizScores(attempts);
    const window = quizWindow(quiz, now);
    const used = attempts.length;
    const inProgress = attempts.find((a) => !a.submittedAt);
    const hide = !quiz.showResults;
    return {
      id: quiz.id,
      title: quiz.title,
      instructions: quiz.instructions,
      subject: quiz.subject,
      course: quiz.course,
      timeLimitMin: quiz.timeLimitMin,
      opensAt: quiz.opensAt,
      closesAt: quiz.closesAt,
      questionCount: quiz.questions.length,
      totalPoints: maxScore(quiz.questions),
      attemptsAllowed: quiz.attemptsAllowed,
      attemptsUsed: used,
      attemptsLeft: Math.max(0, quiz.attemptsAllowed - used),
      window,
      canStart:
        !!inProgress ||
        (window === 'open' &&
          used < quiz.attemptsAllowed &&
          quiz.questions.length > 0),
      inProgressAttemptId: inProgress?.id ?? null,
      showResults: quiz.showResults,
      submitted: scores.submitted,
      best: hide || !scores.best ? null : scores.best,
      latest: scores.latest
        ? {
            ...scores.latest,
            score: hide ? null : scores.latest.score,
            percent: hide ? null : scores.latest.percent,
          }
        : null,
    };
  }

  /** The question paper: no answer keys, shuffled per attempt when the teacher asked for it. */
  private inProgressView(quiz: QuizRow, attempt: AttemptRow) {
    const questions = quiz.shuffleQuestions
      ? seededShuffle(quiz.questions, attempt.id)
      : quiz.questions;
    const now = new Date();
    return {
      attemptId: attempt.id,
      status: 'in_progress' as const,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        instructions: quiz.instructions,
        timeLimitMin: quiz.timeLimitMin,
        closesAt: quiz.closesAt,
      },
      startedAt: attempt.startedAt,
      deadline: attemptDeadline(attempt.startedAt, quiz),
      graceSeconds: GRACE_MS / 1000,
      serverNow: now,
      answers: asAnswers(attempt.answers),
      questions: questions.map((q) => ({
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        options: optionList(q.options),
        points: q.points,
      })),
    };
  }

  private async resultView(
    me: StudentContext,
    quiz: QuizRow,
    attempt: AttemptRow,
  ) {
    const used = await this.prisma.quizAttempt.count({
      where: { studentId: me.id, quizId: quiz.id },
    });
    const canRetry =
      used < quiz.attemptsAllowed && quizWindow(quiz, new Date()) === 'open';
    const showKey = quiz.showResults && !canRetry;
    const answers = asAnswers(attempt.answers);
    const grade = gradeAttempt(
      quiz.questions,
      answers,
      asReview(attempt.review),
    );
    const deadline = attemptDeadline(attempt.startedAt, quiz);
    return {
      attemptId: attempt.id,
      status: 'submitted' as const,
      quiz: { id: quiz.id, title: quiz.title },
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      timedOut: !!(
        deadline &&
        attempt.submittedAt &&
        attempt.submittedAt.getTime() >= deadline.getTime()
      ),
      showResults: quiz.showResults,
      score: quiz.showResults ? attempt.score : null,
      maxScore: attempt.maxScore,
      percent: quiz.showResults
        ? scorePercent(attempt.score, attempt.maxScore)
        : null,
      needsReview: attempt.needsReview,
      attemptsLeft: Math.max(0, quiz.attemptsAllowed - used),
      canRetry,
      answersVisible: showKey,
      // Per-question outcomes give the key away (true/false by elimination),
      // so they only appear once the student cannot try again.
      questions: showKey
        ? quiz.questions.map((q, i) => ({
            id: q.id,
            kind: q.kind,
            prompt: q.prompt,
            options: optionList(q.options),
            points: q.points,
            answer: answers[q.id] ?? null,
            earned: grade.results[i].earned,
            outcome: grade.results[i].outcome,
            correct: q.correct,
          }))
        : null,
    };
  }

  private async findQuiz(user: AuthUser, me: StudentContext, id: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        id: id ?? '',
        schoolId: user.schoolId,
        sectionId: me.sectionId ?? '',
        isPublished: true,
      },
      select: quizSelect,
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    return quiz;
  }

  /** The student's own attempt and its quiz (still published, still their section), or 404. */
  private async findAttempt(user: AuthUser, me: StudentContext, id: string) {
    const attempt = await this.prisma.quizAttempt.findFirst({
      where: {
        id: id ?? '',
        studentId: me.id,
        quiz: { schoolId: user.schoolId, isPublished: true },
      },
      include: { quiz: { select: quizSelect } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    const { quiz, ...row } = attempt;
    return { attempt: row as AttemptRow, quiz };
  }
}
