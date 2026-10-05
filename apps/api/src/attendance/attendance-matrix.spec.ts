import { attendanceRate, buildMatrix, monthBounds, monthDays } from './attendance-matrix.js';

describe('monthBounds', () => {
  it('spans a month, across a year end', () => {
    expect(monthBounds('2026-10')).toEqual({ start: '2026-10-01', end: '2026-11-01' });
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });
});

describe('monthDays', () => {
  it('lists every day, with Sundays off unless a register was taken', () => {
    // October 2026: the 4th is a Sunday.
    const days = monthDays('2026-10', new Map([['2026-10-11', 's11'], ['2026-10-05', 's5']]));
    expect(days).toHaveLength(31);
    expect(days[3]).toEqual({ date: '2026-10-04', isSchoolDay: false, sessionId: null });
    expect(days[4]).toEqual({ date: '2026-10-05', isSchoolDay: true, sessionId: 's5' });
    expect(days[10]).toEqual({ date: '2026-10-11', isSchoolDay: true, sessionId: 's11' });
    expect(days.filter((d) => d.isSchoolDay)).toHaveLength(27 + 1);
  });

  it('handles February in a leap year', () => {
    expect(monthDays('2028-02', new Map())).toHaveLength(29);
  });
});

describe('attendanceRate', () => {
  it('counts present and late as attended, leave as missed', () => {
    expect(attendanceRate({ PRESENT: 6, LATE: 1, ABSENT: 2, LEAVE: 1 })).toBe(70);
    expect(attendanceRate({ PRESENT: 2, ABSENT: 1 })).toBe(66.7);
  });

  it('is null when nothing was marked', () => {
    expect(attendanceRate({})).toBeNull();
  });
});

describe('buildMatrix', () => {
  const students = [
    { id: 'a', name: 'Ahmed Khan', admissionNo: '1', rollNo: 1, photoUrl: null },
    { id: 'b', name: 'Sana Iqbal', admissionNo: '2', rollNo: 2, photoUrl: null },
  ];
  const days = monthDays('2026-10', new Map([['2026-10-01', 's1'], ['2026-10-02', 's2']]));

  it('builds per-student statuses and per-day totals, ignoring students no longer enrolled', () => {
    const { students: rows, totals } = buildMatrix(
      students,
      [
        { studentId: 'a', date: '2026-10-01', status: 'PRESENT' },
        { studentId: 'a', date: '2026-10-02', status: 'LATE' },
        { studentId: 'b', date: '2026-10-01', status: 'ABSENT' },
        { studentId: 'gone', date: '2026-10-01', status: 'PRESENT' },
      ],
      days,
    );
    expect(rows[0]).toMatchObject({
      statuses: { '2026-10-01': 'PRESENT', '2026-10-02': 'LATE' },
      counts: { PRESENT: 1, LATE: 1, ABSENT: 0, LEAVE: 0 },
      rate: 100,
    });
    expect(rows[1]).toMatchObject({ statuses: { '2026-10-01': 'ABSENT' }, rate: 0 });
    expect(totals.byDate['2026-10-01']).toEqual({ PRESENT: 1, ABSENT: 1, LATE: 0, LEAVE: 0, unmarked: 0 });
    expect(totals.byDate['2026-10-02']).toEqual({ PRESENT: 0, ABSENT: 0, LATE: 1, LEAVE: 0, unmarked: 1 });
    expect(totals).toMatchObject({ students: 2, sessions: 2, PRESENT: 1, LATE: 1, ABSENT: 1, rate: 66.7 });
  });
});
