import {
  DEFAULT_BANDS,
  gradeFor,
  positions,
  studentResult,
} from './result-calculator.js';

const papers = [
  { id: 'eng', subject: 'English', maxMarks: 100, passMarks: 33 },
  { id: 'math', subject: 'Maths', maxMarks: 50, passMarks: 17 },
];

describe('gradeFor', () => {
  it('picks the highest band reached', () => {
    expect(gradeFor(90, DEFAULT_BANDS).grade).toBe('A+');
    expect(gradeFor(89.99, DEFAULT_BANDS).grade).toBe('A');
    expect(gradeFor(12, DEFAULT_BANDS).grade).toBe('F');
  });

  it('falls back to the default scale and to the lowest band', () => {
    expect(gradeFor(75, []).grade).toBe('B');
    expect(
      gradeFor(10, [
        { grade: 'P', minPercent: 50 },
        { grade: 'X', minPercent: 20 },
      ]).grade,
    ).toBe('X');
  });
});

describe('studentResult', () => {
  it('totals marks across papers', () => {
    const r = studentResult(
      papers,
      [
        { paperId: 'eng', marks: 80, isAbsent: false },
        { paperId: 'math', marks: 40, isAbsent: false },
      ],
      DEFAULT_BANDS,
    );
    expect(r).toMatchObject({
      obtained: 120,
      maxTotal: 150,
      percent: 80,
      grade: 'A',
      passed: true,
    });
  });

  it('fails a student who is absent or below pass marks in any paper', () => {
    const absent = studentResult(
      papers,
      [
        { paperId: 'eng', marks: 95, isAbsent: false },
        { paperId: 'math', marks: 45, isAbsent: true },
      ],
      DEFAULT_BANDS,
    );
    expect(absent.obtained).toBe(95);
    expect(absent.passed).toBe(false);
    expect(absent.subjects[1]).toMatchObject({
      absent: true,
      marks: null,
      passed: false,
    });

    const low = studentResult(
      papers,
      [
        { paperId: 'eng', marks: 32, isAbsent: false },
        { paperId: 'math', marks: 50, isAbsent: false },
      ],
      DEFAULT_BANDS,
    );
    expect(low.passed).toBe(false);
  });

  it('rounds the percentage to two places', () => {
    expect(
      studentResult(
        papers,
        [{ paperId: 'eng', marks: 100, isAbsent: false }],
        [],
      ).percent,
    ).toBe(66.67);
  });
});

describe('positions', () => {
  it('gives tied scores the same position and skips the next', () => {
    const p = positions([
      { id: 'a', percent: 70 },
      { id: 'b', percent: 90 },
      { id: 'c', percent: 70 },
      { id: 'd', percent: 50 },
    ]);
    expect([p.get('b'), p.get('a'), p.get('c'), p.get('d')]).toEqual([
      1, 2, 2, 4,
    ]);
  });
});
