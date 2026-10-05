import {
  acceptedAnswers,
  clampPoints,
  correctIndexes,
  type GradableQuestion,
  gradeAttempt,
  gradeQuestion,
  maxScore,
  normalizeShort,
  optionList,
  reviewProblems,
  sanitizeAnswers,
  sanitizeReview,
} from './quiz-grader.js';

const single: GradableQuestion = {
  id: 'q1',
  kind: 'SINGLE',
  options: ['Lahore', 'Karachi', 'Quetta'],
  correct: [1],
  points: 2,
};
const multi: GradableQuestion = {
  id: 'q2',
  kind: 'MULTI',
  options: ['2', '3', '4', '5'],
  correct: [0, 1, 3],
  points: 3,
};
const tf: GradableQuestion = {
  id: 'q3',
  kind: 'TRUE_FALSE',
  options: ['True', 'False'],
  correct: [0],
  points: 1,
};
const short: GradableQuestion = {
  id: 'q4',
  kind: 'SHORT',
  options: [],
  correct: ['Islamabad', 'islamabad capital territory'],
  points: 4,
};
const quiz = [single, multi, tf, short];

describe('normalizeShort', () => {
  it('lower-cases, trims and collapses inner whitespace', () => {
    expect(normalizeShort('  New\t  Delhi \n')).toBe('new delhi');
    expect(normalizeShort('')).toBe('');
  });
});

describe('Json helpers', () => {
  it('reads options, keys and accepted answers defensively', () => {
    expect(optionList(['a', 2, 'b'])).toEqual(['a', 'b']);
    expect(optionList(null)).toEqual([]);
    expect(correctIndexes([2, 0, 2, 1.5, 'x'])).toEqual([0, 2]);
    expect(correctIndexes('0')).toEqual([]);
    expect(acceptedAnswers([' Karachi ', 3, ''])).toEqual(['karachi']);
    expect(acceptedAnswers({})).toEqual([]);
  });
});

describe('gradeQuestion', () => {
  it('SINGLE: exact match only', () => {
    expect(gradeQuestion(single, [1])).toMatchObject({
      earned: 2,
      outcome: 'correct',
    });
    expect(gradeQuestion(single, [0])).toMatchObject({
      earned: 0,
      outcome: 'incorrect',
    });
    // Picking two options for a single-answer question is wrong even if one is right.
    expect(gradeQuestion(single, [0, 1])).toMatchObject({
      earned: 0,
      outcome: 'incorrect',
    });
    expect(gradeQuestion(single, [])).toMatchObject({
      earned: 0,
      outcome: 'unanswered',
    });
    expect(gradeQuestion(single, undefined)).toMatchObject({
      earned: 0,
      outcome: 'unanswered',
    });
    expect(gradeQuestion(single, 'Karachi')).toMatchObject({
      earned: 0,
      outcome: 'unanswered',
    });
  });

  it('TRUE_FALSE: exact match', () => {
    expect(gradeQuestion(tf, [0])).toMatchObject({
      earned: 1,
      outcome: 'correct',
    });
    expect(gradeQuestion(tf, [1])).toMatchObject({
      earned: 0,
      outcome: 'incorrect',
    });
  });

  it('MULTI: all-or-nothing regardless of order or duplicates', () => {
    expect(gradeQuestion(multi, [3, 0, 1])).toMatchObject({
      earned: 3,
      outcome: 'correct',
    });
    expect(gradeQuestion(multi, [0, 1, 1, 3])).toMatchObject({
      earned: 3,
      outcome: 'correct',
    });
    expect(gradeQuestion(multi, [0, 1])).toMatchObject({
      earned: 0,
      outcome: 'incorrect',
    });
    expect(gradeQuestion(multi, [0, 1, 2, 3])).toMatchObject({
      earned: 0,
      outcome: 'incorrect',
    });
  });

  it('SHORT: case and space insensitive match against accepted answers', () => {
    expect(gradeQuestion(short, '  ISLAMABAD ')).toMatchObject({
      earned: 4,
      outcome: 'correct',
    });
    expect(
      gradeQuestion(short, 'Islamabad   Capital  Territory'),
    ).toMatchObject({ earned: 4, outcome: 'correct' });
  });

  it('SHORT: a non-matching answer waits for review and counts 0', () => {
    expect(gradeQuestion(short, 'Isloo')).toMatchObject({
      earned: 0,
      outcome: 'pending',
    });
  });

  it('SHORT: blank or non-text answers are unanswered, never pending', () => {
    expect(gradeQuestion(short, '   ')).toMatchObject({
      earned: 0,
      outcome: 'unanswered',
    });
    expect(gradeQuestion(short, [0])).toMatchObject({
      earned: 0,
      outcome: 'unanswered',
    });
  });

  it('SHORT: teacher review wins and is clamped', () => {
    expect(gradeQuestion(short, 'Isloo', 2.5)).toMatchObject({
      earned: 2.5,
      outcome: 'reviewed',
    });
    expect(gradeQuestion(short, 'Islamabad', 1)).toMatchObject({
      earned: 1,
      outcome: 'reviewed',
    });
    expect(gradeQuestion(short, 'Isloo', 99)).toMatchObject({ earned: 4 });
    expect(gradeQuestion(short, 'Isloo', -3)).toMatchObject({ earned: 0 });
  });

  it('ignores a malformed answer key instead of throwing', () => {
    const broken: GradableQuestion = {
      id: 'x',
      kind: 'SINGLE',
      options: ['a', 'b'],
      correct: 'a',
      points: 1,
    };
    expect(gradeQuestion(broken, [0])).toMatchObject({
      earned: 0,
      outcome: 'incorrect',
    });
  });
});

