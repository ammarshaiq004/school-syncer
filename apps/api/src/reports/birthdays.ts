import { ageOn } from '../dashboard/dashboard-rules.js';

export interface BirthdayPerson {
  kind: 'student' | 'staff';
  name: string;
  /** Admission number or employee number. */
  ref: string;
  /** Class and section, or designation. */
  detail: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
}

/** Who has a birthday in `month` (1-12), by day of the month, with the age they turn in `year`. */
export function birthdaysInMonth(people: BirthdayPerson[], month: number, year: number) {
  const mm = String(month).padStart(2, '0');
  return people
    .filter((p) => p.dateOfBirth.slice(5, 7) === mm)
    .map((p) => ({ ...p, day: Number(p.dateOfBirth.slice(8, 10)), turns: ageOn(p.dateOfBirth, `${year}-12-31`) }))
    .filter((p) => p.turns >= 0)
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}
