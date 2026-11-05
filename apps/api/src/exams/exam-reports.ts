import type { SubjectResult } from './result-calculator.js';

/** One published ExamResult, with the student and section names the reports show. */
export interface ReportRow {
  studentId: string;
  name: string;
  admissionNo: string;
  sectionId: string;
  section: string;
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  position: number;
  passed: boolean;
  subjects: SubjectResult[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) =>
  whole ? round1((part / whole) * 100) : 0;
/** A missed or absent paper counts as zero, like the result itself. */
const subjectPercent = (s: SubjectResult) =>
  s.absent || s.marks === null || !s.max ? 0 : (s.marks / s.max) * 100;

function bySection(rows: ReportRow[]) {
  const map = new Map<string, ReportRow[]>();
  for (const r of rows)
    map.set(r.sectionId, [...(map.get(r.sectionId) ?? []), r]);
  return [...map.values()].sort((a, b) =>
    a[0].section.localeCompare(b[0].section),
  );
}

/** The top `limit` positions of each section; students tied on a position all appear. */
export function toppers(rows: ReportRow[], limit: number) {
  return bySection(rows).map((group) => ({
    sectionId: group[0].sectionId,
    section: group[0].section,
    students: group
      .filter((r) => r.position <= limit)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
  }));
}

/** Students who did not pass, with the papers they failed, and pass rates per section. */
export function failures(rows: ReportRow[]) {
  const failed = rows
    .filter((r) => !r.passed)
    .map((r) => ({
      ...r,
      failedSubjects: r.subjects.filter((s) => !s.passed).map((s) => s.subject),
    }))
    .sort(
      (a, b) => a.section.localeCompare(b.section) || a.percent - b.percent,
    );
  return {
    students: rows.length,
    failed: failed.length,
    passRate: pct(rows.length - failed.length, rows.length),
    sections: bySection(rows).map((g) => ({
      sectionId: g[0].sectionId,
      section: g[0].section,
      students: g.length,
      failed: g.filter((r) => !r.passed).length,
      passRate: pct(g.filter((r) => r.passed).length, g.length),
    })),
    list: failed,
  };
}

export interface SubjectStat {
  sectionId: string;
  section: string;
  subject: string;
  students: number;
  average: number;
  passRate: number;
  highest: number;
  lowest: number;
  absent: number;
}

/** Average, pass rate and spread of every subject in every section. */
export function subjectStats(rows: ReportRow[]): SubjectStat[] {
  const out: SubjectStat[] = [];
  for (const group of bySection(rows)) {
    const bySubject = new Map<string, SubjectResult[]>();
    for (const r of group) {
      for (const s of r.subjects)
        bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s]);
    }
    for (const [subject, list] of [...bySubject].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const sat = list
        .filter((s) => !s.absent && s.marks !== null)
        .map(subjectPercent);
      out.push({
        sectionId: group[0].sectionId,
        section: group[0].section,
        subject,
        students: list.length,
        average: round1(
          list.reduce((sum, s) => sum + subjectPercent(s), 0) / list.length,
        ),
        passRate: pct(list.filter((s) => s.passed).length, list.length),
        highest: sat.length ? round1(Math.max(...sat)) : 0,
        lowest: sat.length ? round1(Math.min(...sat)) : 0,
        absent: list.filter((s) => s.absent).length,
      });
    }
  }
  return out;
}

export interface TeacherStat {
  teacherId: string;
  teacher: string;
  /** Section-and-subject pairs taught. */
  classes: number;
  students: number;
  average: number;
  passRate: number;
  subjects: SubjectStat[];
}

/**
 * Results grouped by the teacher of each section's subject, best average
 * first. `teachers` maps "sectionId|subject" to the assigned teacher; subjects
 * with no teacher assigned are left out.
 */
export function teacherStats(
  stats: SubjectStat[],
  teachers: Map<string, { id: string; name: string }>,
): TeacherStat[] {
  const byTeacher = new Map<string, { name: string; stats: SubjectStat[] }>();
  for (const s of stats) {
    const t = teachers.get(`${s.sectionId}|${s.subject}`);
    if (!t) continue;
    const entry = byTeacher.get(t.id) ?? { name: t.name, stats: [] };
    entry.stats.push(s);
    byTeacher.set(t.id, entry);
  }
  return [...byTeacher]
    .map(([teacherId, { name, stats: list }]) => {
      const students = list.reduce((n, s) => n + s.students, 0);
      return {
        teacherId,
        teacher: name,
        classes: list.length,
        students,
        // Weighted by students, so a big section counts more than a small one.
        average: round1(
          list.reduce((n, s) => n + s.average * s.students, 0) / students,
        ),
        passRate: round1(
          list.reduce((n, s) => n + s.passRate * s.students, 0) / students,
        ),
        subjects: list,
      };
    })
    .sort(
      (a, b) => b.average - a.average || a.teacher.localeCompare(b.teacher),
    );
}

export interface MultiExamRow {
  studentId: string;
  name: string;
  admissionNo: string;
  /** Percent in each exam, in the order asked; null where the student has no result. */
  percents: (number | null)[];
  obtained: number;
  maxTotal: number;
  average: number;
  /** Last minus first percent among the exams the student sat; 0 with fewer than two. */
  change: number;
  position: number;
}

/** One section's students across several exams, ranked by combined marks. */
export function multiExam(perExam: ReportRow[][]): MultiExamRow[] {
  const students = new Map<string, MultiExamRow>();
  perExam.forEach((rows, i) => {
    for (const r of rows) {
      const row = students.get(r.studentId) ?? {
        studentId: r.studentId,
        name: r.name,
        admissionNo: r.admissionNo,
        percents: perExam.map(() => null),
        obtained: 0,
        maxTotal: 0,
        average: 0,
        change: 0,
        position: 0,
      };
      row.percents[i] = r.percent;
      row.obtained += r.obtained;
      row.maxTotal += r.maxTotal;
      students.set(r.studentId, row);
    }
  });
  const list = [...students.values()];
  for (const r of list) {
    r.average = pct(r.obtained, r.maxTotal);
    const sat = r.percents.filter((p): p is number => p !== null);
    r.change = sat.length > 1 ? round1(sat[sat.length - 1] - sat[0]) : 0;
  }
  list.sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  list.forEach((r, i) => {
    r.position =
      i > 0 && list[i - 1].average === r.average ? list[i - 1].position : i + 1;
  });
  return list;
}
