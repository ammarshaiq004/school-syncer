export interface Band {
  grade: string;
  minPercent: number;
  remark?: string | null;
}

/** Used until a school sets its own scale. */
export const DEFAULT_BANDS: Band[] = [
  { grade: 'A+', minPercent: 90, remark: 'Outstanding' },
  { grade: 'A', minPercent: 80, remark: 'Excellent' },
  { grade: 'B', minPercent: 70, remark: 'Very good' },
  { grade: 'C', minPercent: 60, remark: 'Good' },
  { grade: 'D', minPercent: 50, remark: 'Fair' },
  { grade: 'E', minPercent: 40, remark: 'Needs improvement' },
  { grade: 'F', minPercent: 0, remark: 'Fail' },
];

/** The highest band the percentage reaches; the lowest band if it reaches none. */
export function gradeFor(percent: number, bands: Band[]): Band {
  const sorted = [...(bands.length ? bands : DEFAULT_BANDS)].sort(
    (a, b) => b.minPercent - a.minPercent,
  );
  return (
    sorted.find((b) => percent >= b.minPercent) ?? sorted[sorted.length - 1]
  );
}

export interface PaperInput {
  id: string;
  subject: string;
  maxMarks: number;
  passMarks: number;
}

export interface MarkInput {
  paperId: string;
  marks: number | null;
  isAbsent: boolean;
}

export interface SubjectResult {
  subject: string;
  max: number;
  pass: number;
  marks: number | null;
  absent: boolean;
  passed: boolean;
}

export interface StudentResult {
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  passed: boolean;
  subjects: SubjectResult[];
}

/** One student's total, percentage and grade. Absent counts as zero and fails the paper. */
export function studentResult(
  papers: PaperInput[],
  marks: MarkInput[],
  bands: Band[],
): StudentResult {
  const subjects = papers.map((p) => {
    const m = marks.find((x) => x.paperId === p.id);
    const absent = m?.isAbsent ?? false;
    const got = absent ? null : (m?.marks ?? null);
    return {
      subject: p.subject,
      max: p.maxMarks,
      pass: p.passMarks,
      marks: got,
      absent,
      passed: got !== null && got >= p.passMarks,
    };
  });
  const obtained = subjects.reduce((sum, s) => sum + (s.marks ?? 0), 0);
  const maxTotal = papers.reduce((sum, p) => sum + p.maxMarks, 0);
  const percent = maxTotal
    ? Math.round((obtained / maxTotal) * 10000) / 100
    : 0;
  return {
    obtained,
    maxTotal,
    percent,
    grade: gradeFor(percent, bands).grade,
    passed: subjects.length > 0 && subjects.every((s) => s.passed),
    subjects,
  };
}

/** Class positions by percentage; equal scores share a position (1, 2, 2, 4). */
export function positions(
  scores: { id: string; percent: number }[],
): Map<string, number> {
  const sorted = [...scores].sort((a, b) => b.percent - a.percent);
  const result = new Map<string, number>();
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1];
    result.set(
      s.id,
      prev && prev.percent === s.percent ? result.get(prev.id)! : i + 1,
    );
  });
  return result;
}
