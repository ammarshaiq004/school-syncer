"use client";

import { Megaphone } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AUDIENCE_LABEL, postedAt } from "./format";
import type { Notice } from "./types";

/** Announcements as a list: title, audience, who posted it and when, and the text (clamped unless `full`). */
export function NoticeList({ notices, full, className }: { notices: Notice[]; full?: boolean; className?: string }) {
  return (
    <ul className={cn("flex flex-col divide-y divide-border", className)}>
      {notices.map((n) => (
        <li key={n.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
            <Megaphone className="size-4" />
          </span>
          <article className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">{n.title}</h3>
              <Badge tone={n.audience === "SCHOOL" ? "neutral" : "primary"}>{AUDIENCE_LABEL[n.audience]}</Badge>
            </div>
            <p className={cn("mt-1 whitespace-pre-line text-sm text-fg-secondary", !full && "line-clamp-2")}>{n.body}</p>
            <p className="mt-1 text-xs text-fg-muted">
              <time dateTime={n.createdAt}>{postedAt(n.createdAt)}</time>
              {n.createdBy && <> by {n.createdBy}</>}
            </p>
          </article>
        </li>
      ))}
    </ul>
  );
}
