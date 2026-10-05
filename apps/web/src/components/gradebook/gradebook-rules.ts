/**
 * Gradebook types (GET /gradebook) and the same rules the API uses, so the grid can
 * recalculate Overall %, letter grades and class averages the moment a teacher types a mark.
 * Mirrors apps/api/src/gradebook/gradebook-rules.ts.
 */

export type AssessmentKind = "EXAM" | "ASSIGNMENT" | "QUIZ";
export type CellStatus = "graded" | "review" | "absent" | "submitted" | "missing";

export interface GradebookSection {
  id: string;
  name: string;
  className: string;
  sectionName: string;
  academicYearId: string;
  isClassTeacher: boolean;
  subjects: { id: string; name: string; teachesIt: boolean }[];
}

export interface GradebookColumn {
  key: string;
  kind: AssessmentKind;
  refId: string;
  title: string;
  maxPoints: number;
  date: string | null;
  editable: boolean;
  paperId?: string;
  examStatus?: "DRAFT" | "PUBLISHED";
  passMarks?: number;
}

export interface GradebookCell {
  score: number | null;
  max: number;
  status: CellStatus;
  editable: boolean;
}

export interface GradebookRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  photoUrl: string | null;
  cells: Record<string, GradebookCell>;
  overallPercent: number | null;
  letterGrade: string | null;
}

export interface GradeBand {
  grade: string;
  minPercent: number;
  remark?: string | null;
}

export interface Gradebook {
  section: { id: string; name: string; academicYearId: string };
  subject: { id: string; name: string };
  academicYearId: string;
  columns: GradebookColumn[];
  rows: GradebookRow[];
  classAverage: { overallPercent: number | null; byColumn: Record<string, number | null> };
  gradeBands: GradeBand[];
}

/** Whether a cell counts towards the overall percentage (graded, review, absent). */
export function counts(cell: Pick<GradebookCell, "score" | "max" | "status">): boolean {
  if (cell.max <= 0) return false;
  if (cell.status === "absent") return true;
  return (cell.status === "graded" || cell.status === "review") && cell.score !== null;
}

/** sum(score) / sum(max) over the cells that count, one decimal; null when nothing counts. */
export function overallPercent(cells: Pick<GradebookCell, "score" | "max" | "status">[]): number | null {
  let got = 0;
  let max = 0;
  for (const c of cells) {
    if (!counts(c)) continue;
    got += c.status === "absent" ? 0 : Math.min(Math.max(c.score ?? 0, 0), c.max);
    max += c.max;
  }
  if (max === 0) return null;
  return Math.round((got / max) * 1000) / 10;
}

/** Highest band reached (the lowest band when below all of them). */
export function letterGrade(percent: number | null, bands: GradeBand[]): string | null {
  if (percent === null || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return (sorted.find((b) => percent >= b.minPercent) ?? sorted[sorted.length - 1]).grade;
}

/** Mean of the non-null values, one decimal; null when there are none. */
export function average(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return null;
  return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 10) / 10;
}

/** Recalculates a row's Overall % and letter grade after its cells changed. */
export function rescoreRow(row: GradebookRow, bands: GradeBand[]): GradebookRow {
  const percent = overallPercent(Object.values(row.cells));
  return { ...row, overallPercent: percent, letterGrade: letterGrade(percent, bands) };
}

/** Class average row: overall and per column (each cell as a percentage of its max). */
export function classAverage(rows: GradebookRow[], columns: GradebookColumn[]): Gradebook["classAverage"] {
  return {
    overallPercent: average(rows.map((r) => r.overallPercent)),
    byColumn: Object.fromEntries(columns.map((c) => [c.key, average(rows.map((r) => (r.cells[c.key] ? overallPercent([r.cells[c.key]]) : null)))])),
  };
}

export type ParsedEntry =
  | { kind: "empty" }
  | { kind: "absent" }
  | { kind: "score"; value: number }
  | { kind: "invalid"; reason: string };

/**
 * Reads what was typed into a cell. Exams accept decimals and "A"/"Abs" for absent;
 * assignments take whole points only (the grade endpoint requires an integer).
 */
export function parseEntry(text: string, column: Pick<GradebookColumn, "kind" | "maxPoints">): ParsedEntry {
  const t = text.trim();
  if (!t) return { kind: "empty" };
  if (column.kind === "EXAM" && /^(a|ab|abs|absent)$/i.test(t)) return { kind: "absent" };
  if (!/^\d+(\.\d+)?$/.test(t)) return { kind: "invalid", reason: column.kind === "EXAM" ? "Enter a number, or A for absent" : "Enter a number" };
  const value = Number(t);
  if (value > column.maxPoints) return { kind: "invalid", reason: `More than the maximum of ${column.maxPoints}` };
  if (column.kind === "ASSIGNMENT" && !Number.isInteger(value)) return { kind: "invalid", reason: "Use whole points" };
  return { kind: "score", value };
}

/** The text shown in an input for a stored cell. */
export function cellText(cell: GradebookCell | undefined): string {
  if (!cell) return "";
  if (cell.status === "absent") return "A";
  return cell.score == null ? "" : String(cell.score);
}

export const KIND_META: Record<AssessmentKind, { label: string; tone: "primary" | "info" | "warning" }> = {
  EXAM: { label: "Exam", tone: "primary" },
  ASSIGNMENT: { label: "Assignment", tone: "info" },
  QUIZ: { label: "Quiz", tone: "warning" },
};

/** "6 Oct" from YYYY-MM-DD. */
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
