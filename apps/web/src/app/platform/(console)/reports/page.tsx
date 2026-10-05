"use client";

import Link from "next/link";
import { Building, ChartColumn, Download, Percent, RefreshCw, Users, Wallet } from "lucide-react";
import {
  AreaChart,
  BarChart,
  Button,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  DonutChart,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  Skeleton,
  StatGrid,
  StatusPill,
  type Column,
} from "@/components/ui";
import { RISK_LABELS, type PlatformReports } from "@/components/platform/reports";
import { when } from "@/components/platform/session";
import { downloadCsv } from "@/lib/csv";
import { rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { monthName, statusColor, statusLabel, STATUSES, StatusBadge } from "../status";

type Risk = PlatformReports["churnRisk"][number];
type PlanRow = PlatformReports["schoolsByPlan"][number];

const num = (n: number) => n.toLocaleString("en-PK");

const riskColumns: Column<Risk>[] = [
  {
    id: "school",
    header: "School",
    sortValue: (r) => r.name,
    cell: (r) => (
      <Link href={`/platform/schools/${r.schoolId}`} className="font-medium text-fg hover:text-brand">
        {r.name}
      </Link>
    ),
  },
  { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} />, hideBelow: "sm" },
  {
    id: "reason",
    header: "Risk",
    sortValue: (r) => r.reason,
    cell: (r) => <StatusPill status={r.reason} tone={RISK_LABELS[r.reason].tone} label={RISK_LABELS[r.reason].label} />,
  },
  { id: "detail", header: "Detail", cell: (r) => <span className="text-fg-secondary">{r.detail}</span>, hideBelow: "md" },
];

const planColumns: Column<PlanRow>[] = [
  { id: "plan", header: "Plan", sortValue: (p) => p.planName, cell: (p) => <span className="font-medium text-fg">{p.planName}</span> },
  { id: "schools", header: "Schools", align: "right", sortValue: (p) => p.schools, cell: (p) => num(p.schools) },
  { id: "mrr", header: "Monthly revenue", align: "right", sortValue: (p) => p.mrr, cell: (p) => rupees(p.mrr) },
];

/** Platform-wide revenue, growth and churn risk. */
export default function ReportsPage() {
  const { data, error, reload } = usePlatformApi<PlatformReports>("/reports");
  const loading = !data && !error;

  function exportRevenue() {
    if (!data) return;
    downloadCsv(
      `schoolsyncer-revenue-${data.revenueByMonth.at(-1)?.month ?? "report"}.csv`,
      ["Month", "Revenue collected (PKR)", "New schools"],
      data.revenueByMonth.map((r, i) => [r.month, r.amount, data.newSchoolsByMonth[i]?.count ?? 0]),
    );
  }

  const conversion = data?.trialConversion;
  const totalRevenue = data?.revenueByMonth.reduce((a, r) => a + r.amount, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description={data ? `Revenue, growth and churn risk. Updated ${when(data.generatedAt)}.` : "Revenue, growth and churn risk across SchoolSyncer."}
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw />} onClick={() => void reload()}>
              Refresh
            </Button>
            <Button icon={<Download />} onClick={exportRevenue} disabled={!data}>
              Export revenue CSV
            </Button>
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
              hint="Active and past-due schools this month"
              loading={loading}
            />
            <KpiCard
              label="Collected, last 12 months"
              value={data ? rupees(totalRevenue) : ""}
              icon={<ChartColumn />}
              tone="success"
              hint="Paid bills by payment date"
              loading={loading}
            />
            <KpiCard
              label="Schools"
              value={data ? num(data.schools) : ""}
              icon={<Building />}
              tone="info"
              hint={data ? `${num(data.students)} active students` : undefined}
              loading={loading}
            />
            <KpiCard
              label="Trial conversion"
              value={conversion ? (conversion.rate == null ? "No data" : `${conversion.rate}%`) : ""}
              icon={<Percent />}
              tone="neutral"
              hint={conversion ? `${num(conversion.converted)} converted, ${num(conversion.lost)} lost` : undefined}
              loading={loading}
            />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Revenue collected" description="Paid SchoolSyncer bills per month, last 12 months" />
              {!data ? (
                <Skeleton className="h-[240px] w-full" />
              ) : totalRevenue === 0 ? (
                <EmptyState icon={<Wallet />} title="No payments yet" description="Payments recorded on the Bills page show here." compact />
              ) : (
                <AreaChart
                  label="Revenue collected per month in rupees"
                  categories={data.revenueByMonth.map((r) => monthName(r.month))}
                  series={[{ name: "Revenue collected", values: data.revenueByMonth.map((r) => r.amount) }]}
                  formatValue={rupees}
                  height={240}
                />
              )}
            </Card>

            <Card>
              <CardHeader title="Schools by status" description="Every school with a subscription" />
              {!data ? (
                <Skeleton className="mx-auto size-40 rounded-full" />
              ) : data.schools === 0 ? (
                <EmptyState title="No schools yet" compact />
              ) : (
                <DonutChart
                  label="Schools by subscription status"
                  centerValue={num(data.schools)}
                  centerLabel="schools"
                  data={STATUSES.map((s) => ({ label: statusLabel(s), value: data.schoolsByStatus[s] ?? 0, color: statusColor(s) }))}
                />
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="New schools" description="Sign-ups per month, last 12 months" />
              {!data ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <BarChart
                  label="New schools per month"
                  categories={data.newSchoolsByMonth.map((r) => monthName(r.month))}
                  series={[{ name: "New schools", values: data.newSchoolsByMonth.map((r) => r.count) }]}
                  showLegend={false}
                />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Trials"
                description="Schools that started on a free trial. Trials past their end date count as lost, even while their status still says Trial."
                icon={<Users />}
              />
              {!conversion ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <DescriptionList
                  columns={1}
                  items={[
                    { label: "Converted to a paid plan", value: num(conversion.converted) },
                    { label: "Lost after the trial", value: num(conversion.lost) },
                    { label: "Still on trial", value: num(conversion.inTrial) },
                    { label: "Conversion rate", value: conversion.rate == null ? "Not enough finished trials yet" : `${conversion.rate}%` },
                  ]}
                />
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card padding="none" className="lg:col-span-2">
              <div className="px-5 pt-5">
                <CardHeader title="Churn risk" description="Overdue bills, trials ending within 7 days, no sign-ins for 14 days and falling student counts" />
              </div>
              <DataTable
                bare
                label="Churn risk"
                columns={riskColumns}
                data={data?.churnRisk}
                getRowId={(r) => `${r.schoolId}-${r.reason}`}
                error={error}
                onRetry={reload}
                pageSize={10}
                skeletonRows={4}
                empty={{ title: "No schools at risk", description: "Every school is paying, active and signing in." }}
              />
            </Card>

            <Card padding="none">
              <div className="px-5 pt-5">
                <CardHeader title="Schools by plan" />
              </div>
              <DataTable
                bare
                label="Schools by plan"
                columns={planColumns}
                data={data?.schoolsByPlan}
                getRowId={(p) => p.planCode}
                error={error}
                onRetry={reload}
                pageSize={0}
                skeletonRows={3}
                empty={{ title: "No subscriptions yet" }}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
