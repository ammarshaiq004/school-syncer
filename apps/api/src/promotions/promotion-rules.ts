import { PromotionDecision } from '@prisma/client';

/** "2026-27" → "2027-28"; "2026" → "2027". Anything else gets "(next)". */
export function nextYearName(name: string): string {
  const m = /^(\d{4})([-/])(\d{2}|\d{4})$/.exec(name.trim());
  if (m) {
    const end = Number(m[3]) + 1;
    return `${Number(m[1]) + 1}${m[2]}${String(end % (m[3].length === 2 ? 100 : 10_000)).padStart(m[3].length, '0')}`;
  }
  if (/^\d{4}$/.test(name.trim())) return String(Number(name) + 1);
  return `${name} (next)`;
}

/** The same day a year later, as stored for @db.Date columns. */
export function aYearLater(d: Date): Date {
  const next = new Date(d);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export interface ClassInfo {
  id: string;
  campusId: string;
  sortOrder: number;
  name: string;
}
export interface SectionInfo {
  id: string;
  classId: string;
  name: string;
}

const after = (from: ClassInfo, classes: ClassInfo[]) =>
  classes
    .filter((c) => c.campusId === from.campusId && c.sortOrder > from.sortOrder)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

/**
 * The class a student moves up to: the next one at their campus or, from the
 * top class of a junior campus, the next one at a campus that teaches the same
 * class further up ("Grade 5" at Johar Town goes on to "Grade 6" at Model
 * Town). None from the school's last class.
 */
export function nextClass(
  from: ClassInfo,
  classes: ClassInfo[],
): ClassInfo | null {
  const here = after(from, classes);
  if (here) return here;
  for (const twin of classes.filter(
    (c) => c.campusId !== from.campusId && c.name === from.name,
  )) {
    const there = after(twin, classes);
    if (there) return there;
  }
  return null;
}

/** Next year's section of a class, matching the section name ("A" stays "A") where it can. */
export function matchingSection(
  classId: string,
  sectionName: string,
  nextYearSections: SectionInfo[],
): SectionInfo | null {
  const own = nextYearSections
    .filter((s) => s.classId === classId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return own.find((s) => s.name === sectionName) ?? own[0] ?? null;
}

/** What happens to a student unless the school decides otherwise. */
export function defaultPlan(
  fromClass: ClassInfo,
  sectionName: string,
  classes: ClassInfo[],
  nextYearSections: SectionInfo[],
): { decision: PromotionDecision; toSectionId: string | null } {
  const up = nextClass(fromClass, classes);
  if (!up) return { decision: PromotionDecision.GRADUATE, toSectionId: null };
  return {
    decision: PromotionDecision.PROMOTE,
    toSectionId:
      matchingSection(up.id, sectionName, nextYearSections)?.id ?? null,
  };
}
