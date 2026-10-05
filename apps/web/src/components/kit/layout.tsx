import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: ReactNode;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-fg-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="truncate rounded transition-colors hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span className={cn("truncate", last && "text-fg-secondary")} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5 shrink-0 opacity-60 rtl:rotate-180" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Primary and secondary actions, right-aligned (wrap under the title on phones). */
  actions?: ReactNode;
  /** Optional element left of the title (Avatar, icon square). */
  leading?: ReactNode;
  /** Extra row under the title (status pills, meta). */
  meta?: ReactNode;
  className?: string;
}

/** Top of every page: breadcrumbs, h1 (24px, 20px on phones), description and actions. */
export function PageHeader({ title, description, breadcrumbs, actions, leading, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 print:hidden", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3.5">
          {leading}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg sm:text-2xl">{title}</h1>
            {description && <p className="mt-1 max-w-[70ch] text-sm text-fg-muted">{description}</p>}
            {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Titled block of a page without a card around it (18px heading). */
export function Section({ title, description, action, children, className }: SectionProps) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Row of filters and actions above a table. Put a <ToolbarSpacer/> to push items to the right. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ms-auto" aria-hidden />;
}

const COLS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
} as const;

/** Responsive grid for KpiCards: 1 column on phones, 2 at sm, `cols` at xl. */
export function StatGrid({ children, cols = 4, className }: { children: ReactNode; cols?: keyof typeof COLS; className?: string }) {
  return <div className={cn("grid gap-4 [&>*]:min-w-0", COLS[cols], className)}>{children}</div>;
}

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
  /** Span the full row. */
  full?: boolean;
}

/** Label/value pairs for record details (profile, invoice header). */
export function DescriptionList({ items, columns = 2, className }: { items: DescriptionItem[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((it, i) => (
        <div key={i} className={cn("min-w-0", it.full && "sm:col-span-full")}>
          <dt className="text-xs font-medium text-fg-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{it.value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}
