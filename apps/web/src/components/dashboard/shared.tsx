"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Megaphone } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, ErrorState, humanize, SkeletonRows } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface Notice {
  id: string;
  title: string;
  body: string;
  audience: string;
  createdAt: string;
  createdBy: string | { name: string } | null;
}

/** "Good morning" / "Good afternoon" / "Good evening" for the browser's clock. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "Sunday, 4 October 2026" */
export const longDate = (now = new Date()) =>
  now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "Rs 4.8 lakh", "Rs 85k", "Rs 950" for chart axes. */
export function compactRupees(n: number) {
  if (Math.abs(n) >= 100000) return `Rs ${(n / 100000).toLocaleString("en-PK", { maximumFractionDigits: 1 })} lakh`;
  if (Math.abs(n) >= 1000) return `Rs ${(n / 1000).toLocaleString("en-PK", { maximumFractionDigits: 1 })}k`;
  return `Rs ${n.toLocaleString("en-PK")}`;
}

/** "2 hours ago", "3 days ago", or a date for anything older than a week. */
export function relativeTime(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "View all" link for a card header. */
export function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-brand hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
    >
      {label}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** Loading, error and empty handling for a card section; renders children once there is data. */
export function SectionState<T>({
  data,
  error,
  onRetry,
  empty,
  rows = 4,
  children,
}: {
  data: T[] | null | undefined;
  error?: string;
  onRetry?: () => void;
  empty: { title: string; description?: string; icon?: ReactNode; action?: ReactNode };
  rows?: number;
  children: (data: T[]) => ReactNode;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} compact />;
  if (!data) return <SkeletonRows rows={rows} columns={2} />;
  if (data.length === 0) return <EmptyState {...empty} compact />;
  return <>{children(data)}</>;
}

const AUDIENCE_TONE: Record<string, "primary" | "info" | "neutral" | "warning"> = {
  SCHOOL: "primary",
  CAMPUS: "info",
  CLASS: "warning",
  SECTION: "neutral",
};

/** Latest announcements with audience tag, author and relative time. */
export function NoticeBoard({
  notices,
  error,
  onRetry,
  canPost,
  className,
}: {
  notices: Notice[] | null | undefined;
  error?: string;
  onRetry?: () => void;
  canPost?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader title="Notice board" description="Latest announcements" icon={<Megaphone />} action={<ViewAll href="/announcements" />} />
      <SectionState
        data={notices}
        error={error}
        onRetry={onRetry}
        empty={{
          title: "No announcements yet",
          description: canPost ? "Post a notice to share news with staff and parents." : "Notices from the school office will show here.",
          icon: <Megaphone />,
          action: canPost ? (
            <Link href="/announcements" className="text-[13px] font-medium text-brand hover:underline">
              Post a notice
            </Link>
          ) : undefined,
        }}
      >
        {(list) => (
          <ul className="-my-2 divide-y divide-border">
            {list.slice(0, 4).map((n) => {
              const author = typeof n.createdBy === "string" ? n.createdBy : n.createdBy?.name;
              return (
                <li key={n.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-fg">{n.title}</p>
                    <Badge tone={AUDIENCE_TONE[n.audience] ?? "neutral"} className="shrink-0">
                      {humanize(n.audience)}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-fg-secondary">{n.body}</p>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    {author ? `${author} · ` : ""}
                    <time dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </SectionState>
    </Card>
  );
}

export interface QuickAction {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
}

/** Grid of shortcut tiles. */
export function QuickActions({ actions, className }: { actions: QuickAction[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title="Quick actions" description="Jump straight to common tasks" />
      {actions.length === 0 ? (
        <EmptyState title="Nothing to do here" description="Your role has no shortcuts on this page." compact />
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <li key={a.href + a.label}>
              <Link
                href={a.href}
                className="group flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-3 transition-[border-color,background-color,transform] duration-150 hover:border-border-strong hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
              >
                <span className="grid size-8 place-items-center rounded-lg bg-primary-tint text-brand [&_svg]:size-4" aria-hidden>
                  {a.icon}
                </span>
                <span className="text-[13px] font-medium text-fg">{a.label}</span>
                <span className="text-xs text-fg-muted">{a.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
