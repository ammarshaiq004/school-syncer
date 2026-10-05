import { SCHOOL_TZ } from "@/components/elearning/live-types";
import type { AssignmentState, Notice } from "./types";

/** "2026-10-05" for a moment, in school time. */
export const schoolDayKey = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ });
const dayKey = schoolDayKey;

/** Minutes since midnight in school time (for matching timetable periods). */
export function schoolMinutes(date: Date | number = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: SCHOOL_TZ }).formatToParts(new Date(date));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** "Due today, 5:00 pm", "Due tomorrow, 9:00 am", "Due Mon 12 Oct". */
export function dueText(dueAt: string, now = new Date()) {
  const due = new Date(dueAt);
  const time = due.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SCHOOL_TZ }).toLowerCase();
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  if (dayKey(due) === dayKey(now)) return `Due today, ${time}`;
  if (dayKey(due) === dayKey(tomorrow)) return `Due tomorrow, ${time}`;
  return `Due ${due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SCHOOL_TZ })}`;
}

/** "Good morning" / "Good afternoon" / "Good evening" for the hour. */
export function greeting(date = new Date()) {
  const h = Math.floor(schoolMinutes(date) / 60);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Label and pill tone for an assignment's standing. */
export const ASSIGNMENT_STATE: Record<AssignmentState, { label: string; tone: "warning" | "danger" | "success" | "info" | "neutral" }> = {
  pending: { label: "To do", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
  missing: { label: "Missing", tone: "danger" },
  submitted: { label: "Handed in", tone: "info" },
  graded: { label: "Graded", tone: "success" },
  returned: { label: "Returned to redo", tone: "warning" },
};

export const AUDIENCE_LABEL: Record<Notice["audience"], string> = {
  SCHOOL: "Whole school",
  CAMPUS: "Campus",
  CLASS: "My class",
  SECTION: "My section",
};

/** "5 Oct, 10:30 am" for a notice timestamp. */
export const postedAt = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: SCHOOL_TZ })}, ${new Date(iso)
    .toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SCHOOL_TZ })
    .toLowerCase()}`;
