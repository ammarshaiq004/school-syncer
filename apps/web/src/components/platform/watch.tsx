"use client";

import { Activity } from "lucide-react";
import {
  AreaChart,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import { day } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

export type HealthLabel = "healthy" | "watch" | "at_risk" | "new" | "no_data";

export interface Health {
  score: number | null;
  label: HealthLabel;
  reasons: string[];
}

/** GET /platform/school-health */
export type SchoolHealthRow = Health & {
  schoolId: string;
  name: string;
  slug: string;
  status: string;
};

/** GET /platform/schools/:id/usage */
export interface SchoolUsage {
  health: Health;
  snapshots: {
    day: string;
    students: number;
    staffActive7d: number;
    parentsActive7d: number;
    attendanceSessions: number;
    feesCollected: number;
    messagesSent: number;
    storageBytes: number;
    mrr: number;
  }[];
}

/** GET /platform/reports/history */
export type ReportHistory = {
  month: string;
  day: string;
  mrr: number;
  students: number;
  schools: number;
  payingAtStart: number;
  churned: number;
  /** Percent; null when nobody was paying at the start of the month or there is no earlier snapshot. */
  churnRate: number | null;
  nrr: number | null;
}[];

const HEALTH: Record<
  HealthLabel,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  healthy: { label: "Healthy", tone: "success" },
  watch: { label: "Watch", tone: "warning" },
  at_risk: { label: "At risk", tone: "danger" },
  new: { label: "New", tone: "neutral" },
  no_data: { label: "No data yet", tone: "neutral" },
};

export function HealthBadge({ health }: { health?: Health }) {
  if (!health) return <span className="text-fg-muted">–</span>;
  const h = HEALTH[health.label];
  return (
    <StatusPill
      status={health.label}
      tone={h.tone}
      label={health.score == null ? h.label : `${h.label} ${health.score}`}
    />
  );
}

const num = (n: number) => n.toLocaleString("en-PK");

/** A school's health score, why it lost points, and its last 90 days of daily snapshots. */
export function SchoolUsageCard({ schoolId }: { schoolId: string }) {
  const { data, error, reload } = usePlatformApi<SchoolUsage>(
    `/schools/${schoolId}/usage?days=90`,
  );
  const snaps = data?.snapshots ?? [];
  const categories = snaps.map((s) => day(s.day));
  return (
    <Card className="mb-6">
      <CardHeader
        title="Health and usage"
        description="Taken every night: students, staff signed in during the last 7 days, and the day's registers, fees and messages."
        icon={<Activity />}
        action={data && <HealthBadge health={data.health} />}
      />
      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton className="h-[200px] w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          {data.health.reasons.length > 0 && (
            <ul className="list-disc ps-5 text-sm text-fg-secondary">
              {data.health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {snaps.length < 2 ? (
            <EmptyState
              title="History is still building"
              description="A snapshot is taken each night, so the charts fill in after a couple of days."
              compact
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-medium text-fg">
                  Active students
                </p>
                <AreaChart
                  label="Active students over the last 90 days"
                  categories={categories}
                  series={[
                    { name: "Students", values: snaps.map((s) => s.students) },
                  ]}
                  formatValue={num}
                  showLegend={false}
                  height={180}
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-fg">
                  Staff signed in during the last 7 days
                </p>
                <AreaChart
                  label="Staff signed in over the last 90 days"
                  categories={categories}
                  series={[
                    {
                      name: "Staff",
                      values: snaps.map((s) => s.staffActive7d),
                    },
                  ]}
                  formatValue={num}
                  showLegend={false}
                  height={180}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
