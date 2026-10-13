"use client";

import { History } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { useApi } from "@/lib/use-api";

/** One line of a change history, already worded for the page it is on. */
export interface ChangeLine {
  at: string;
  by: string;
  studentName: string;
  /** "Entered" or "Taken" for a first value, "Changed" for a later one. */
  label: string;
  changed: boolean;
  from: string | null;
  to: string;
  /** e.g. the register's day, when the history spans several. */
  context?: string;
  reason?: string | null;
}

interface ChangeHistoryProps<T> {
  title: string;
  description: string;
  /** API path returning `{ history: T[] }`, newest first. */
  path: string;
  toLine: (row: T) => ChangeLine;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/**
 * A "History" button opening a read-only list of who entered or changed what
 * and when, from the school's audit log. The list loads when the panel opens.
 */
export function ChangeHistory<T>(props: ChangeHistoryProps<T>) {
  return (
    <Drawer
      title={props.title}
      description={props.description}
      trigger={
        <Button type="button" variant="secondary" size="sm" icon={<History />}>
          History
        </Button>
      }
    >
      <HistoryList {...props} />
    </Drawer>
  );
}

function HistoryList<T>({ path, toLine }: ChangeHistoryProps<T>) {
  const { data, error, reload } = useApi<{ history: T[] }>(path);
  if (error) return <ErrorState message={error} onRetry={reload} compact />;
  if (!data) return <SkeletonRows rows={6} columns={2} />;
  const lines = data.history.map(toLine);
  if (!lines.length)
    return <EmptyState compact icon={<History />} title="Nothing recorded yet" description="Entries and changes appear here once they are saved." />;
  const changes = lines.filter((l) => l.changed).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">
        {changes ? `${changes} change${changes === 1 ? "" : "s"} after the first entry.` : "No changes since the first entry."}
      </p>
      <ol className="divide-y divide-border rounded-lg border border-border">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-fg">{l.studentName || "Former student"}</span>
              <Badge tone={l.changed ? "warning" : "neutral"}>{l.label}</Badge>
            </div>
            <div className="tabular-nums text-fg-secondary">
              {l.from !== null ? (
                <>
                  <span className="line-through decoration-fg-muted">{l.from}</span> to <span className="font-medium text-fg">{l.to}</span>
                </>
              ) : (
                <span className="font-medium text-fg">{l.to}</span>
              )}
              {l.context && <span className="text-fg-muted"> · {l.context}</span>}
            </div>
            {l.reason && <div className="text-[13px] text-fg-secondary">Reason: {l.reason}</div>}
            <div className="text-xs text-fg-muted">
              {l.by}, {when(l.at)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
