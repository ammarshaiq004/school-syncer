import { randomInt } from 'node:crypto';
import type { LiveStatus } from '@prisma/client';
import { dayStart, startOfLocalDay } from '../../common/dates.js';

const ROOM_ALPHABET =
  'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Minutes before the start time that students may join. */
export const JOIN_EARLY_MIN = 15;

/** A random room code; unambiguous letters and digits only. */
export function roomCode(
  length = 10,
  pick: (n: number) => number = randomInt,
): string {
  return Array.from(
    { length },
    () => ROOM_ALPHABET[pick(ROOM_ALPHABET.length)],
  ).join('');
}

/**
 * A Jitsi Meet room for a class: `https://meet.jit.si/SchoolSyncer-<slug>-<code>`.
 * The slug is reduced to URL-safe characters so the room name never breaks.
 */
export function jitsiUrl(
  schoolSlug: string,
  code: string = roomCode(),
): string {
  const slug =
    schoolSlug
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'school';
  return `https://meet.jit.si/SchoolSyncer-${slug}-${code}`;
}

/** The instant a class is due to finish. */
export function liveEndsAt(startsAt: Date, durationMin: number): Date {
  return new Date(startsAt.getTime() + durationMin * 60_000);
}

export type JoinWindow = 'early' | 'open' | 'closed';

/**
 * Whether a student may join now. A class the teacher has started is open;
 * an ended or cancelled one is closed; a scheduled one is open from 15
 * minutes before its start until its planned end.
 */
export function joinWindow(
  cls: { status: LiveStatus; startsAt: Date; durationMin: number },
  now: Date = new Date(),
): JoinWindow {
  if (cls.status === 'LIVE') return 'open';
  if (cls.status === 'ENDED' || cls.status === 'CANCELLED') return 'closed';
  const opens = cls.startsAt.getTime() - JOIN_EARLY_MIN * 60_000;
  if (now.getTime() < opens) return 'early';
  if (now.getTime() >= liveEndsAt(cls.startsAt, cls.durationMin).getTime())
    return 'closed';
  return 'open';
}

/** Minutes from midnight for an "HH:MM" time. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** The Monday (YYYY-MM-DD) of the week a day falls in. */
export function mondayOf(iso: string): string {
  const d = dayStart(iso);
  const back = (d.getUTCDay() + 6) % 7; // Sunday -> 6, Monday -> 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The YYYY-MM-DD day of a weekday (1 = Monday ... 7 = Sunday) in the week starting on `monday`. */
export function weekdayDate(monday: string, dayOfWeek: number): string {
  const d = dayStart(monday);
  d.setUTCDate(d.getUTCDate() + dayOfWeek - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * When a timetable slot happens in a given week: its local day and the
 * period's local start time as an instant, plus its length in minutes.
 */
export function slotOccurrence(
  monday: string,
  slot: { dayOfWeek: number; startTime: string; endTime: string },
  timeZone?: string,
): { date: string; startsAt: Date; durationMin: number } {
  const date = weekdayDate(monday, slot.dayOfWeek);
  const midnight = startOfLocalDay(date, timeZone);
  const startsAt = new Date(
    midnight.getTime() + minutesOf(slot.startTime) * 60_000,
  );
  const durationMin = Math.max(
    1,
    minutesOf(slot.endTime) - minutesOf(slot.startTime),
  );
  return { date, startsAt, durationMin };
}

/** Daily register rows for a section from who joined a live class: present if joined, else absent. */
export function attendanceFromJoins(studentIds: string[], joined: Set<string>) {
  return studentIds.map((studentId) => ({
    studentId,
    status: joined.has(studentId) ? ('PRESENT' as const) : ('ABSENT' as const),
  }));
}
