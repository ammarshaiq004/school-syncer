import {
  correctIndexes,
  optionList,
  type QuestionKindName,
} from './quiz-grader.js';

/**
 * Pure quiz rules other than marking: question validation, the server-side
 * time limit, the per-attempt question order and what a quiz looks like to a
 * student right now.
 */

/** Late answers are still accepted this long after the time limit (network lag, slow clicks). */
export const GRACE_MS = 60_000;

export const TRUE_FALSE_OPTIONS = ['True', 'False'];

export interface QuestionInput {
  kind: QuestionKindName;
  prompt: string;
  options: string[];
  correct: (number | string)[];
  points: number;
}

/**
 * Normalises a question before it is stored: TRUE_FALSE always gets
 * ["True","False"], SHORT has no options and keeps trimmed, de-duplicated
 * accepted answers; choice questions keep trimmed options and sorted unique
 * indexes.
 */
export function normalizeQuestion(q: QuestionInput): QuestionInput {
  const prompt = q.prompt.trim();
  if (q.kind === 'SHORT') {
    const seen = new Set<string>();
    const accepted: string[] = [];
    for (const c of q.correct) {
      if (typeof c !== 'string') continue;
      const text = c.trim().replace(/\s+/g, ' ');
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      accepted.push(text);
    }
    return { ...q, prompt, options: [], correct: accepted };
  }
  const options =
    q.kind === 'TRUE_FALSE'
      ? TRUE_FALSE_OPTIONS
      : q.options.map((o) => o.trim());
  return { ...q, prompt, options, correct: correctIndexes(q.correct) };
}

/** Why a (normalised) question cannot be saved, or null when it is fine. */
export function questionProblem(q: QuestionInput): string | null {
  if (!q.prompt.trim()) return 'Write the question';
  if (!Number.isInteger(q.points) || q.points < 0 || q.points > 100)
    return 'Points must be a whole number from 0 to 100';
  if (q.kind === 'SHORT') {
    return q.correct.length ? null : 'Add at least one accepted answer';
  }
  const options = optionList(q.options);
  if (options.length !== q.options.length) return 'Options must be text';
  if (q.kind !== 'TRUE_FALSE') {
    if (options.length < 2) return 'Add at least two options';
    if (options.length > 10) return 'Use at most ten options';
    if (options.some((o) => !o.trim())) return 'Options cannot be blank';
    const lower = options.map((o) => o.trim().toLowerCase());
    if (new Set(lower).size !== lower.length)
      return 'Options must be different from each other';
  }
  if (q.correct.some((c) => typeof c !== 'number'))
    return 'Mark the correct option';
  const key = q.correct as number[];
  if (key.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length))
    return 'The correct option is not in the list';
  if (!key.length) return 'Mark the correct option';
  if (q.kind !== 'MULTI' && key.length !== 1)
    return 'Mark exactly one correct option';
  return null;
}

/**
 * When an attempt must be in: startedAt + time limit, but never after the
 * quiz closes. null means no deadline (no limit and no closing time).
 */
export function attemptDeadline(
  startedAt: Date,
  quiz: { timeLimitMin: number | null; closesAt: Date | null },
): Date | null {
  const byLimit = quiz.timeLimitMin
    ? startedAt.getTime() + quiz.timeLimitMin * 60_000
    : null;
  const byClose = quiz.closesAt ? quiz.closesAt.getTime() : null;
  const times = [byLimit, byClose].filter((t): t is number => t !== null);
  return times.length ? new Date(Math.min(...times)) : null;
}

/** True once the deadline plus the grace period has passed: answers sent now are ignored. */
export function isPastGrace(deadline: Date | null, now: Date): boolean {
  return deadline !== null && now.getTime() > deadline.getTime() + GRACE_MS;
}

export type QuizWindow = 'upcoming' | 'open' | 'closed';

/** Whether a published quiz can be started now. */
export function quizWindow(
  q: { opensAt: Date | null; closesAt: Date | null },
  now: Date,
): QuizWindow {
  if (q.opensAt && q.opensAt.getTime() > now.getTime()) return 'upcoming';
  if (q.closesAt && q.closesAt.getTime() <= now.getTime()) return 'closed';
  return 'open';
}

/** Why opensAt/closesAt cannot be used together, or null. */
export function windowProblem(
  opensAt: Date | null,
  closesAt: Date | null,
): string | null {
  if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime())
    return 'The quiz must close after it opens';
  return null;
}

/** 32-bit FNV-1a hash of a string, used as a shuffle seed. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A stable shuffle of `items` for one attempt: the same seed (attempt id)
 * always gives the same order, so resuming an attempt does not reshuffle.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let state = hash(seed) || 1;
  const next = () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Percentage to one decimal place; 0 when nothing is possible. */
export function scorePercent(score: number | null, max: number): number | null {
  if (score === null) return null;
  return max > 0 ? Math.round((score / max) * 1000) / 10 : 0;
}
