"use client";

import { useId } from "react";
import { Building, CircleCheck, MonitorPlay, Shuffle, type LucideIcon } from "lucide-react";
import type { SchoolMode } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface SchoolModeOption {
  value: SchoolMode;
  title: string;
  summary: string;
  includes: string[];
  icon: LucideIcon;
}

export const SCHOOL_MODES: SchoolModeOption[] = [
  {
    value: "PHYSICAL",
    title: "Physical school",
    summary: "Classes happen on campus.",
    includes: ["Campuses and classrooms", "Transport routes", "Library desk", "ID cards"],
    icon: Building,
  },
  {
    value: "ONLINE",
    title: "Online school",
    summary: "Students learn from home.",
    includes: ["Live classes", "Courses and video lessons", "Assignments", "Quizzes with auto-marking"],
    icon: MonitorPlay,
  },
  {
    value: "HYBRID",
    title: "Both (hybrid)",
    summary: "Campus days plus online learning.",
    includes: ["Everything on campus", "Plus live classes, courses, assignments and quizzes"],
    icon: Shuffle,
  },
];

export const schoolModeLabel = (mode: SchoolMode) => SCHOOL_MODES.find((m) => m.value === mode)?.title ?? mode;

/** Three selectable cards (a radio group) for how the school teaches. */
export function SchoolModePicker({
  value,
  onChange,
  disabled,
  layout = "grid",
  legend = "How does your school teach?",
  hideLegend,
}: {
  value: SchoolMode;
  onChange: (mode: SchoolMode) => void;
  disabled?: boolean;
  /** "stack" = one card per row (narrow forms), "grid" = three columns from md up. */
  layout?: "grid" | "stack";
  legend?: string;
  hideLegend?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className={cn("mb-3 text-sm font-medium text-fg", hideLegend && "sr-only")}>{legend}</legend>
      <div className={cn("grid gap-3", layout === "grid" && "md:grid-cols-3")}>
        {SCHOOL_MODES.map((m) => {
          const selected = m.value === value;
          const Icon = m.icon;
          return (
            <label
              key={m.value}
              className={cn(
                "relative flex cursor-pointer gap-3 rounded-xl border bg-surface p-4 shadow-card transition-colors duration-150",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring",
                layout === "grid" && "md:flex-col",
                selected ? "border-primary bg-primary-tint" : "border-border hover:border-border-strong",
                disabled && "cursor-not-allowed opacity-70",
              )}
            >
              <input
                type="radio"
                name={name}
                value={m.value}
                checked={selected}
                onChange={() => onChange(m.value)}
                className="sr-only"
                aria-describedby={`${name}-${m.value}-desc`}
              />
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-lg",
                  selected ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg-secondary",
                )}
                aria-hidden
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-display text-base font-semibold text-fg">
                  {m.title}
                  {selected && <CircleCheck className="size-4 text-brand" aria-hidden />}
                </span>
                <span id={`${name}-${m.value}-desc`} className="mt-0.5 block text-[13px] text-fg-secondary">
                  {m.summary}
                  <span className="mt-2 flex flex-col gap-1 text-fg-muted">
                    {m.includes.map((i) => (
                      <span key={i} className="flex items-start gap-1.5">
                        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-muted" aria-hidden />
                        {i}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
