import { type Band, gradeFor } from '../exams/result-calculator.js';

/**
 * Pure gradebook rules (AcademiaOS module D), unit tested on their own.
 *
 * Cell statuses:
 * - graded: a score exists (exam marks, graded assignment, submitted quiz).
 * - review: a quiz whose best attempt still has short answers to check; the
 *   current score counts as provisional.
 * - absent: marked absent for an exam paper; counts as a score of 0.
 * - submitted: assignment work handed in but not graded yet; excluded.
 * - missing: nothing yet (no marks, no submission, no finished attempt); excluded.
 */
export type CellStatus =
  'graded' | 'review' | 'absent' | 'submitted' | 'missing';

export interface GradeCell {
  score: number | null;
  max: number;
  status: CellStatus;
}

/** Whether a cell counts towards the overall percentage. */
export function counts(cell: GradeCell): boolean {
  if (cell.max <= 0) return false;
  if (cell.status === 'absent') return true;
  return (
    (cell.status === 'graded' || cell.status === 'review') &&
    cell.score !== null
  );
}

/**
 * Overall % = sum(score) / sum(max) over the cells that count (graded, review
 * and absent; absent scores 0). Missing and ungraded work is left out rather
 * than counted as zero. Rounded to one decimal; null when nothing counts yet.
 */
export function overallPercent(cells: GradeCell[]): number | null {
  let got = 0;
  let max = 0;
  for (const c of cells) {
    if (!counts(c)) continue;
    got +=
      c.status === 'absent' ? 0 : Math.min(Math.max(c.score ?? 0, 0), c.max);
    max += c.max;
  }
  if (max === 0) return null;
  return Math.round((got / max) * 1000) / 10;
}

/** The school's letter grade for a percentage (null stays null). */
export function letterGrade(
  percent: number | null,
  bands: Band[],
): string | null {
  return percent === null ? null : gradeFor(percent, bands).grade;
}

/** Mean of the non-null values, one decimal; null when there are none. */
export function average(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return null;
  return (
    Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 10) / 10
  );
}

/** Exam cell from a Mark row (or none). */
export function examCell(
  mark: { marks: number | null; isAbsent: boolean } | undefined,
  max: number,
): GradeCell {
  if (!mark) return { score: null, max, status: 'missing' };
  if (mark.isAbsent) return { score: 0, max, status: 'absent' };
  if (mark.marks === null) return { score: null, max, status: 'missing' };
  return { score: mark.marks, max, status: 'graded' };
}

/** Assignment cell from a Submission row (or none). */
export function assignmentCell(
  submission: { points: number | null } | undefined,
  max: number,
): GradeCell {
  if (!submission) return { score: null, max, status: 'missing' };
  if (submission.points === null)
    return { score: null, max, status: 'submitted' };
  return { score: submission.points, max, status: 'graded' };
}

/** Quiz cell from the best submitted attempt (see quizScores). */
export function quizCell(
  best: { score: number; maxScore: number } | null,
  needsReview: boolean,
  max: number,
): GradeCell {
  if (!best) return { score: null, max, status: 'missing' };
  return {
    score: best.score,
    max: best.maxScore > 0 ? best.maxScore : max,
    status: needsReview ? 'review' : 'graded',
  };
}
