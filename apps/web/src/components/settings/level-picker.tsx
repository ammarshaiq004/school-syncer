"use client";

import { Ban, Eye, PencilLine } from "lucide-react";
import type { AccessLevel } from "@/lib/api";
import { cn } from "@/lib/cn";

export const LEVELS: { value: AccessLevel; label: string; icon: typeof Eye }[] = [
  { value: "none", label: "None", icon: Ban },
  { value: "view", label: "View", icon: Eye },
  { value: "manage", label: "Manage", icon: PencilLine },
];

export const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, manage: 2 };

interface Props {
  value: AccessLevel;
  onChange: (level: AccessLevel) => void;
  /** Accessible name, e.g. "Fees access for Accountant". */
  label: string;
  readOnly?: boolean;
  /** Levels that cannot be picked, with the reason shown as a tooltip. */
  disabledLevels?: Partial<Record<AccessLevel, string>>;
}

/** Segmented None / View / Manage radio group for one module. */
export function LevelPicker({ value, onChange, label, readOnly, disabledLevels }: Props) {
  return (
    <div role="radiogroup" aria-label={label} aria-readonly={readOnly || undefined} className="inline-flex shrink-0 rounded-lg bg-surface-3 p-0.5">
      {LEVELS.map((l) => {
        const active = l.value === value;
        const reason = disabledLevels?.[l.value];
        const disabled = readOnly || !!reason;
        const Icon = l.icon;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled && !active}
            title={reason}
            onClick={() => !disabled && onChange(l.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed [&_svg]:size-3.5",
              active
                ? cn(
                    "bg-surface shadow-card",
                    l.value === "manage" ? "text-brand" : l.value === "view" ? "text-fg" : "text-fg-muted",
                  )
                : "text-fg-muted hover:text-fg disabled:opacity-40 disabled:hover:text-fg-muted",
              readOnly && active && "cursor-default",
            )}
          >
            <Icon aria-hidden />
            <span className="hidden sm:inline">{l.label}</span>
            <span className="sr-only sm:hidden">{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Small read-only level marker for the comparison table. */
export function LevelMark({ level }: { level: AccessLevel }) {
  const l = LEVELS.find((x) => x.value === level)!;
  const Icon = l.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3",
        level === "manage" ? "bg-primary-tint text-brand" : level === "view" ? "bg-info-tint text-info-text" : "text-fg-disabled",
      )}
    >
      <Icon aria-hidden />
      {l.label}
    </span>
  );
}
