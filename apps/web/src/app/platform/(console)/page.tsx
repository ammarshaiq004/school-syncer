"use client";

import Link from "next/link";
import { ArrowRight, Building, CircleAlert, Hourglass, Receipt, Wallet } from "lucide-react";
import {
  Alert,
  BarChart,
  Card,
  CardFooter,
  CardHeader,
  DataTable,
  DonutChart,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  Skeleton,
  StatGrid,
  StatusPill,
  buttonClass,
  type Column,
} from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { monthName, statusColor, statusLabel, STATUSES, StatusBadge } from "./status";

interface Overview {
  schools: number;
  byStatus: Record<string, number>;
  students: number;
  mrr: number;
  unpaid: { amount: number; count: number };
  trialsEnding: { schoolId: string; name: string; trialEndsAt: string; expired: boolean }[];
  signups: { month: string; count: number }[];
}

type Trial = Overview["trialsEnding"][number];

const num = (n: number) => n.toLocaleString("en-PK");

function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

const trialColumns: Column<Trial>[] = [
  {
    id: "school",
    header: "School",
    sortValue: (t) => t.name,
    cell: (t) => (
      <Link href={`/platform/schools/${t.schoolId}`} className="font-medium text-fg hover:text-brand">
        {t.name}
      </Link>
    ),
  },
  { id: "ends", header: "Trial ends", sortValue: (t) => t.trialEndsAt, cell: (t) => day(t.trialEndsAt) },
  {
    id: "state",
    header: "State",
    cell: (t) => {
      if (t.expired) return <StatusPill status="ENDED" tone="warning" label="Ended, now read-only" />;
      const left = daysLeft(t.trialEndsAt);
      return <StatusPill status="TRIAL" tone="info" label={left <= 0 ? "Ends today" : `${left} ${left === 1 ? "day" : "days"} left`} />;
    },
  },
];

/** The last six YYYY-MM months, oldest first, ending with this month (UTC, like the API). */
function lastSixMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)).toISOString().slice(0, 7));
}

export default function OverviewPage() {
  const { data, error, reload } = usePlatformApi<Overview>("/overview");
  const loading = !data && !error;
  const by = (s: string) => data?.byStatus[s] ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Revenue, subscriptions and new schools across SchoolSyncer."
        actions={
          <>
            <Link href="/platform/invoices" className={buttonClass("secondary")}>
              <Receipt aria-hidden />
              Bills
            </Link>
            <Link href="/platform/schools" className={buttonClass("primary")}>
              <Building aria-hidden />
              All schools
            </Link>
          </>
        }
      />

      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          <StatGrid>
            <KpiCard
              label="Monthly recurring revenue"
              value={data ? rupees(data.mrr) : ""}
              icon={<Wallet />}
              hint={data ? `${num(data.students)} students on SchoolSyncer` : undefined}
              loading={loading}
            />
            <KpiCard
              label="Active schools"
              value={num(by("ACTIVE"))}
              icon={<Building />}
              tone="success"
              hint={data ? `of ${num(data.schools)} schools in total` : undefined}
              href="/platform/schools?status=ACTIVE"
              loading={loading}
            />
            <KpiCard
              label="On trial"
              value={num(by("TRIAL"))}
              icon={<Hourglass />}
              tone="info"
              hint={data ? `${data.trialsEnding.length} ending this week or ended` : undefined}
              href="/platform/schools?status=TRIAL"
              loading={loading}
            />
            <KpiCard
              label="Past due"
              value={num(by("PAST_DUE"))}
              icon={<CircleAlert />}
              tone="warning"
              hint={data ? `${num(by("SUSPENDED"))} suspended` : undefined}
              href="/platform/schools?status=PAST_DUE"
              loading={loading}
            />
          </StatGrid>

          {data && data.unpaid.count > 0 && (
            <Alert
              tone="warning"
              title={`${rupees(data.unpaid.amount)} unpaid`}
              action={
                <Link href="/platform/invoices?status=UNPAID" className={buttonClass("secondary", "sm")}>
                  Review bills
                </Link>
              }
            >
              {data.unpaid.count} {data.unpaid.count === 1 ? "bill is" : "bills are"} waiting for payment.
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Sign-ups" description="New schools over the last six months" />
              {!data ? (
                <Skeleton className="h-[220px] w-full" />
              ) : data.signups.length === 0 ? (
                <EmptyState title="No new schools" description="Schools that sign up in the last six months show here." compact />
              ) : (
                <BarChart
                  label="New schools per month"
                  categories={lastSixMonths().map(monthName)}
                  series={[{ name: "New schools", values: lastSixMonths().map((m) => data.signups.find((s) => s.month === m)?.count ?? 0) }]}
                  showLegend={false}
                />
              )}
            </Card>

            <Card>
              <CardHeader title="Schools by status" description="Every school with a subscription" />
              {!data ? (
                <div className="flex flex-col items-center gap-4">
                  <Skeleton className="size-40 rounded-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : data.schools === 0 ? (
                <EmptyState title="No schools yet" description="Schools appear here once they sign up." compact />
              ) : (
                <>
                  <DonutChart
                    label="Schools by subscription status"
                    centerValue={num(data.schools)}
                    centerLabel="schools"
                    showLegend={false}
                    data={STATUSES.map((s) => ({ label: statusLabel(s), value: by(s), color: statusColor(s) }))}
                  />
                  <ul className="mt-4 divide-y divide-border">
                    {STATUSES.map((s) => (
                      <li key={s}>
                        <Link
                          href={`/platform/schools?status=${s}`}
                          className="flex h-10 items-center justify-between gap-3 rounded-md px-1 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                        >
                          <StatusBadge status={s} />
                          <span className="font-medium tabular-nums text-fg">{num(by(s))}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <Card padding="none">
            <div className="px-5 pt-5">
              <CardHeader title="Trials ending" description="Trials that end this week or have already ended" />
            </div>
            <DataTable
              bare
              label="Trials ending"
              columns={trialColumns}
              data={data?.trialsEnding}
              getRowId={(t) => t.schoolId}
              error={error}
              onRetry={reload}
              pageSize={0}
              skeletonRows={3}
              defaultSort={{ id: "ends", dir: "asc" }}
              empty={{ title: "No trials ending", description: "No school's trial ends in the next seven days." }}
            />
            <CardFooter className="mx-5 mb-4">
              <Link href="/platform/schools?status=TRIAL" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                Every school on trial
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}
