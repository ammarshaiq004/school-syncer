"use client";

import { ChevronDown } from "lucide-react";
import { Button, Checkbox, Popover } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional muted text after the label, e.g. the campus. */
  hint?: string;
}

/**
 * A toolbar button that opens a popover of checkboxes. Shows "Grade: 2" once
 * something is picked; an empty selection means "all".
 */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  emptyText = "Nothing to filter by yet.",
}: {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
}) {
  const picked = new Set(value);
  const count = options.filter((o) => picked.has(o.value)).length;
  const summary =
    count === 0 ? label : count === 1 ? `${label}: ${options.find((o) => picked.has(o.value))?.label}` : `${label}: ${count}`;

  function toggle(v: string, on: boolean) {
    const next = new Set(picked);
    if (on) next.add(v);
    else next.delete(v);
    onChange(options.map((o) => o.value).filter((x) => next.has(x)));
  }

  return (
    <Popover
      align="start"
      className="w-64 p-0"
      trigger={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconRight={<ChevronDown />}
          aria-label={count ? `${label} filter, ${count} selected` : `${label} filter`}
          className={cn("max-w-56", count > 0 && "border-primary/40 bg-primary-tint text-brand")}
        >
          <span className="truncate">{summary}</span>
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">{label}</span>
        {count > 0 && (
          <button type="button" className="text-[13px] font-medium text-brand hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-2" role="group" aria-label={`${label} options`}>
          {options.map((o) => (
            <li key={o.value}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-surface-2">
                <Checkbox checked={picked.has(o.value)} onCheckedChange={(on) => toggle(o.value, on)} aria-label={o.label} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-fg-muted">{o.hint}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
