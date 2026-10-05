import { LessonPlanStatus } from '@prisma/client';
import { z } from 'zod';

export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    {
      message: 'Not a real date',
    },
  );

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullish();

const fields = {
  topic: z.string().trim().min(1, 'Topic is required').max(200),
  objectives: text(4000),
  activities: text(4000),
  resources: text(2000),
  homework: text(2000),
};

export const createLessonPlanSchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  /** Any day of the week; stored as that week's Monday. */
  weekStart: isoDay,
  ...fields,
});
export type CreateLessonPlan = z.infer<typeof createLessonPlanSchema>;

export const updateLessonPlanSchema = z
  .object({ weekStart: isoDay, ...fields })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateLessonPlan = z.infer<typeof updateLessonPlanSchema>;

export const reviewLessonPlanSchema = z
  .object({
    decision: z.enum(['APPROVED', 'NEEDS_CHANGES']),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === 'APPROVED' || (v.note ?? '').length > 0, {
    message: 'Say what needs to change',
    path: ['note'],
  });
export type ReviewLessonPlan = z.infer<typeof reviewLessonPlanSchema>;

export const listLessonPlansSchema = z.object({
  sectionId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  teacherId: z.string().min(1).optional(),
  status: z.enum(LessonPlanStatus).optional(),
  /** A single week (any day in it). */
  week: isoDay.optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  mine: z.enum(['true', 'false']).optional(),
});
export type ListLessonPlans = z.infer<typeof listLessonPlansSchema>;

/** The Monday (YYYY-MM-DD) of the ISO week a day falls in. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** A teacher may edit (and delete) a plan while it is a draft or was sent back. */
export const isEditable = (status: LessonPlanStatus) =>
  status === LessonPlanStatus.DRAFT ||
  status === LessonPlanStatus.NEEDS_CHANGES;

/** Submitting is allowed from the same states as editing. */
export const canSubmit = isEditable;

/** Only submitted plans can be reviewed. */
export const canReview = (status: LessonPlanStatus) =>
  status === LessonPlanStatus.SUBMITTED;
