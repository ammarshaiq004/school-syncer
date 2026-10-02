import { PromotionDecision } from '@prisma/client';
import {
  aYearLater,
  defaultPlan,
  matchingSection,
  nextYearName,
} from './promotion-rules.js';

describe('nextYearName', () => {
  it('moves session names on a year', () => {
    expect(nextYearName('2026-27')).toBe('2027-28');
    expect(nextYearName('2099-00')).toBe('2100-01');
    expect(nextYearName('2026-2027')).toBe('2027-2028');
    expect(nextYearName('2026')).toBe('2027');
    expect(nextYearName('This year')).toBe('This year (next)');
  });

  it('keeps the dates, a year on', () => {
    expect(aYearLater(new Date('2026-04-01T00:00:00Z')).toISOString()).toBe(
      '2027-04-01T00:00:00.000Z',
    );
  });
});

describe('defaultPlan', () => {
  const classes = [
    { id: 'g4', campusId: 'mt', sortOrder: 4, name: 'Grade 4' },
    { id: 'g5', campusId: 'mt', sortOrder: 5, name: 'Grade 5' },
    { id: 'g5j', campusId: 'jt', sortOrder: 5, name: 'Grade 5' },
  ];
  const next = [
    { id: 'g5-A', classId: 'g5', name: 'A' },
    { id: 'g5-B', classId: 'g5', name: 'B' },
  ];

  it('promotes to the next class, same section name where there is one', () => {
    expect(defaultPlan(classes[0], 'B', classes, next)).toEqual({
      decision: PromotionDecision.PROMOTE,
      toSectionId: 'g5-B',
    });
    expect(matchingSection('g5', 'C', next)?.id).toBe('g5-A');
  });

  it('graduates the school’s last class', () => {
    expect(defaultPlan(classes[1], 'A', classes, next)).toEqual({
      decision: PromotionDecision.GRADUATE,
      toSectionId: null,
    });
  });

  it('moves a junior campus’s top class on to the senior campus', () => {
    // Johar Town's Grade 4 is its last class; Model Town teaches Grade 5.
    const juniorTop = [
      classes[0],
      classes[1],
      { id: 'g4j', campusId: 'jt', sortOrder: 3, name: 'Grade 4' },
    ];
    expect(defaultPlan(juniorTop[2], 'B', juniorTop, next)).toEqual({
      decision: PromotionDecision.PROMOTE,
      toSectionId: 'g5-B',
    });
  });
});
