import { pct } from './fee-analysis.js';

/** Gender of the active students, overall and class by class (classes in the order given). */
export function genderSplit(students: { gender: string; className: string }[]) {
  const classes = new Map<string, Record<string, number>>();
  const overall: Record<string, number> = { MALE: 0, FEMALE: 0, OTHER: 0 };
  for (const s of students) {
    overall[s.gender] = (overall[s.gender] ?? 0) + 1;
    const row = classes.get(s.className) ?? { MALE: 0, FEMALE: 0, OTHER: 0 };
    row[s.gender] = (row[s.gender] ?? 0) + 1;
    classes.set(s.className, row);
  }
  return {
    overall,
    byClass: [...classes.entries()]
      .map(([name, g]) => ({ name, male: g.MALE, female: g.FEMALE, other: g.OTHER }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
  };
}

/** Enrollment outcomes of one academic year: who left or moved to another school, as a share of those enrolled. */
export function dropoutRow(year: string, counts: Record<string, number>) {
  const enrolled = Object.values(counts).reduce((s, n) => s + n, 0);
  const left = counts.LEFT ?? 0;
  const transferred = counts.TRANSFERRED ?? 0;
  return { year, enrolled, left, transferred, dropoutPct: pct(left + transferred, enrolled) };
}

/** Pass and fail counts per label, with the pass rate. */
export function passFail(results: { label: string; passed: boolean }[]) {
  const by = new Map<string, { passed: number; failed: number }>();
  for (const r of results) {
    const row = by.get(r.label) ?? { passed: 0, failed: 0 };
    if (r.passed) row.passed += 1;
    else row.failed += 1;
    by.set(r.label, row);
  }
  return [...by.entries()].map(([name, c]) => ({ name, ...c, passPct: pct(c.passed, c.passed + c.failed) }));
}
