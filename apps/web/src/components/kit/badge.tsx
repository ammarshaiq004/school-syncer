import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Semantic tones. Legacy aliases: green=success, amber=warning, red=danger, blue=primary, gray=neutral. */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";
export type LegacyTone = "green" | "amber" | "red" | "blue" | "gray";
export type AnyTone = Tone | LegacyTone;

const ALIAS: Record<LegacyTone, Tone> = {
  green: "success",
  amber: "warning",
  red: "danger",
  blue: "primary",
  gray: "neutral",
};

export const toTone = (t: AnyTone): Tone => (t in ALIAS ? ALIAS[t as LegacyTone] : (t as Tone));

/** Background + text classes per tone, for custom chips. */
export const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-tint text-success-text",
  warning: "bg-warning-tint text-warning-text",
  danger: "bg-danger-tint text-danger-text",
  info: "bg-info-tint text-info-text",
  neutral: "bg-neutral-tint text-neutral-text",
  primary: "bg-primary-tint text-brand",
};

/** Solid dot colour per tone. */
export const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-fg-disabled",
  primary: "bg-primary",
};

export interface BadgeProps {
  tone?: AnyTone;
  children: ReactNode;
  className?: string;
  /** Optional leading icon (lucide element, sized automatically). */
  icon?: ReactNode;
}

/** Small tinted pill for labels and counts. */
export function Badge({ tone = "neutral", children, className, icon }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums [&_svg]:size-3",
        TONE_CLASS[toTone(tone)],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Maps common status words to tones (case-insensitive, underscores ok).
 * Paid/Present/Active = success, Pending/Late/Partial = warning,
 * Overdue/Absent/Failed = danger, Excused/Leave/Info = info, else neutral.
 */
const STATUS_TONES: Record<string, Tone> = {
  paid: "success", present: "success", active: "success", published: "success", approved: "success",
  admitted: "success", passed: "success", pass: "success", completed: "success", done: "success",
  submitted: "success", returned: "success", sent: "success", delivered: "success", issued: "success",
  open: "success", live: "danger",
  pending: "warning", late: "warning", partial: "warning", partially_paid: "warning", unpaid: "warning",
  draft: "neutral", trial: "info", past_due: "warning", due: "warning", applied: "info", enquiry: "neutral",
  waiting: "warning", review: "warning", in_review: "warning", interview: "info", test: "info",
  overdue: "danger", absent: "danger", failed: "danger", fail: "danger", rejected: "danger",
  suspended: "danger", cancelled: "neutral", canceled: "neutral", void: "neutral", lost: "danger",
  blocked: "danger", inactive: "neutral", closed: "neutral", archived: "neutral",
  excused: "info", leave: "info", on_leave: "info", info: "info", scheduled: "info", upcoming: "info",
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return STATUS_TONES[status.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? "neutral";
}

/** "PARTIALLY_PAID" -> "Partially paid". */
export function humanize(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface StatusPillProps {
  /** Raw status (e.g. "PAID"). Tone is inferred unless `tone` is given. */
  status: string;
  tone?: AnyTone;
  /** Visible text; defaults to the humanized status. */
  label?: ReactNode;
  className?: string;
}

/** Pill with a coloured dot: colour is never the only signal, the label is always shown. */
export function StatusPill({ status, tone, label, className }: StatusPillProps) {
  const t = tone ? toTone(tone) : statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[t],
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[t])} aria-hidden />
      {label ?? humanize(status)}
    </span>
  );
}

/** Tone for a letter grade: A* / A = success, B = primary, C = info, D/E = warning, F/U = danger. */
export function gradeTone(grade: string): Tone {
  const g = grade.trim().toUpperCase();
  if (g.startsWith("A")) return "success";
  if (g.startsWith("B")) return "primary";
  if (g.startsWith("C")) return "info";
  if (g.startsWith("D") || g.startsWith("E")) return "warning";
  if (g.startsWith("F") || g.startsWith("U")) return "danger";
  return "neutral";
}

/** Compact letter-grade chip, e.g. <LetterGrade grade="A+" />. */
export function LetterGrade({ grade, className }: { grade: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-8 items-center justify-center rounded-full px-2 font-display text-xs font-semibold tabular-nums",
        TONE_CLASS[gradeTone(grade)],
        className,
      )}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}

/** Small count bubble, e.g. on a bell or tab. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-fg tabular-nums", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
