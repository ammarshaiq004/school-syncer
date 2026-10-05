"use client";

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Coffee, MapPin } from "lucide-react";
import { cn } from "@/lib/cn";
import { roomLabel } from "@/lib/format";

export interface Period { id: string; name: string; startTime: string; endTime: string; isBreak: boolean }
export interface Slot {
  id: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  subject: string;
  teacherId: string | null;
  teacher: string | null;
  section: string;
  room: string | null;
}

export const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Days to show: Monday to Friday, plus any weekend day that has classes. */
export function visibleDays(slots: { dayOfWeek: number }[], withSaturday = false) {
  const days = [1, 2, 3, 4, 5];
  if (withSaturday || slots.some((s) => s.dayOfWeek === 6)) days.push(6);
  if (slots.some((s) => s.dayOfWeek === 7)) days.push(7);
  return days;
}

/** Subject colours: chart palette (indigo, sky, emerald, amber, rose), picked by a stable hash of the name. */
const SUBJECT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function subjectColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.toLowerCase().charCodeAt(i)) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length];
}

/** Soft tinted block with a 3px left accent in the subject's colour. */
export function subjectBlockStyle(name: string): CSSProperties {
  const c = subjectColor(name);
  return {
    backgroundColor: `color-mix(in oklab, ${c} 11%, var(--surface))`,
    borderInlineStartColor: c,
  };
}

// Day of week as 1 (Mon) to 7 (Sun); 0 on the server so the first render matches.
const subscribeNoop = () => () => {};
const isoToday = () => ((new Date().getDay() + 6) % 7) + 1;
function useToday() {
  return useSyncExternalStore(subscribeNoop, isoToday, () => 0);
}

/** Periods down the side, days across the top; breaks span the row and are shaded. Today's column is tinted. */
export function WeekGrid({
  periods,
  days,
  cell,
}: {
  periods: Period[];
  days: number[];
  cell: (day: number, period: Period) => ReactNode;
}) {
  const today = useToday();
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[680px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-32 border-b border-border bg-surface-2 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
              Period
            </th>
            {days.map((d) => (
              <th
                key={d}
                scope="col"
                className={cn(
                  "border-b border-s border-border bg-surface-2 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-[0.04em]",
                  d === today ? "text-brand" : "text-fg-muted",
                )}
              >
                <abbr title={DAY_NAMES[d]} className="no-underline">{DAYS[d]}</abbr>
                {d === today && (
                  <span className="ms-2 rounded-full bg-primary-tint px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-brand">
                    Today
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => {
            const last = i === periods.length - 1;
            const rowBorder = last ? "" : "border-b border-border";
            return (
              <tr key={p.id}>
                <th scope="row" className={cn("sticky left-0 z-10 bg-surface px-3 py-2.5 text-left align-top font-normal", rowBorder, p.isBreak && "bg-surface-2")}>
                  <div className="font-medium text-fg">{p.name}</div>
                  <div className="text-xs tabular-nums text-fg-muted">
                    {p.startTime} to {p.endTime}
                  </div>
                </th>
                {p.isBreak ? (
                  <td
                    colSpan={days.length}
                    className={cn(
                      "border-s border-border bg-surface-2 px-3 py-2 text-center text-xs font-medium uppercase tracking-[0.06em] text-fg-muted",
                      rowBorder,
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Coffee className="size-3.5" aria-hidden />
                      {p.name}
                    </span>
                  </td>
                ) : (
                  days.map((d) => (
                    <td key={d} className={cn("border-s border-border p-1.5 align-top", rowBorder, d === today && "bg-primary-tint/40")}>
                      {cell(d, p)}
                    </td>
                  ))
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A read-only cell: a coloured subject block with teacher or section, and room. */
export function SlotText({ slot, show }: { slot?: Slot; show: "teacher" | "section" }) {
  if (!slot) {
    return (
      <span className="block px-2 py-1.5 text-fg-disabled" aria-label="Free period">
        -
      </span>
    );
  }
  const second = show === "teacher" ? slot.teacher : slot.section;
  return (
    <div className="min-h-12 rounded-md border-s-[3px] px-2.5 py-1.5" style={subjectBlockStyle(slot.subject)}>
      <div className="truncate font-medium text-fg">{slot.subject}</div>
      {second && <div className="truncate text-xs text-fg-secondary">{second}</div>}
      {slot.room && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
          <MapPin className="size-3" aria-hidden />
          {roomLabel(slot.room)}
        </div>
      )}
    </div>
  );
}
