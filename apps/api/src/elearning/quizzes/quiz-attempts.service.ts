import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type Answers,
  gradeAttempt,
  type GradableQuestion,
  type Review,
  sanitizeAnswers,
} from './quiz-grader.js';
import { attemptDeadline, isPastGrace } from './quiz-rules.js';

export const questionOrder = [
  { sortOrder: 'asc' as const },
  { id: 'asc' as const },
];

export const questionSelect = {
  id: true,
  kind: true,
  prompt: true,
  options: true,
  correct: true,
  points: true,
  sortOrder: true,
} satisfies Prisma.QuizQuestionSelect;

export type QuizForGrading = {
  timeLimitMin: number | null;
  closesAt: Date | null;
  questions: GradableQuestion[];
};

export type AttemptRow = {
  id: string;
  startedAt: Date;
  submittedAt: Date | null;
  answers: Prisma.JsonValue;
  review: Prisma.JsonValue | null;
};

export function asAnswers(json: Prisma.JsonValue | null | undefined): Answers {
  return json && typeof json === 'object' && !Array.isArray(json)
    ? (json as unknown as Answers)
    : {};
}

export function asReview(json: Prisma.JsonValue | null | undefined): Review {
  return json && typeof json === 'object' && !Array.isArray(json)
    ? (json as unknown as Review)
    : {};
}

/**
 * Submitting and auto-closing quiz attempts. The time limit lives on the
 * server: once an attempt is past its deadline plus the grace period, new
 * answers are ignored and it is marked with what was saved so far.
 */
@Injectable()
export class QuizAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks an in-progress attempt as submitted. `incoming` answers are merged
   * over the saved ones unless the attempt is already past its grace period.
   * Returns null when the attempt was already submitted (e.g. a double click).
   */
  async finalize(
    attempt: AttemptRow,
    quiz: QuizForGrading,
    incoming?: unknown,
    now = new Date(),
  ) {
    if (attempt.submittedAt) return null;
    const deadline = attemptDeadline(attempt.startedAt, quiz);
    const expired = isPastGrace(deadline, now);
    const answers = asAnswers(attempt.answers);
    const merged =
      expired || incoming === undefined
        ? answers
        : { ...answers, ...sanitizeAnswers(quiz.questions, incoming) };
    const grade = gradeAttempt(
      quiz.questions,
      merged,
      asReview(attempt.review),
    );
    const submittedAt = expired && deadline ? deadline : now;
    const { count } = await this.prisma.quizAttempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: {
        answers: merged as Prisma.InputJsonValue,
        submittedAt,
        score: grade.score,
        maxScore: grade.maxScore,
        needsReview: grade.needsReview,
      },
    });
    return count ? { submittedAt, expired, grade, answers: merged } : null;
  }

  /** Submits every matching in-progress attempt that has run out of time. Returns how many closed. */
  async closeExpired(where: Prisma.QuizAttemptWhereInput, now = new Date()) {
    const open = await this.prisma.quizAttempt.findMany({
      where: {
        ...where,
        submittedAt: null,
        quiz: {
          OR: [{ timeLimitMin: { not: null } }, { closesAt: { not: null } }],
        },
      },
      select: {
        id: true,
        startedAt: true,
        submittedAt: true,
        answers: true,
        review: true,
        quiz: {
          select: {
            timeLimitMin: true,
            closesAt: true,
            questions: { orderBy: questionOrder, select: questionSelect },
          },
        },
      },
      take: 500,
    });
    let closed = 0;
    for (const attempt of open) {
      if (!isPastGrace(attemptDeadline(attempt.startedAt, attempt.quiz), now))
        continue;
      if (await this.finalize(attempt, attempt.quiz, undefined, now)) closed++;
    }
    return closed;
  }
}
