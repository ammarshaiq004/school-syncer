import { busyKey, generateTimetable, weeklyCounts, type GenSection } from './timetable-rules.js';

const days = [1, 2, 3, 4, 5];
const periodIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const section = (id: string, subjects: GenSection['subjects']): GenSection => ({ id, subjects });

describe('weeklyCounts', () => {
  it('shares cells evenly and gives the remainder to the first subjects', () => {
    expect(weeklyCounts([{ subjectId: 'a', teacherId: null }, { subjectId: 'b', teacherId: null }, { subjectId: 'c', teacherId: null }], 10)).toEqual([4, 3, 3]);
  });

  it('keeps given counts and shares what is left', () => {
    expect(weeklyCounts([{ subjectId: 'a', teacherId: null, perWeek: 6 }, { subjectId: 'b', teacherId: null }], 10)).toEqual([6, 4]);
  });
});

describe('generateTimetable', () => {
  it('fills a section without double-booking a cell', () => {
    const subjects = ['m', 'e', 'u', 's', 'i'].map((subjectId) => ({ subjectId, teacherId: `t-${subjectId}`, perWeek: 6 }));
    const { slots, unplaced } = generateTimetable({ days, periodIds, sections: [section('s1', subjects)] });
    expect(unplaced).toEqual([]);
    expect(slots).toHaveLength(30);
    expect(new Set(slots.map((s) => `${s.dayOfWeek}|${s.periodId}`)).size).toBe(30);
  });

  it('spreads a subject across the week', () => {
    const { slots } = generateTimetable({ days, periodIds, sections: [section('s1', [{ subjectId: 'm', teacherId: null, perWeek: 5 }])] });
    expect(new Set(slots.map((s) => s.dayOfWeek)).size).toBe(5);
  });

  it('never puts one teacher in two sections at the same time', () => {
    const shared = (id: string) => section(id, [{ subjectId: 'm', teacherId: 't1', perWeek: 10 }, { subjectId: 'e', teacherId: null, perWeek: 20 }]);
    const { slots } = generateTimetable({ days, periodIds, sections: [shared('a'), shared('b'), shared('c')] });
    const cells = slots.filter((s) => s.teacherId === 't1').map((s) => `${s.dayOfWeek}|${s.periodId}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('respects cells taken by sections that are not being regenerated', () => {
    const busy = days.flatMap((d) => periodIds.slice(0, 5).map((p) => busyKey('t1', d, p)));
    const { slots, unplaced } = generateTimetable({
      days,
      periodIds,
      busy,
      sections: [section('a', [{ subjectId: 'm', teacherId: 't1', perWeek: 5 }])],
    });
    expect(slots.every((s) => s.periodId === 'p6')).toBe(true);
    expect(unplaced).toEqual([]);
  });

  it('reports lessons it cannot place instead of dropping them silently', () => {
    const { slots, unplaced } = generateTimetable({
      days: [1],
      periodIds: ['p1', 'p2'],
      sections: [section('a', [{ subjectId: 'm', teacherId: null, perWeek: 3 }])],
    });
    expect(slots).toHaveLength(2);
    expect(unplaced).toEqual([{ sectionId: 'a', subjectId: 'm', missing: 1 }]);
  });

  it('is deterministic', () => {
    const input = { days, periodIds, sections: [section('a', [{ subjectId: 'm', teacherId: 't1' }, { subjectId: 'e', teacherId: 't2' }])] };
    expect(generateTimetable(input)).toEqual(generateTimetable(input));
  });
});
