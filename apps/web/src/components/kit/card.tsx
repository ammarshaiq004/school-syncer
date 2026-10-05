import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { TONE_CLASS, toTone, type AnyTone } from "./badge";

const PAD = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;

export interface CardProps extends ComponentProps<"div"> {
  /** none | sm (16px) | md (20-24px, default) | lg */
  padding?: keyof typeof PAD;
  /** Adds a hover lift (for clickable cards). */
  interactive?: boolean;
}

/** White surface, 12px radius, hairline border. Do not nest cards. */
export function Card({ padding = "md", interactive, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-border bg-surface shadow-card",
        PAD[padding],
        interactive && "transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-raised",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, links, a SegmentedControl). */
  action?: ReactNode;
  /** Optional leading icon (lucide element). */
  icon?: ReactNode;
  className?: string;
  /** Heading level, default h2. */
  as?: "h2" | "h3";
}

/** Title row for a Card: 16px title, muted description, actions on the right. */
export function CardHeader({ title, description, action, icon, className, as: H = "h2" }: CardHeaderProps) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand [&_svg]:size-4">{icon}</span>
        )}
        <div className="min-w-0">
          <H className="text-base font-semibold text-fg">{title}</H>
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** Footer strip inside a Card (use with padding="none" cards or at the bottom with negative margins). */
export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-[13px] text-fg-muted", className)}>{children}</div>;
}

export interface KpiDelta {
  /** Percentage or absolute change. Sign decides the arrow. */
  value: number;
  /** Suffix after the number, default "%". */
  unit?: string;
  /** e.g. "vs last month" */
  label?: string;
  /** Set false when a rise is bad (e.g. absences). Default true. */
  upIsGood?: boolean;
}

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** Tone of the icon square, default primary. */
  tone?: AnyTone;
  delta?: KpiDelta;
  /** Small muted text under the value. */
  hint?: ReactNode;
  /** Slot on the right of the value, e.g. <Sparkline data={...} />. */
  sparkline?: ReactNode;
  /** Makes the whole card a link. */
  href?: string;
  loading?: boolean;
  /** The figure could not be loaded: shows a dash and "Not available" instead of the value. */
  error?: boolean;
  className?: string;
}

/** Metric tile: label, big tabular value, optional icon, delta chip and sparkline. */
export function KpiCard({ label, value, icon, tone = "primary", delta, hint, sparkline, href, loading, error, className }: KpiCardProps) {
  if (error && !loading) {
    value = <span className="text-fg-muted">–</span>;
    hint = "Not available";
    delta = undefined;
    sparkline = undefined;
  }
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium text-fg-muted">{label}</span>
        {icon && (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-[18px]", TONE_CLASS[toTone(tone)])} aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {loading ? (
            <span className="block h-7 w-24 animate-pulse rounded-md bg-surface-3 motion-reduce:animate-none" />
          ) : (
            <span className="block truncate font-display text-2xl font-semibold tabular-nums text-fg">{value}</span>
          )}
          {(delta || hint) && !loading && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              {delta && <DeltaChip {...delta} />}
              {hint && <span>{hint}</span>}
            </div>
          )}
        </div>
        {sparkline && !loading && <div className="shrink-0">{sparkline}</div>}
      </div>
    </>
  );
  const cls = cn(
    "block min-w-0 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5",
    href && "transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-raised focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none",
    className,
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** "+3.2% vs last month" chip. */
export function DeltaChip({ value, unit = "%", label, upIsGood = true }: KpiDelta) {
  const up = value >= 0;
  const good = up === upIsGood;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const text = `${up ? "+" : "-"}${Math.abs(value).toLocaleString("en-PK", { maximumFractionDigits: 1 })}${unit}`;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
          good ? "bg-success-tint text-success-text" : "bg-danger-tint text-danger-text",
        )}
      >
        <Arrow className="size-3" aria-hidden />
        {text}
        <span className="sr-only">{good ? "(good)" : "(needs attention)"}</span>
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}
