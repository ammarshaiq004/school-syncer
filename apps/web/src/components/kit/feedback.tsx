import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, Inbox, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/** Pulsing placeholder block. Size it with className (h-4 w-32 ...). */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-surface-3 motion-reduce:animate-none", className)} />;
}

/** Stack of skeleton lines for a list or table body (not a <table>). */
export function SkeletonRows({ rows = 5, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col divide-y divide-border", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/4" : "flex-1", c === columns - 1 && "max-w-24")} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Skeleton for a grid of cards/KPI tiles. */
export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-5 shadow-card">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-3 h-7 w-28" />
          <Skeleton className="mt-3 h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Button(s) to resolve the empty state, e.g. "Add student". */
  action?: ReactNode;
  /** Less padding, for inside tables and small cards. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center animate-rise", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      <span className={cn("grid place-items-center rounded-full border border-border bg-surface-2 text-fg-muted", compact ? "size-10 [&_svg]:size-5" : "size-12 [&_svg]:size-6")} aria-hidden>
        {icon ?? <Inbox />}
      </span>
      <div className="max-w-sm">
        <p className="font-display text-[15px] font-semibold text-fg">{title}</p>
        {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  /** The error message (e.g. from useApi().error). */
  message?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

/** Failed load: message plus Retry. */
export function ErrorState({ title = "Could not load this", message, onRetry, compact, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      <span className={cn("grid place-items-center rounded-full bg-danger-tint text-danger", compact ? "size-10 [&_svg]:size-5" : "size-12 [&_svg]:size-6")} aria-hidden>
        <CircleAlert />
      </span>
      <div className="max-w-md">
        <p className="font-display text-[15px] font-semibold text-fg">{title}</p>
        {message && <p className="mt-1 text-[13px] text-fg-muted">{message}</p>}
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry} icon={<RefreshCw />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export type AlertTone = "info" | "success" | "warning" | "danger" | "neutral" | "primary";

const ALERT_TONE: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-info/25 bg-info-tint text-info-text", icon: <Info /> },
  success: { box: "border-success/25 bg-success-tint text-success-text", icon: <CircleCheck /> },
  warning: { box: "border-warning/30 bg-warning-tint text-warning-text", icon: <TriangleAlert /> },
  danger: { box: "border-danger/25 bg-danger-tint text-danger-text", icon: <CircleAlert /> },
  neutral: { box: "border-border bg-surface-2 text-fg-secondary", icon: <Info /> },
  primary: { box: "border-primary/20 bg-primary-tint text-brand", icon: <Info /> },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Right-side action (link or small button). */
  action?: ReactNode;
  onDismiss?: () => void;
  /** Override the icon; pass null for none. */
  icon?: ReactNode | null;
  /** Full-width strip with no radius (for page-level banners). */
  banner?: boolean;
  className?: string;
}

/** Inline message box. Danger alerts are announced (role=alert), others are polite (role=status). */
export function Alert({ tone = "info", title, children, action, onDismiss, icon, banner, className }: AlertProps) {
  const t = ALERT_TONE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 border text-sm",
        banner ? "border-x-0 border-t-0 px-4 py-2.5 md:px-6" : "rounded-lg px-3.5 py-3",
        t.box,
        className,
      )}
    >
      {icon !== null && <span className="mt-0.5 shrink-0 [&_svg]:size-4" aria-hidden>{icon ?? t.icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-95")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 shrink-0 rounded-md p-1 opacity-70 hover:opacity-100">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Spinning loader. Pass label for an accessible name (otherwise decorative). */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2 text-fg-muted">
      <LoaderCircle className={cn("size-4 animate-spin", className)} aria-hidden />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}

/** Centered spinner for whole sections or pages. */
export function LoadingBlock({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-40 items-center justify-center", className)}>
      <Spinner label={label} />
    </div>
  );
}
