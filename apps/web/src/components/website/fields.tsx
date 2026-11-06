"use client";

import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, IconButton, NativeSelect, TextareaField, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* A list of repeating items (programmes, news, FAQ...) edited in rows */
/* ------------------------------------------------------------------ */

export interface FieldDef<T> {
  key: keyof T & string;
  label: string;
  kind?: "text" | "textarea" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  max?: number;
  placeholder?: string;
  hint?: string;
  /** Spans the whole row. */
  wide?: boolean;
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function ListEditor<T extends object>({
  items,
  onChange,
  fields,
  blank,
  max,
  noun,
  titleOf,
  empty,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  fields: FieldDef<T>[];
  blank: T;
  max: number;
  /** "programme", "question"... used in button and aria labels. */
  noun: string;
  titleOf: (item: T) => string;
  empty?: ReactNode;
}) {
  const set = (i: number, key: keyof T, value: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && empty && <p className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-fg-muted">{empty}</p>}
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => {
          const title = titleOf(item).trim() || `New ${noun}`;
          return (
            <li key={i} className="rounded-xl border border-border bg-surface-2 p-3.5">
              <div className="mb-3 flex items-center gap-1">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                  <span className="me-2 tabular-nums text-fg-muted">{i + 1}.</span>
                  {title}
                </p>
                <IconButton size="sm" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))}><ArrowUp /></IconButton>
                <IconButton size="sm" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))}><ArrowDown /></IconButton>
                <IconButton size="sm" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 /></IconButton>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => {
                  const value = item[f.key] as unknown;
                  const wrap = cn(f.wide && "sm:col-span-2");
                  if (f.kind === "textarea") {
                    return <TextareaField key={f.key} label={f.label} hint={f.hint} rows={3} maxLength={f.max} value={String(value ?? "")} onChange={(e) => set(i, f.key, e.target.value)} wrapperClassName={cn("sm:col-span-2", wrap)} />;
                  }
                  if (f.kind === "select") {
                    return (
                      <label key={f.key} className={cn("flex min-w-0 flex-col gap-1.5 text-sm", wrap)}>
                        <span className="text-[13px] font-medium text-fg-secondary">{f.label}</span>
                        <NativeSelect options={f.options} value={String(value ?? "")} onChange={(e) => set(i, f.key, e.target.value)} wrapperClassName="w-full" />
                      </label>
                    );
                  }
                  if (f.kind === "number") {
                    return <TextField key={f.key} label={f.label} hint={f.hint} type="number" min={0} inputMode="numeric" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => set(i, f.key, e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value))))} wrapperClassName={wrap} />;
                  }
                  return <TextField key={f.key} label={f.label} hint={f.hint} type={f.kind === "date" ? "date" : "text"} maxLength={f.max} placeholder={f.placeholder} value={String(value ?? "")} onChange={(e) => set(i, f.key, e.target.value)} wrapperClassName={wrap} />;
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" icon={<Plus />} disabled={items.length >= max} onClick={() => onChange([...items, { ...blank }])}>
          Add {noun}
        </Button>
        <span className="text-xs text-fg-muted tabular-nums">{items.length} of {max}</span>
      </div>
    </div>
  );
}

/** A list of single lines (what to bring). */
export function LineListEditor({ items, onChange, max, noun, maxLength = 120 }: { items: string[]; onChange: (items: string[]) => void; max: number; noun: string; maxLength?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((line, i) => (
        <div key={i} className="flex items-center gap-1">
          <TextField aria-label={`${noun} ${i + 1}`} value={line} maxLength={maxLength} onChange={(e) => onChange(items.map((l, j) => (j === i ? e.target.value : l)))} wrapperClassName="flex-1" />
          <IconButton size="sm" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))}><ArrowUp /></IconButton>
          <IconButton size="sm" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))}><ArrowDown /></IconButton>
          <IconButton size="sm" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 /></IconButton>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" icon={<Plus />} disabled={items.length >= max} onClick={() => onChange([...items, ""])}>
          Add {noun}
        </Button>
        <span className="text-xs text-fg-muted tabular-nums">{items.length} of {max}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Colour and choice controls                                          */
/* ------------------------------------------------------------------ */

export const HEX = /^#[0-9a-fA-F]{6}$/;

/** Native colour picker plus a hex box, so a brand colour can be pasted. */
export function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (hex: string) => void; hint?: string }) {
  const id = useId();
  const valid = HEX.test(value);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="text-[13px] font-medium text-fg-secondary">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : "#4f46e5"}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-0.5"
        />
        <TextField
          id={id}
          value={value}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
          error={valid ? undefined : "Use a colour like #4f46e5"}
          wrapperClassName="w-32"
          className="font-mono"
        />
      </div>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </div>
  );
}

/** Radio cards: one choice from a few, each with a title and a line of help. */
export function ChoiceCards<V extends string>({
  label,
  value,
  onChange,
  options,
  columns = 3,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; title: string; text: string; visual?: ReactNode }[];
  columns?: 2 | 3;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-fg-secondary">{label}</span>
      <div className={cn("grid gap-2.5", columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-3 text-start transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                active ? "border-primary bg-primary-tint shadow-card" : "border-border bg-surface hover:border-border-strong",
              )}
            >
              {o.visual}
              <span className="text-sm font-semibold text-fg">{o.title}</span>
              <span className="text-xs leading-snug text-fg-muted">{o.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
