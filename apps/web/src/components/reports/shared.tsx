"use client";

import type { ReactNode } from "react";
import { Card, ErrorState, KpiCard, ProgressBar, Skeleton, SkeletonRows, StatGrid, type Tone } from "@/components/ui";
import { rupees } from "@/lib/format";

export interface Total { name: string; total: number }

/** Short rupee figures for chart axes: Rs 950, Rs 12k, Rs 1.4M. */
export function shortRupees(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `Rs ${Math.round(n / 1_000)}k`;
  return `Rs ${n}`;
}


/** Loading, error and empty handling for a report body. */
export function ReportBody<T>({
  report,
  kpis = 3,
  children,
}: {
  report: { data: T | null; error: string; reload: () => Promise<void> };
  kpis?: 2 | 3 | 4 | 5;
  children: (data: T) => ReactNode;
}) {
  if (report.error)
    return (
      <Card padding="none">
        <ErrorState message={report.error} onRetry={report.reload} />
      </Card>
    );
  if (!report.data)
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading report">
        <StatGrid cols={kpis}>
          {Array.from({ length: kpis }, (_, i) => (
            <KpiCard key={i} label="Loading" value="" loading />
          ))}
        </StatGrid>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-4 h-44 w-full" />
          </Card>
          <Card>
            <SkeletonRows rows={5} columns={2} />
          </Card>
        </div>
      </div>
    );
  return <div className="flex flex-col gap-6">{children(report.data)}</div>;
}

/** A ranked list of totals with proportional bars. */
export function Totals({ rows, tone, empty }: { rows: Total[]; tone: Tone; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-fg-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.name}>
          <ProgressBar label={<span className="truncate text-fg">{r.name}</span>} valueText={rupees(r.total)} value={r.total} max={max} tone={tone} size="sm" />
        </li>
      ))}
    </ul>
  );
}

