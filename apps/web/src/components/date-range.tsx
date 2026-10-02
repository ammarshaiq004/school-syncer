"use client";

import { Field } from "@/components/ui";

/** From/to date pickers for reports. */
export function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From" type="date" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} />
      <Field label="To" type="date" value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} />
    </div>
  );
}
