import type { Tone } from "@/components/ui";

export type LessonPlanStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "NEEDS_CHANGES";

/** GET /lesson-plans item. */
export interface LessonPlan {
  id: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  teacher: { id: string; name: string } | null;
  weekStart: string;
  topic: string;
  objectives: string | null;
  activities: string | null;
  resources: string | null;
  homework: string | null;
  status: LessonPlanStatus;
  submittedAt: string | null;
  reviewerNote: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  editable: boolean;
}

/** GET /lesson-plans/sections item. */
export interface PlanSection {
  id: string;
  name: string;
  isClassTeacher: boolean;
  subjects: { id: string; name: string; teachesIt: boolean }[];
}

export interface ReviewQueue {
  items: LessonPlan[];
  counts: Record<LessonPlanStatus, number>;
}

export const STATUS_META: Record<LessonPlanStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Awaiting review", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  NEEDS_CHANGES: { label: "Needs changes", tone: "warning" },
};

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Monday (YYYY-MM-DD) of the week a day falls in. */
export function mondayOf(iso: string): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoOf(d);
}

export function addDays(iso: string, days: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => utc(iso).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

/** "6 to 11 Oct 2026" (Monday to Saturday). */
export function weekLabel(monday: string): string {
  const sat = addDays(monday, 5);
  const sameMonth = monday.slice(0, 7) === sat.slice(0, 7);
  const start = fmt(monday, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  return `${start} to ${fmt(sat, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "Week of 6 Oct" */
export const weekShort = (monday: string) => `Week of ${fmt(monday, { day: "numeric", month: "short" })}`;

/** "5 Oct 2026, 2:30 pm" from an ISO timestamp, in local time. */
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
