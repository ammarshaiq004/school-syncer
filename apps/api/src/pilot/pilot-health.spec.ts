import { attendanceCoverage, dailyActive, eachDay, latest } from './pilot-health.js';

describe('eachDay', () => {
  it('lists every day, across a month end', () => {
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(eachDay('2026-10-02', '2026-10-01')).toEqual([]);
  });
});

describe('dailyActive', () => {
  it('counts people per day and per role, with empty days kept', () => {
    const r = dailyActive(
      [
        { date: '2026-10-01', roles: ['OWNER'] },
        { date: '2026-10-01', roles: ['TEACHER', 'ACCOUNTANT'] },
        { date: '2026-10-03', roles: ['TEACHER'] },
        { date: '2026-09-30', roles: ['PARENT'] }, // outside the range
      ],
      eachDay('2026-10-01', '2026-10-03'),
    );
    expect(r.roles).toEqual(['ACCOUNTANT', 'OWNER', 'TEACHER']);
    expect(r.days).toEqual([
      { date: '2026-10-01', total: 2, byRole: { OWNER: 1, TEACHER: 1, ACCOUNTANT: 1 } },
      { date: '2026-10-02', total: 0, byRole: {} },
      { date: '2026-10-03', total: 1, byRole: { TEACHER: 1 } },
    ]);
    expect(r.averagePerActiveDay).toBe(1.5);
  });

  it('is zero with no activity', () => {
    expect(dailyActive([], ['2026-10-01']).averagePerActiveDay).toBe(0);
  });
});

describe('attendanceCoverage', () => {
  it('counts marked and missed school days per section', () => {
    const r = attendanceCoverage(
      [
        { id: 'b', name: 'Grade 10 A', sort: 10 },
        { id: 'a', name: 'Grade 1 A', sort: 1 },
        { id: 'c', name: 'Grade 2 A', sort: 2 },
      ],
      [
        { sectionId: 'a', date: '2026-10-01' },
        { sectionId: 'a', date: '2026-10-02' },
        { sectionId: 'b', date: '2026-10-02' },
        { sectionId: 'a', date: '2026-10-02' },
      ],
    );
    expect(r.schoolDays).toBe(2);
    expect(r.sections).toEqual([
      { sectionId: 'a', name: 'Grade 1 A', days: 2, missed: 0, lastMarked: '2026-10-02' },
      { sectionId: 'c', name: 'Grade 2 A', days: 0, missed: 2, lastMarked: null },
      { sectionId: 'b', name: 'Grade 10 A', days: 1, missed: 1, lastMarked: '2026-10-02' },
    ]);
  });
});

describe('latest', () => {
  it('picks the newest date and skips missing ones', () => {
    const a = new Date('2026-10-01T10:00:00Z');
    const b = new Date('2026-10-02T09:00:00Z');
    expect(latest(a, null, b, undefined)).toBe(b);
    expect(latest(null, undefined)).toBeNull();
  });
});
