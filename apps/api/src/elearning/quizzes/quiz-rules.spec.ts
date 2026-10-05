import {
  attemptDeadline,
  GRACE_MS,
  isPastGrace,
  normalizeQuestion,
  questionProblem,
  quizWindow,
  scorePercent,
  seededShuffle,
  windowProblem,
} from './quiz-rules.js';

const at = (iso: string) => new Date(iso);

describe('normalizeQuestion / questionProblem', () => {
  it('fixes TRUE_FALSE options and sorts the key', () => {
    const q = normalizeQuestion({
      kind: 'TRUE_FALSE',
      prompt: ' The sun is a star ',
      options: [],
      correct: [0],
      points: 1,
    });
    expect(q).toMatchObject({
      prompt: 'The sun is a star',
      options: ['True', 'False'],
      correct: [0],
    });
    expect(questionProblem(q)).toBeNull();
  });

  it('cleans SHORT accepted answers', () => {
    const q = normalizeQuestion({
      kind: 'SHORT',
      prompt: 'Capital?',
      options: ['x'],
      correct: [' Islamabad ', 'islamabad', '', 3],
      points: 2,
    });
    expect(q).toMatchObject({ options: [], correct: ['Islamabad'] });
    expect(questionProblem(q)).toBeNull();
    expect(questionProblem(normalizeQuestion({ ...q, correct: [] }))).toBe(
      'Add at least one accepted answer',
    );
  });

  it('validates choice questions', () => {
    const base = {
      kind: 'SINGLE' as const,
      prompt: 'Pick',
      options: ['A', 'B', 'C'],
      correct: [1],
      points: 1,
    };
    expect(questionProblem(normalizeQuestion(base))).toBeNull();
    expect(
      questionProblem(normalizeQuestion({ ...base, options: ['A'] })),
    ).toBe('Add at least two options');
    expect(
      questionProblem(normalizeQuestion({ ...base, options: ['A', ' '] })),
    ).toBe('Options cannot be blank');
    expect(
      questionProblem(normalizeQuestion({ ...base, options: ['A', 'a '] })),
    ).toBe('Options must be different from each other');
    expect(questionProblem(normalizeQuestion({ ...base, correct: [] }))).toBe(
      'Mark the correct option',
    );
    expect(questionProblem(normalizeQuestion({ ...base, correct: [5] }))).toBe(
      'The correct option is not in the list',
    );
    expect(
      questionProblem(normalizeQuestion({ ...base, correct: [0, 1] })),
    ).toBe('Mark exactly one correct option');
    expect(
      questionProblem(
        normalizeQuestion({ ...base, kind: 'MULTI', correct: [0, 1] }),
      ),
    ).toBeNull();
    expect(
      questionProblem(normalizeQuestion({ ...base, correct: ['A'] })),
    ).toBe('Mark the correct option');
    expect(questionProblem({ ...base, prompt: '  ' })).toBe(
      'Write the question',
    );
    expect(questionProblem({ ...base, points: 101 })).toMatch(/Points/);
    expect(
      questionProblem(
        normalizeQuestion({
          ...base,
          options: Array.from({ length: 11 }, (_, i) => `o${i}`),
        }),
      ),
    ).toBe('Use at most ten options');
  });
});

describe('attemptDeadline / isPastGrace', () => {
  const start = at('2026-10-05T09:00:00Z');

  it('uses the time limit', () => {
    expect(
      attemptDeadline(start, { timeLimitMin: 20, closesAt: null }),
    ).toEqual(at('2026-10-05T09:20:00Z'));
  });

  it('never runs past the closing time', () => {
    expect(
      attemptDeadline(start, {
        timeLimitMin: 60,
        closesAt: at('2026-10-05T09:30:00Z'),
      }),
    ).toEqual(at('2026-10-05T09:30:00Z'));
    expect(
      attemptDeadline(start, {
        timeLimitMin: null,
        closesAt: at('2026-10-05T10:00:00Z'),
      }),
    ).toEqual(at('2026-10-05T10:00:00Z'));
  });

  it('has no deadline without limit or close', () => {
    expect(
      attemptDeadline(start, { timeLimitMin: null, closesAt: null }),
    ).toBeNull();
    expect(isPastGrace(null, at('2030-01-01T00:00:00Z'))).toBe(false);
  });

  it('allows a 60 second grace period', () => {
    const deadline = at('2026-10-05T09:20:00Z');
    expect(GRACE_MS).toBe(60_000);
    expect(isPastGrace(deadline, at('2026-10-05T09:20:59Z'))).toBe(false);
    expect(isPastGrace(deadline, at('2026-10-05T09:21:00Z'))).toBe(false);
    expect(isPastGrace(deadline, at('2026-10-05T09:21:01Z'))).toBe(true);
  });
});

describe('quizWindow / windowProblem', () => {
  const now = at('2026-10-05T12:00:00Z');
  it('reports upcoming, open and closed', () => {
    expect(quizWindow({ opensAt: null, closesAt: null }, now)).toBe('open');
    expect(
      quizWindow({ opensAt: at('2026-10-05T13:00:00Z'), closesAt: null }, now),
    ).toBe('upcoming');
    expect(quizWindow({ opensAt: null, closesAt: now }, now)).toBe('closed');
    expect(
      quizWindow(
        {
          opensAt: at('2026-10-05T11:00:00Z'),
          closesAt: at('2026-10-05T13:00:00Z'),
        },
        now,
      ),
    ).toBe('open');
  });
  it('rejects a close before the open', () => {
    expect(windowProblem(now, at('2026-10-05T11:00:00Z'))).toMatch(
      /close after/,
    );
    expect(windowProblem(now, now)).toMatch(/close after/);
    expect(windowProblem(null, now)).toBeNull();
  });
});

describe('seededShuffle', () => {
  const items = Array.from({ length: 12 }, (_, i) => i);
  it('is stable per seed and keeps every item', () => {
    const a = seededShuffle(items, 'attempt-1');
    expect(seededShuffle(items, 'attempt-1')).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });
  it('differs between seeds', () => {
    expect(seededShuffle(items, 'attempt-1')).not.toEqual(
      seededShuffle(items, 'attempt-2'),
    );
  });
  it('handles tiny lists', () => {
    expect(seededShuffle([], 'x')).toEqual([]);
    expect(seededShuffle([1], 'x')).toEqual([1]);
  });
});

describe('scorePercent', () => {
  it('rounds to one decimal and handles empty quizzes', () => {
    expect(scorePercent(2, 3)).toBe(66.7);
    expect(scorePercent(0, 0)).toBe(0);
    expect(scorePercent(null, 10)).toBeNull();
  });
});
