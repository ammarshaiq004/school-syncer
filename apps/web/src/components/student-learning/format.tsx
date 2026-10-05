import { BookOpenText, CirclePlay, FileText, Link2, type LucideIcon } from "lucide-react";
import { SCHOOL_TZ } from "@/components/elearning/live-types";
import type { LessonKind, QuizWindow, StudentQuizCard, Urgency } from "./types";

export const LESSON_KIND: Record<LessonKind, { label: string; icon: LucideIcon }> = {
  VIDEO: { label: "Video", icon: CirclePlay },
  TEXT: { label: "Reading", icon: BookOpenText },
  LINK: { label: "Link", icon: Link2 },
  DOCUMENT: { label: "Document", icon: FileText },
};

/** The course colour (hex from the teacher) or the brand indigo. */
export const courseColor = (color: string | null | undefined) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color : "var(--chart-1)");

/** "Mon 12 Oct, 10:30 am" in school time (Asia/Karachi). */
export function dateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SCHOOL_TZ })}, ${d
    .toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SCHOOL_TZ })
    .toLowerCase()}`;
}

/** "12 Oct 2026" */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: SCHOOL_TZ });

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "3 h left", "2 days left", "5 h overdue". */
export function timeLeft(hoursLeft: number) {
  const abs = Math.abs(hoursLeft);
  const text = abs >= 48 ? plural(Math.floor(abs / 24), "day") : abs >= 1 ? `${Math.floor(abs)} h` : `${Math.max(1, Math.round(abs * 60))} min`;
  return hoursLeft >= 0 ? `${text} left` : `${text} overdue`;
}

/** "Handed in on time" / "Handed in 2 days late", for work that is already in. */
export function handedInText(dueAt: string, submittedAt: string) {
  const hours = (new Date(submittedAt).getTime() - new Date(dueAt).getTime()) / 3_600_000;
  if (hours <= 0) return "Handed in on time";
  const late = hours >= 48 ? plural(Math.floor(hours / 24), "day") : hours >= 1 ? `${Math.floor(hours)} h` : `${Math.max(1, Math.round(hours * 60))} min`;
  return `Handed in ${late} late`;
}

/**
 * The one assignment average the student workspace shows: the mean of each
 * marked assignment's percentage, so a 20-point worksheet counts the same as a
 * 5-point task. The assignments page and the grades page both use it, so the
 * two never disagree.
 */
export function assignmentAverage(marked: { points: number | null; maxPoints: number }[]) {
  const scored = marked.filter((a) => a.points != null && a.maxPoints > 0);
  if (!scored.length) return null;
  return scored.reduce((n, a) => n + (a.points! / a.maxPoints) * 100, 0) / scored.length;
}

/** How `assignmentAverage` is worked out, for a hint line under the number. */
export const ASSIGNMENT_AVERAGE_HINT = "Average of each assignment's percentage";

export const URGENCY: Record<Exclude<Urgency, null>, { label: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  overdue: { label: "Overdue", tone: "danger" },
  today: { label: "Due today", tone: "warning" },
  soon: { label: "Due soon", tone: "info" },
  later: { label: "Later", tone: "neutral" },
};

export const QUIZ_WINDOW: Record<QuizWindow, { label: string; tone: "success" | "info" | "neutral" }> = {
  open: { label: "Open", tone: "success" },
  upcoming: { label: "Opens later", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
};

/** One-line state for a quiz card: what the student can do next. */
export function quizStatus(q: StudentQuizCard): { label: string; tone: "success" | "warning" | "info" | "neutral" | "primary" } {
  if (q.inProgressAttemptId) return { label: "In progress", tone: "warning" };
  if (q.window === "upcoming") return { label: "Opens later", tone: "info" };
  if (q.submitted > 0 && (q.attemptsLeft === 0 || q.window === "closed")) return { label: "Done", tone: "success" };
  if (q.window === "closed") return { label: q.submitted ? "Done" : "Missed", tone: "neutral" };
  return { label: q.submitted ? `${q.attemptsLeft} attempt${q.attemptsLeft === 1 ? "" : "s"} left` : "Not started", tone: "primary" };
}

/** Tone for a percentage score. */
export const scoreTone = (pct: number | null | undefined) =>
  pct == null ? "neutral" : pct >= 80 ? "success" : pct >= 50 ? "primary" : pct >= 33 ? "warning" : "danger";
