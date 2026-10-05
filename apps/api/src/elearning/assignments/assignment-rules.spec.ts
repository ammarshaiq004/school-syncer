import {
  dueUrgency,
  gradeProblem,
  hoursLeft,
  isLate,
  openUrgency,
  studentOrder,
  submitBlock,
} from './assignment-rules.js';

const at = (iso: string) => new Date(iso);
const due = at('2026-10-10T19:00:00Z');

describe('submitBlock', () => {
  const before = at('2026-10-10T18:00:00Z');
  const after = at('2026-10-11T08:00:00Z');

  it('allows first submissions and resubmissions before the due date', () => {
    expect(
      submitBlock({ dueAt: due, allowLate: false }, null, before),
    ).toBeNull();
    expect(
      submitBlock(
        { dueAt: due, allowLate: false },
        { status: 'SUBMITTED' },
        before,
      ),
    ).toBeNull();
  });

  it('closes after the due date unless late work is allowed', () => {
    expect(submitBlock({ dueAt: due, allowLate: false }, null, after)).toBe(
      'closed',
    );
    expect(
      submitBlock(
        { dueAt: due, allowLate: false },
        { status: 'SUBMITTED' },
        after,
      ),
    ).toBe('closed');
    expect(
      submitBlock({ dueAt: due, allowLate: true }, null, after),
    ).toBeNull();
  });

  it('locks graded work but reopens returned work', () => {
    expect(
      submitBlock(
        { dueAt: due, allowLate: true },
        { status: 'GRADED' },
        before,
      ),
    ).toBe('graded');
    expect(
      submitBlock(
        { dueAt: due, allowLate: false },
        { status: 'RETURNED' },
        after,
      ),
    ).toBeNull();
  });

  it('treats the exact due time as on time', () => {
    expect(submitBlock({ dueAt: due, allowLate: false }, null, due)).toBeNull();
    expect(isLate(due, due)).toBe(false);
    expect(isLate(due, at('2026-10-10T19:00:01Z'))).toBe(true);
  });
});

describe('dueUrgency / hoursLeft', () => {
  it('buckets by time left', () => {
    expect(dueUrgency(due, at('2026-10-10T20:00:00Z'))).toBe('overdue');
    expect(dueUrgency(due, at('2026-10-10T08:00:00Z'))).toBe('today');
    expect(dueUrgency(due, at('2026-10-08T08:00:00Z'))).toBe('soon');
    expect(dueUrgency(due, at('2026-10-01T08:00:00Z'))).toBe('later');
  });
  it('counts whole hours both ways', () => {
    expect(hoursLeft(due, at('2026-10-10T16:30:00Z'))).toBe(2);
    expect(hoursLeft(due, at('2026-10-10T19:30:00Z'))).toBe(-1);
    expect(hoursLeft(due, due)).toBe(0);
  });
});

describe('openUrgency', () => {
  const past = at('2026-10-12T19:00:00Z');

  it('keeps the urgency while the work is still open', () => {
    expect(openUrgency('pending', due, at('2026-10-10T08:00:00Z'))).toBe('today');
    expect(openUrgency('overdue', due, past)).toBe('overdue');
  });

  it('drops the urgency once the work is handed in, graded or returned', () => {
    for (const state of ['submitted', 'graded', 'returned', 'missing'])
      expect(openUrgency(state, due, past)).toBeNull();
  });
});

describe('gradeProblem', () => {
  it('keeps points within 0..max', () => {
    expect(gradeProblem(10, 10)).toBeNull();
    expect(gradeProblem(0, 10)).toBeNull();
    expect(gradeProblem(11, 10)).toBe('Points cannot be more than 10');
    expect(gradeProblem(-1, 10)).toMatch(/whole number/);
    expect(gradeProblem(2.5, 10)).toMatch(/whole number/);
  });
});

describe('studentOrder', () => {
  it('lists open work by due date, then finished work newest first', () => {
    const rows = [
      { id: 'done-old', state: 'graded', dueAt: at('2026-09-01T00:00:00Z') },
      { id: 'later', state: 'pending', dueAt: at('2026-10-20T00:00:00Z') },
      { id: 'done-new', state: 'submitted', dueAt: at('2026-10-01T00:00:00Z') },
      { id: 'overdue', state: 'overdue', dueAt: at('2026-10-02T00:00:00Z') },
      { id: 'missing', state: 'missing', dueAt: at('2026-09-15T00:00:00Z') },
    ];
    expect(rows.sort(studentOrder).map((r) => r.id)).toEqual([
      'overdue',
      'later',
      'done-new',
      'missing',
      'done-old',
    ]);
  });
});
