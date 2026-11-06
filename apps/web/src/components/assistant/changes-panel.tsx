"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { useApi } from "@/lib/use-api";

interface Metric {
  key: string;
  label: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
  trend: "up" | "down" | "same";
  tone: "good" | "bad" | "neutral";
  notable: boolean;
  unit: "count" | "percent" | "rupees";
}
interface Changes {
  current: { from: string; to: string };
  previous: { from: string; to: string };
  metrics: Metric[];
}

const show = (n: number, unit: Metric["unit"]) => (unit === "percent" ? `${n}%` : unit === "rupees" ? `Rs ${n.toLocaleString("en-PK")}` : n.toLocaleString("en-PK"));

/** The director's view: the last 90 days against the 90 before. Needs no AI key. */
export function ChangesPanel() {
  const changes = useApi<Changes>("/assistant/changes");
  const d = changes.data;
  if (changes.error)
    return (
      <Card padding="none">
        <ErrorState message={changes.error} onRetry={changes.reload} />
      </Card>
    );
  if (!d)
    return (
      <Card>
        <SkeletonRows rows={5} />
      </Card>
    );
  if (!d.metrics.length) return <Card><EmptyState title="Nothing to compare yet" description="Come back once the school has a few months of records." /></Card>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">
        {d.current.from} to {d.current.to}, compared with {d.previous.from} to {d.previous.to}.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {d.metrics.map((m) => {
          const Icon = m.trend === "down" ? TrendingDown : TrendingUp;
          return (
            <li key={m.key}>
              <Card className="flex h-full flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-fg-muted">{m.label}</p>
                  {m.notable && <Badge tone={m.tone === "bad" ? "danger" : "success"}>{m.tone === "bad" ? "Needs a look" : "Good news"}</Badge>}
                </div>
                <p className="text-2xl font-semibold tabular-nums">{show(m.current, m.unit)}</p>
                <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                  {m.trend !== "same" && <Icon className={`size-4 ${m.tone === "bad" ? "text-danger" : "text-success"}`} aria-hidden />}
                  {m.trend === "same" ? "No change" : `${m.change > 0 ? "+" : ""}${show(m.change, m.unit)}${m.changePercent === null ? "" : ` (${m.changePercent > 0 ? "+" : ""}${m.changePercent}%)`}`} from {show(m.previous, m.unit)}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
