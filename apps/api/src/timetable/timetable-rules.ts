/**
 * Automatic timetable generation. Pure rules: the controller loads the data
 * and saves the result. It is a rule-based planner, not an AI model, so it
 * works offline and gives the same plan for the same input.
 *
 * shortcut: greedy placement with no backtracking, so a very tight teacher
 * load can leave lessons unplaced (reported, never hidden); upgrade to a
 * constraint solver if schools hit that often.
 */

export interface GenSubject {
  subjectId: string;
  teacherId: string | null;
  /** Lessons per week; omit to share the free periods evenly. */
  perWeek?: number;
}

export interface GenSection {
  id: string;
  subjects: GenSubject[];
}

export interface GenInput {
  /** Weekdays to fill, 1 = Monday. */
  days: number[];
  /** Teaching (non-break) period ids in day order. */
  periodIds: string[];
  sections: GenSection[];
  /** "teacherId|day|periodId" cells already taken by sections that are not being regenerated. */
  busy?: Iterable<string>;
}

export interface GenSlot {
  sectionId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherId: string | null;
}

export interface GenResult {
  slots: GenSlot[];
  /** Lessons that found no free cell for their section and teacher. */
  unplaced: { sectionId: string; subjectId: string; missing: number }[];
}

export const busyKey = (teacherId: string, day: number, periodId: string) => `${teacherId}|${day}|${periodId}`;

/** Lessons per week for each subject: the given counts, else an even share of the cells. */
export function weeklyCounts(subjects: GenSubject[], cells: number): number[] {
  const given = subjects.reduce((a, s) => a + (s.perWeek ?? 0), 0);
  const open = subjects.filter((s) => s.perWeek === undefined);
  const share = open.length ? Math.max(0, cells - given) : 0;
  let extra = open.length ? share % open.length : 0;
  return subjects.map((s) => {
    if (s.perWeek !== undefined) return s.perWeek;
    const n = Math.floor(share / open.length) + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return n;
  });
}

const ATTEMPTS = 12;

/** Tries a few deterministic variations (different starting periods and section order) and keeps the one that places the most. */
export function generateTimetable(input: GenInput): GenResult {
  let best: GenResult | null = null;
  const total = (r: GenResult) => r.unplaced.reduce((a, u) => a + u.missing, 0);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const sections = input.sections.map((_, i) => input.sections[(i + attempt) % input.sections.length]);
    const result = plan({ ...input, sections }, attempt);
    if (!best || total(result) < total(best)) best = result;
    if (!total(best)) break;
  }
  return best ?? { slots: [], unplaced: [] };
}

function plan(input: GenInput, shift: number): GenResult {
  const { days, periodIds } = input;
  const busy = new Set(input.busy ?? []);
  const slots: GenSlot[] = [];
  const unplaced: GenResult['unplaced'] = [];
  const cells = days.length * periodIds.length;

  const tasks = input.sections.flatMap((section) => {
    const counts = weeklyCounts(section.subjects, cells);
    return section.subjects.map((s, i) => ({ section, s, n: counts[i], i })).filter((t) => t.n > 0);
  });
  const teacherLoad = new Map<string, number>();
  for (const t of tasks) if (t.s.teacherId) teacherLoad.set(t.s.teacherId, (teacherLoad.get(t.s.teacherId) ?? 0) + t.n);
  // Hardest first: lessons of the busiest teachers, then the biggest subjects, have the fewest spare cells.
  // Array.sort is stable, so the order the sections arrive in breaks ties.
  tasks.sort((a, b) => (teacherLoad.get(b.s.teacherId ?? '') ?? 0) - (teacherLoad.get(a.s.teacherId ?? '') ?? 0) || b.n - a.n);

  const taken = new Set<string>();
  const perDay = new Map<string, number>();
  for (const { section, s, n, i } of tasks) {
    const cap = Math.ceil(n / days.length);
    let missing = n;
    // First keep the subject spread out; if it cannot all fit that way, allow a second lesson in a day.
    for (const capped of [true, false]) {
      while (missing > 0) {
        let best: { day: number; periodId: string; load: number } | null = null;
        for (const day of days) {
          const dayLoad = perDay.get(`${section.id}|${s.subjectId}|${day}`) ?? 0;
          if (capped && dayLoad >= cap) continue;
          // Rotate the starting period per subject so a day's first period is not always Maths.
          for (let k = 0; k < periodIds.length; k++) {
            const periodId = periodIds[(k + i + shift) % periodIds.length];
            if (taken.has(`${section.id}|${day}|${periodId}`)) continue;
            if (s.teacherId && busy.has(busyKey(s.teacherId, day, periodId))) continue;
            if (!best || dayLoad < best.load) best = { day, periodId, load: dayLoad };
            break;
          }
        }
        if (!best) break;
        taken.add(`${section.id}|${best.day}|${best.periodId}`);
        if (s.teacherId) busy.add(busyKey(s.teacherId, best.day, best.periodId));
        perDay.set(`${section.id}|${s.subjectId}|${best.day}`, best.load + 1);
        slots.push({ sectionId: section.id, dayOfWeek: best.day, periodId: best.periodId, subjectId: s.subjectId, teacherId: s.teacherId });
        missing--;
      }
    }
    if (missing > 0) unplaced.push({ sectionId: section.id, subjectId: s.subjectId, missing });
  }
  return { slots, unplaced };
}
