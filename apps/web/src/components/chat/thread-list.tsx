"use client";

import { useMemo, useState } from "react";
import { Lock, MessagesSquare } from "lucide-react";
import { Avatar } from "@/components/kit/avatar";
import { CountBadge } from "@/components/kit/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/kit/feedback";
import { SearchInput } from "@/components/kit/inputs";
import { cn } from "@/lib/cn";
import { aboutLine, counterpart, listStamp, type ChatThread } from "./types";

interface ThreadListProps {
  threads: ChatThread[] | null;
  error: string;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Shown when there are no conversations at all. */
  empty: { title: string; description: string; action?: React.ReactNode };
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThreadList({ threads, error, onRetry, selectedId, onSelect, empty }: ThreadListProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    if (!threads) return null;
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      [t.student.name, t.student.className, t.guardian?.name, t.staff?.name].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [threads, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search by student or name"
          aria-label="Search conversations"
          wrapperClassName="w-full"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {error && !threads ? (
          <ErrorState compact message={error} onRetry={onRetry} className="m-3" />
        ) : !shown ? (
          <ThreadSkeleton />
        ) : threads!.length === 0 ? (
          <EmptyState compact icon={<MessagesSquare />} title={empty.title} description={empty.description} action={empty.action} className="m-3" />
        ) : shown.length === 0 ? (
          <EmptyState compact title="No matches" description={`No conversation matches "${query.trim()}".`} className="m-3" />
        ) : (
          <ul aria-label="Conversations" className="flex flex-col gap-0.5 p-2">
            {shown.map((t) => {
              const name = counterpart(t);
              const active = t.id === selectedId;
              const preview = t.lastMessage ? `${t.lastMessage.mine ? "You: " : ""}${t.lastMessage.preview}` : "No messages yet";
              const unread = t.role === "OBSERVER" ? 0 : t.unread;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`${name}, ${aboutLine(t)}${unread ? `, ${unread} unread` : ""}`}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                      active ? "bg-primary-tint" : "hover:bg-surface-3",
                    )}
                  >
                    <Avatar name={t.role === "OBSERVER" ? t.student.name : name} src={t.role === "OBSERVER" ? (t.student.photoUrl ?? undefined) : undefined} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("truncate text-sm", unread ? "font-semibold text-fg" : "font-medium text-fg", active && "text-brand")}>{name}</span>
                        {t.lastMessageAt && <span className="ms-auto shrink-0 text-xs text-fg-muted tabular-nums">{listStamp(t.lastMessageAt)}</span>}
                      </span>
                      <span className="truncate text-xs text-fg-muted">{aboutLine(t)}</span>
                      <span className="flex items-center gap-2">
                        <span className={cn("truncate text-[13px]", unread ? "font-medium text-fg" : "text-fg-secondary")}>{preview}</span>
                        {!t.canPost && <Lock className="size-3.5 shrink-0 text-fg-muted" aria-label="Read only" />}
                        {unread > 0 && <CountBadge count={unread} className="ms-auto shrink-0" />}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
