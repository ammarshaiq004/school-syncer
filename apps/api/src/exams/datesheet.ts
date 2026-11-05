export interface SheetPaper {
  id: string;
  classId: string;
  className: string;
  subject: string;
  /** YYYY-MM-DD */
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  syllabus: string | null;
}

/** Datesheet order: by date (undated last), then start time, then subject. */
export function sortPapers<
  T extends Pick<SheetPaper, 'date' | 'startTime' | 'subject'>,
>(papers: T[]): T[] {
  return [...papers].sort(
    (a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
      (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
      a.subject.localeCompare(b.subject),
  );
}

const overlaps = (a: SheetPaper, b: SheetPaper) =>
  (a.startTime ?? '00:00') < (b.endTime ?? '24:00') &&
  (b.startTime ?? '00:00') < (a.endTime ?? '24:00');

/**
 * Problems a datesheet should not be published with: a class sitting two
 * papers at once, or two papers in one room at once. A paper with no times is
 * treated as taking the whole day.
 */
export function findClashes(papers: SheetPaper[]): string[] {
  const dated = papers.filter((p) => p.date);
  const out: string[] = [];
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      if (a.date !== b.date || !overlaps(a, b)) continue;
      if (a.classId === b.classId) {
        out.push(
          `${a.className} has ${a.subject} and ${b.subject} at the same time on ${a.date}`,
        );
      } else if (a.room && a.room === b.room) {
        out.push(
          `Room ${a.room} is used by ${a.className} ${a.subject} and ${b.className} ${b.subject} at the same time on ${a.date}`,
        );
      }
    }
  }
  return out;
}
