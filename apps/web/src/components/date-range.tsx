"use client";

import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/format";
import { TextField } from "@/components/kit";

type Range = { from: string; to: string };

const iso = (d: Date) => d.toLocaleDateString("en-CA");

/** Quick ranges, computed in the browser's timezone. */
function presets(): { id: string; label: string; range: Range }[] {
  const today = todayIso();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { id: "this-month", label: "This month", range: { from: `${today.slice(0, 7)}-01`, to: today } },
    { id: "last-month", label: "Last month", range: { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) } },
    { id: "30-days", label: "Last 30 days", range: { from: iso(new Date(y, m, now.getDate() - 29)), to: today } },
    { id: "this-year", label: "This year", range: { from: `${y}-01-01`, to: today } },
  ];
}

/** From/to date pickers for reports, with quick presets. */
export function DateRange({
  from,
  to,
  onChange,
  className,
}: {
  from: string;
  to: string;
  onChange: (range: Range) => void;
  className?: string;
}) {
  const quick = presets();
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <TextField label="From" type="date" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} wrapperClassName="w-40" />
      <TextField label="To" type="date" value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} wrapperClassName="w-40" />
      <div role="group" aria-label="Quick date ranges" className="inline-flex min-h-9 flex-wrap items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
        {quick.map((p) => {
          const active = p.range.from === from && p.range.to === to;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(p.range)}
              className={cn(
                "h-8 rounded-md px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                active ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
