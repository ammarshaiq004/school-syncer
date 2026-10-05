import {
  canReview,
  canSubmit,
  createLessonPlanSchema,
  isEditable,
  mondayOf,
  reviewLessonPlanSchema,
  updateLessonPlanSchema,
} from './lesson-plan-rules.js';

describe('mondayOf', () => {
  it('maps every day of a week to its Monday', () => {
    // 2026-10-05 is a Monday.
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-10', '2026-10-11']) {
      expect(mondayOf(d)).toBe('2026-10-05');
    }
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
  });

  it('crosses month and year boundaries', () => {
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2027-01-02')).toBe('2026-12-28');
  });
});

describe('lesson plan status rules', () => {
  it('allows editing and submitting only drafts and plans sent back', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('NEEDS_CHANGES')).toBe(true);
    expect(isEditable('SUBMITTED')).toBe(false);
    expect(isEditable('APPROVED')).toBe(false);
    expect(canSubmit('NEEDS_CHANGES')).toBe(true);
    expect(canSubmit('APPROVED')).toBe(false);
  });

  it('reviews only submitted plans', () => {
    expect(canReview('SUBMITTED')).toBe(true);
    expect(canReview('DRAFT')).toBe(false);
    expect(canReview('APPROVED')).toBe(false);
  });
});

describe('lesson plan schemas', () => {
  const base = {
    sectionId: 's',
    subjectId: 'm',
    weekStart: '2026-10-07',
    topic: '  Fractions  ',
  };

  it('trims the topic and turns blank optional text into null', () => {
    const v = createLessonPlanSchema.parse({
      ...base,
      objectives: '   ',
      homework: 'Exercise 3.1',
    });
    expect(v.topic).toBe('Fractions');
    expect(v.objectives).toBeNull();
    expect(v.homework).toBe('Exercise 3.1');
  });

  it('rejects a missing topic and impossible dates', () => {
    expect(
      createLessonPlanSchema.safeParse({ ...base, topic: ' ' }).success,
    ).toBe(false);
    expect(
      createLessonPlanSchema.safeParse({ ...base, weekStart: '2026-02-30' })
        .success,
    ).toBe(false);
    expect(
      createLessonPlanSchema.safeParse({ ...base, weekStart: '07/10/2026' })
        .success,
    ).toBe(false);
  });

  it('needs at least one field on update', () => {
    expect(updateLessonPlanSchema.safeParse({}).success).toBe(false);
    expect(
      updateLessonPlanSchema.safeParse({ activities: 'Group work' }).success,
    ).toBe(true);
  });

  it('requires a note when sending a plan back', () => {
    expect(
      reviewLessonPlanSchema.safeParse({ decision: 'APPROVED' }).success,
    ).toBe(true);
    expect(
      reviewLessonPlanSchema.safeParse({ decision: 'NEEDS_CHANGES' }).success,
    ).toBe(false);
    expect(
      reviewLessonPlanSchema.safeParse({
        decision: 'NEEDS_CHANGES',
        note: '  ',
      }).success,
    ).toBe(false);
    expect(
      reviewLessonPlanSchema.safeParse({
        decision: 'NEEDS_CHANGES',
        note: 'Add an assessment',
      }).success,
    ).toBe(true);
    expect(
      reviewLessonPlanSchema.safeParse({ decision: 'SUBMITTED' }).success,
    ).toBe(false);
  });
});
