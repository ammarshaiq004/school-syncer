import { DEFAULT_BANDS } from '../exams/result-calculator.js';
import {
  assignmentCell,
  average,
  counts,
  examCell,
  letterGrade,
  overallPercent,
  quizCell,
} from './gradebook-rules.js';

describe('overallPercent', () => {
  it('is sum of scores over sum of max for graded cells', () => {
    expect(
      overallPercent([
        { score: 40, max: 50, status: 'graded' },
        { score: 15, max: 20, status: 'graded' },
      ]),
    ).toBe(78.6);
  });

  it('leaves missing and ungraded work out, and counts absent as zero', () => {
    expect(
      overallPercent([
        { score: 45, max: 50, status: 'graded' },
        { score: null, max: 100, status: 'missing' },
        { score: null, max: 20, status: 'submitted' },
        { score: 0, max: 50, status: 'absent' },
      ]),
    ).toBe(45);
  });

  it('counts a quiz waiting for review with its provisional score', () => {
    expect(
      overallPercent([
        { score: 8, max: 10, status: 'review' },
        { score: 10, max: 10, status: 'graded' },
      ]),
    ).toBe(90);
  });

  it('is null when nothing counts yet', () => {
    expect(overallPercent([])).toBeNull();
    expect(
      overallPercent([{ score: null, max: 10, status: 'missing' }]),
    ).toBeNull();
    expect(overallPercent([{ score: 5, max: 0, status: 'graded' }])).toBeNull();
  });

  it('caps a score at the maximum', () => {
    expect(overallPercent([{ score: 30, max: 20, status: 'graded' }])).toBe(
      100,
    );
  });
});

describe('letterGrade', () => {
  const bands = [
    { grade: 'A', minPercent: 80 },
    { grade: 'B', minPercent: 60 },
    { grade: 'F', minPercent: 0 },
  ];

  it('uses the school bands', () => {
    expect(letterGrade(80, bands)).toBe('A');
    expect(letterGrade(79.9, bands)).toBe('B');
    expect(letterGrade(12, bands)).toBe('F');
  });

  it('falls back to the default scale and keeps null', () => {
    expect(letterGrade(91, [])).toBe('A+');
    expect(letterGrade(91, DEFAULT_BANDS)).toBe('A+');
    expect(letterGrade(null, bands)).toBeNull();
  });
});

describe('cells', () => {
  it('reads exam marks', () => {
    expect(examCell(undefined, 50)).toEqual({
      score: null,
      max: 50,
      status: 'missing',
    });
    expect(examCell({ marks: null, isAbsent: true }, 50)).toEqual({
      score: 0,
      max: 50,
      status: 'absent',
    });
    expect(examCell({ marks: 33, isAbsent: false }, 50)).toEqual({
      score: 33,
      max: 50,
      status: 'graded',
    });
  });

  it('reads assignment submissions', () => {
    expect(assignmentCell(undefined, 20).status).toBe('missing');
    expect(assignmentCell({ points: null }, 20).status).toBe('submitted');
    expect(assignmentCell({ points: 0 }, 20)).toEqual({
      score: 0,
      max: 20,
      status: 'graded',
    });
  });

  it('reads the best quiz attempt', () => {
    expect(quizCell(null, false, 10).status).toBe('missing');
    expect(quizCell({ score: 6, maxScore: 8 }, true, 10)).toEqual({
      score: 6,
      max: 8,
      status: 'review',
    });
    expect(counts(quizCell({ score: 6, maxScore: 8 }, false, 10))).toBe(true);
  });
});

describe('average', () => {
  it('skips nulls', () => {
    expect(average([80, null, 70])).toBe(75);
    expect(average([null])).toBeNull();
  });
});
