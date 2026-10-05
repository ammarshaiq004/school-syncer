/**
 * Pure quiz marking (SCHOOL-103). No Prisma or Nest here so every rule is unit
 * tested on its own.
 *
 * Rules:
 * - SINGLE and TRUE_FALSE: the one chosen option must be the correct one.
 * - MULTI: all-or-nothing. The chosen set must equal the correct set exactly;
 *   picking an extra wrong option or missing a right one scores 0. (Partial
 *   credit rewards guessing every box, so we keep the stricter rule.)
 * - SHORT: compared case-insensitively with surrounding/inner whitespace
 *   collapsed against the accepted answers. A match earns full points; a
 *   non-blank answer that does not match waits for the teacher (needsReview)
 *   and counts 0 until reviewed. A teacher's review points always win.
 * - Blank answers score 0 and never need review.
 */

export type QuestionKindName = 'SINGLE' | 'MULTI' | 'TRUE_FALSE' | 'SHORT';

export interface GradableQuestion {
  id: string;
  kind: QuestionKindName;
  /** string[] of choices (unused for SHORT). Json from the database. */
  options: unknown;
  /** number[] of correct option indexes, or string[] of accepted SHORT answers. */
  correct: unknown;
  points: number;
}

/** What a student answered: option indexes for choice questions, text for SHORT. */
export type Answer = number[] | string;
export type Answers = Record<string, Answer>;
/** Teacher points for SHORT answers, keyed by question id. */
export type Review = Record<string, number>;

export type QuestionOutcome =
  'correct' | 'incorrect' | 'unanswered' | 'pending' | 'reviewed';

export interface QuestionResult {
  questionId: string;
  earned: number;
  points: number;
  outcome: QuestionOutcome;
}

export interface AttemptGrade {
  score: number;
  maxScore: number;
  needsReview: boolean;
  results: QuestionResult[];
}

/** Lower-cases and collapses whitespace so "  New   Delhi " matches "new delhi". */
export function normalizeShort(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Choice options as strings; anything malformed becomes an empty list. */
export function optionList(options: unknown): string[] {
  return Array.isArray(options)
    ? options.filter((o): o is string => typeof o === 'string')
    : [];
}

/** Correct option indexes (choice questions), de-duplicated and sorted. */
export function correctIndexes(correct: unknown): number[] {
  if (!Array.isArray(correct)) return [];
  return [
    ...new Set(correct.filter((c): c is number => Number.isInteger(c))),
  ].sort((a, b) => a - b);
}

/** Accepted SHORT answers, normalised. */
export function acceptedAnswers(correct: unknown): string[] {
  if (!Array.isArray(correct)) return [];
  return correct
    .filter((c): c is string => typeof c === 'string')
    .map(normalizeShort)
    .filter(Boolean);
}

function chosenIndexes(answer: Answer | undefined): number[] {
  if (!Array.isArray(answer)) return [];
  return [...new Set(answer.filter((a) => Number.isInteger(a)))].sort(
    (a, b) => a - b,
  );
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Clamps teacher points to 0..max (one decimal place). */
export function clampPoints(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), max) * 10) / 10;
}

/** Marks one question. `reviewPoints` is the teacher's score for a SHORT answer, if any. */
export function gradeQuestion(
  q: GradableQuestion,
  answer: Answer | undefined,
  reviewPoints?: number,
): QuestionResult {
  const points = Math.max(0, q.points);
  const base = { questionId: q.id, points };
  if (q.kind === 'SHORT') {
    const text = typeof answer === 'string' ? normalizeShort(answer) : '';
    if (!text) return { ...base, earned: 0, outcome: 'unanswered' };
    if (reviewPoints !== undefined)
      return {
        ...base,
        earned: clampPoints(reviewPoints, points),
        outcome: 'reviewed',
      };
    if (acceptedAnswers(q.correct).includes(text))
      return { ...base, earned: points, outcome: 'correct' };
    return { ...base, earned: 0, outcome: 'pending' };
  }
  const chosen = chosenIndexes(answer);
  if (!chosen.length) return { ...base, earned: 0, outcome: 'unanswered' };
  const key = correctIndexes(q.correct);
  if (q.kind === 'MULTI') {
    return sameSet(chosen, key)
      ? { ...base, earned: points, outcome: 'correct' }
      : { ...base, earned: 0, outcome: 'incorrect' };
  }
  // SINGLE / TRUE_FALSE: exactly one choice, and it must be correct.
  return chosen.length === 1 && key.includes(chosen[0])
    ? { ...base, earned: points, outcome: 'correct' }
    : { ...base, earned: 0, outcome: 'incorrect' };
}

/**
 * Marks a whole attempt. score counts pending SHORT answers as 0 and is
 * rounded to one decimal; needsReview is true while any SHORT answer waits
 * for the teacher.
 */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Answers | null | undefined,
  review: Review | null | undefined = {},
): AttemptGrade {
  const results = questions.map((q) =>
    gradeQuestion(q, answers?.[q.id], review?.[q.id]),
  );
  const score =
    Math.round(results.reduce((sum, r) => sum + r.earned, 0) * 10) / 10;
  return {
    score,
    maxScore: maxScore(questions),
    needsReview: results.some((r) => r.outcome === 'pending'),
    results,
  };
}

export function maxScore(questions: { points: number }[]): number {
  return questions.reduce((sum, q) => sum + Math.max(0, q.points), 0);
}

/**
 * Keeps only answers to questions of this quiz, in the right shape: valid,
 * de-duplicated option indexes for choice questions (at most one for
 * SINGLE/TRUE_FALSE) and trimmed text up to 1000 characters for SHORT.
 * Unknown ids and malformed values are dropped silently.
 */
export function sanitizeAnswers(
  questions: GradableQuestion[],
  raw: unknown,
): Answers {
  const clean: Answers = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  const input = raw as Record<string, unknown>;
  for (const q of questions) {
    if (!Object.hasOwn(input, q.id)) continue;
    const value = input[q.id];
    if (q.kind === 'SHORT') {
      if (typeof value === 'string') clean[q.id] = value.trim().slice(0, 1000);
      continue;
    }
    const list = Array.isArray(value)
      ? value
      : Number.isInteger(value)
        ? [value]
        : null;
    if (!list) continue;
    const count = optionList(q.options).length;
    const indexes = chosenIndexes(
      list.filter(
        (i): i is number => Number.isInteger(i) && i >= 0 && i < count,
      ),
    );
    clean[q.id] = q.kind === 'MULTI' ? indexes : indexes.slice(0, 1);
  }
  return clean;
}

/** Teacher review points limited to SHORT questions of this quiz, clamped to each question's points. */
export function sanitizeReview(
  questions: GradableQuestion[],
  raw: Record<string, number>,
): Review {
  const review: Review = {};
  for (const q of questions) {
    if (q.kind !== 'SHORT' || !Object.hasOwn(raw, q.id)) continue;
    review[q.id] = clampPoints(raw[q.id], Math.max(0, q.points));
  }
  return review;
}

/** Ids in `raw` that are not SHORT questions of this quiz (for a clear 400). */
export function reviewProblems(
  questions: GradableQuestion[],
  raw: Record<string, number>,
): string[] {
  const short = new Set(
    questions.filter((q) => q.kind === 'SHORT').map((q) => q.id),
  );
  return Object.keys(raw).filter((id) => !short.has(id));
}