describe('gradeAttempt', () => {
  it('adds up points and reports the maximum', () => {
    const g = gradeAttempt(quiz, {
      q1: [1],
      q2: [0, 1, 3],
      q3: [0],
      q4: 'islamabad',
    });
    expect(g).toMatchObject({ score: 10, maxScore: 10, needsReview: false });
    expect(g.results.map((r) => r.outcome)).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
    ]);
  });

  it('flags pending short answers and counts them as 0 for now', () => {
    const g = gradeAttempt(quiz, { q1: [1], q2: [0], q4: 'Pindi' });
    expect(g).toMatchObject({ score: 2, maxScore: 10, needsReview: true });
  });

  it('clears needsReview once the teacher has reviewed every pending answer', () => {
    const g = gradeAttempt(quiz, { q1: [1], q4: 'Pindi' }, { q4: 1 });
    expect(g).toMatchObject({ score: 3, needsReview: false });
  });

  it('handles empty answers and null review', () => {
    expect(gradeAttempt(quiz, null, null)).toMatchObject({
      score: 0,
      maxScore: 10,
      needsReview: false,
    });
    expect(gradeAttempt([], {})).toMatchObject({
      score: 0,
      maxScore: 0,
      needsReview: false,
    });
  });

  it('rounds to one decimal place', () => {
    const qs: GradableQuestion[] = [
      { ...short, id: 'a', points: 1 },
      { ...short, id: 'b', points: 1 },
    ];
    expect(
      gradeAttempt(qs, { a: 'x', b: 'y' }, { a: 0.33, b: 0.33 }).score,
    ).toBe(0.6);
  });
});

describe('maxScore and clampPoints', () => {
  it('ignores negative points', () => {
    expect(maxScore([{ points: 2 }, { points: -1 }, { points: 3 }])).toBe(5);
    expect(clampPoints(Number.NaN, 4)).toBe(0);
    expect(clampPoints(1.26, 4)).toBe(1.3);
  });
});

describe('sanitizeAnswers', () => {
  it('keeps valid answers and drops unknown questions and bad indexes', () => {
    const clean = sanitizeAnswers(quiz, {
      q1: [1, 2],
      q2: [3, 3, 0, 9, -1, 'a'],
      q3: 1,
      q4: '  Islamabad  ',
      nope: [0],
    });
    expect(clean).toEqual({ q1: [1], q2: [0, 3], q3: [1], q4: 'Islamabad' });
  });

  it('drops wrong shapes', () => {
    expect(sanitizeAnswers(quiz, { q1: 'Karachi', q4: [1] })).toEqual({});
    expect(sanitizeAnswers(quiz, null)).toEqual({});
    expect(sanitizeAnswers(quiz, [1, 2])).toEqual({});
  });

  it('caps short answers at 1000 characters', () => {
    expect(
      (sanitizeAnswers(quiz, { q4: 'a'.repeat(5000) }).q4 as string).length,
    ).toBe(1000);
  });

  it('does not read inherited properties', () => {
    const proto = { q1: [1] };
    expect(sanitizeAnswers(quiz, Object.create(proto))).toEqual({});
  });
});

describe('review helpers', () => {
  it('only accepts SHORT questions of the quiz', () => {
    expect(reviewProblems(quiz, { q4: 2, q1: 1, other: 1 })).toEqual([
      'q1',
      'other',
    ]);
    expect(sanitizeReview(quiz, { q4: 7, q1: 1 })).toEqual({ q4: 4 });
  });
});
