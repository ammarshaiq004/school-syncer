"use client";

import type { ReactNode } from "react";
import { Tabs as RTabs } from "radix-ui";
import { cn } from "@/lib/cn";

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Small count shown after the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** underline (page sections, default) | pills (inside cards). */
  variant?: "underline" | "pills";
  /** TabPanel elements. */
  children?: ReactNode;
  className?: string;
  listClassName?: string;
  "aria-label"?: string;
}

/** Accessible tabs (radix). Put <TabPanel value="..."> children for each tab. */
export function Tabs({ tabs, value, defaultValue, onValueChange, variant = "underline", children, className, listClassName, ...props }: TabsProps) {
  return (
    <RTabs.Root value={value} defaultValue={defaultValue ?? tabs[0]?.value} onValueChange={onValueChange} className={cn("flex min-w-0 flex-col", className)}>
      <RTabs.List
        aria-label={props["aria-label"]}
        className={cn(
          "flex max-w-full overflow-x-auto [scrollbar-width:none]",
          variant === "underline" ? "gap-1 border-b border-border" : "w-fit gap-1 rounded-lg bg-surface-3 p-1",
          listClassName,
        )}
      >
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-4",
              variant === "underline"
                ? "-mb-px border-b-2 border-transparent px-3 py-2.5 text-fg-muted hover:text-fg data-[state=active]:border-primary data-[state=active]:text-brand"
                : "rounded-md px-3 py-1.5 text-fg-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-card",
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold tabular-nums text-fg-muted">{t.count}</span>
            )}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RTabs.Content value={value} className={cn("pt-5 focus-visible:outline-none data-[state=active]:animate-rise", className)}>
      {children}
    </RTabs.Content>
  );
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
  size?: "sm" | "md";
  "aria-label": string;
  className?: string;
}

/** Compact toggle between a few options (e.g. Week / Month). Not for navigation between panels; use Tabs. */
export function SegmentedControl<V extends string>({ value, onChange, options, size = "sm", className, ...props }: SegmentedControlProps<V>) {
  return (
    <div role="radiogroup" aria-label={props["aria-label"]} className={cn("inline-flex rounded-lg bg-surface-3 p-0.5", className)}>
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
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-3.5",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              active ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
