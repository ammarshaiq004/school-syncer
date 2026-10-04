/**
 * Legacy barrel. Old pages import Card, Button, Field, TextArea, ErrorText, Notice, PageTitle, Badge,
 * tableClass and rowClass from here; they keep working, restyled with the design tokens.
 * Everything in the kit is re-exported too, so new code can import from "@/components/ui" or "@/components/kit".
 */
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { inputClass } from "./kit/styles";

export * from "./kit";

export function Field({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="text-[13px] font-medium text-fg-secondary">{label}</span>
      <input className={cn(inputClass, "h-9", className)} {...props} />
    </label>
  );
}

export function TextArea({ label, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="text-[13px] font-medium text-fg-secondary">{label}</span>
      <textarea className={cn(inputClass, "min-h-20 py-2 leading-relaxed", className)} rows={4} {...props} />
    </label>
  );
}

/** Inline error line (renders nothing when empty). Prefer <Alert tone="danger"> or a toast for new code. */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-1.5 text-sm text-danger-text" role="alert">
      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
      {children}
    </p>
  );
}

/** Inline success line (renders nothing when empty). Prefer a toast for new code. */
export function Notice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-1.5 text-sm text-success-text" role="status">
      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
      {children}
    </p>
  );
}

/** Legacy page title. New pages use <PageHeader>. */
export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-fg sm:text-2xl">{children}</h1>
      {action}
    </div>
  );
}

/**
 * Classes for a plain <table> (legacy pages): muted uppercase header on a tinted band,
 * zebra rows, hover, 44px rows. New code should use <DataTable>.
 */
export const tableClass = [
  "w-full border-separate border-spacing-0 text-left text-sm",
  "[&_th]:h-10 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.04em] [&_th]:text-fg-muted",
  "[&_th:first-child]:rounded-tl-lg [&_th:last-child]:rounded-tr-lg",
  "[&_td]:h-11 [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle",
  "[&_tbody_tr:nth-child(even)]:bg-surface-2/70 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-3/70",
  "[&_thead]:opacity-100",
].join(" ");

/** Row hairline for legacy tables. */
export const rowClass = "[&>td]:border-b [&>td]:border-border";
