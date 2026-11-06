import { dayStart } from '../common/dates.js';

export interface BirthdayInput {
  id: string;
  name: string;
  dateOfBirth: Date;
}

export interface Birthday {
  id: string;
  name: string;
  /** The next birthday (today counts), YYYY-MM-DD. */
  date: string;
  daysAway: number;
  turning: number;
}

const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The day a birthday falls in `year`; 29 February is marked on the 28th in a common year. */
function birthdayIn(year: number, month: number, day: number): string {
  return month === 2 && day === 29 && !isLeap(year) ? iso(year, 2, 28) : iso(year, month, day);
}

/**
 * Birthdays from `today` (YYYY-MM-DD, school-local) up to `days` days ahead,
 * soonest first. Rows born in the future are ignored.
 */
export function upcomingBirthdays(rows: BirthdayInput[], today: string, days: number): Birthday[] {
  const [year] = today.split('-').map(Number);
  const out: Birthday[] = [];
  for (const row of rows) {
    const born = row.dateOfBirth;
    const month = born.getUTCMonth() + 1;
    const day = born.getUTCDate();
    const bornYear = born.getUTCFullYear();
    let date = birthdayIn(year, month, day);
    if (date < today) date = birthdayIn(year + 1, month, day);
    const turning = Number(date.slice(0, 4)) - bornYear;
    const daysAway = Math.round((dayStart(date).getTime() - dayStart(today).getTime()) / 86_400_000);
    if (turning < 0 || daysAway > days) continue;
    out.push({ id: row.id, name: row.name, date, daysAway, turning });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
}

/** Whole minutes between check-in and check-out; null while the visitor is still in. */
export function visitMinutes(checkedInAt: Date, checkedOutAt: Date | null): number | null {
  if (!checkedOutAt) return null;
  return Math.max(0, Math.round((checkedOutAt.getTime() - checkedInAt.getTime()) / 60_000));
}

/** A complaint can only move forward; reopening a resolved one is a new complaint. */
const COMPLAINT_FLOW = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export type ComplaintState = (typeof COMPLAINT_FLOW)[number];

export function canMoveComplaint(from: ComplaintState, to: ComplaintState): boolean {
  return COMPLAINT_FLOW.indexOf(to) > COMPLAINT_FLOW.indexOf(from);
}

export interface SlipStudent {
  admissionNo: string;
  rollNo: number | null;
  name: string;
  gender: string;
  dateOfBirth: Date | null;
  address: string | null;
  locality: string | null;
  guardians: { name: string; relation: string; phone: string; isPrimary: boolean }[];
}

/** One student's printable information slip: the primary guardian first, then the rest. */
export function slipFor(s: SlipStudent) {
  const guardians = [...s.guardians].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return {
    admissionNo: s.admissionNo,
    rollNo: s.rollNo,
    name: s.name,
    gender: s.gender,
    dateOfBirth: s.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    address: [s.address, s.locality].filter(Boolean).join(', ') || null,
    guardians: guardians.map((g) => ({ name: g.name, relation: g.relation, phone: g.phone })),
  };
}
