"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, Bug, CalendarCheck, MessageCircle, ReceiptText, Wallet } from "lucide-react";
import { DateRange } from "@/components/date-range";
import { BarChart, Card, CardHeader, DataTable, EmptyState, ErrorState, KpiCard, SkeletonCards, StatGrid, StatusPill, type Column } from "@/components/ui";
import { day, rupees, todayIso } from "@/lib/format";
import { PROBLEM_STATUS_LABEL, PROBLEM_STATUS_TONE, type ProblemStatus } from "@/lib/problem-reports";
import { usePlatformApi } from "@/lib/use-api";
import { when } from "./session";

interface SectionCoverage {
  sectionId: string;
  name: string;
  days: number;
  missed: number;
  lastMarked: string | null;
}

export interface PilotHealth {
  from: string;
  to: string;
  school: { id: string; name: string; slug: string };
  activeUsers: { roles: string[]; days: { date: string; total: number; byRole: Record<string, number> }[]; averagePerActiveDay: number };
  attendance: { schoolDays: number; sections: SectionCoverage[] };
  vouchers: { generated: number; voided: number; runs: number };
  payments: { recorded: number; amount: number; reversed: number };
  messages: { QUEUED: number; SENT: number; LOGGED: number; FAILED: number; total: number };
  problemReports: {
    open: number;
    inRange: number;
    latestOpen: { id: string; message: string; page: string; status: ProblemStatus; reporterName: string; createdAt: string }[];
  };
  lastActivity: { at: string | null; signIn: string | null; appUse: string | null; attendance: string | null; payment: string | null; voucher: string | null };
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  PRINCIPAL: "Principal",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  TEACHER: "Teacher",
  CLASS_TEACHER: "Class teacher",
  STAFF: "Staff",
  PARENT: "Parent",
  STUDENT: "Student",
};

const coverageColumns: Column<SectionCoverage>[] = [
  { id: "name", header: "Section", sortValue: (s) => s.name, cell: (s) => <span className="font-medium text-fg">{s.name}</span> },
  { id: "days", header: "Days marked", align: "right", sortValue: (s) => s.days, cell: (s) => s.days },
  {
    id: "missed",
    header: "School days missed",
    align: "right",
    sortValue: (s) => s.missed,
    cell: (s) => <span className={s.missed > 0 ? "font-medium text-danger-text" : "text-fg-secondary"}>{s.missed}</span>,
  },
  { id: "last", header: "Last marked", align: "right", sortValue: (s) => s.lastMarked ?? "", cell: (s) => (s.lastMarked ? day(s.lastMarked) : "Never"), hideBelow: "sm" },
];

/**
 * Pilot health (SCHOOL-150): how much one school used SchoolSyncer over a date
 * range, so a pilot month that has quietly stopped shows up early.
 */
export function PilotHealthPanel({ schoolId }: { schoolId: string }) {
  const [range, setRange] = useState({ from: `${todayIso().slice(0, 7)}-01`, to: todayIso() });
  const health = usePlatformApi<PilotHealth>(`/schools/${schoolId}/pilot-health?from=${range.from}&to=${range.to}`);
  const h = health.data;
  return (
    <div className="flex flex-col gap-6">
      <DateRange from={range.from} to={range.to} onChange={setRange} />
      {health.error ? (
        <Card padding="none">
          <ErrorState message={health.error} onRetry={health.reload} />
        </Card>
      ) : !h ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          <StatGrid cols={4}>
            <KpiCard
              label="Last activity"
              value={h.lastActivity.at ? day(h.lastActivity.at) : "Never"}
              icon={<Activity />}
              tone={h.lastActivity.at ? "success" : "danger"}
              hint={h.lastActivity.signIn ? `Last sign-in ${when(h.lastActivity.signIn)}` : "Nobody has signed in"}
            />
            <KpiCard
              label="Active users a day"
              value={h.activeUsers.averagePerActiveDay.toLocaleString("en-PK")}
              icon={<Activity />}
              tone="info"
              hint={`${h.activeUsers.days.filter((d) => d.total > 0).length} of ${h.activeUsers.days.length} days used`}
            />
            <KpiCard
              label="Vouchers and payments"
              value={`${h.vouchers.generated} / ${h.payments.recorded}`}
              icon={<ReceiptText />}
              hint={`${rupees(h.payments.amount)} recorded${h.payments.reversed ? `, ${h.payments.reversed} reversed` : ""}${h.vouchers.voided ? `, ${h.vouchers.voided} vouchers voided` : ""}`}
            />
            <KpiCard
              label="Open problem reports"
              value={h.problemReports.open.toLocaleString("en-PK")}
              icon={<Bug />}
              tone={h.problemReports.open ? "warning" : "success"}
              hint={`${h.problemReports.inRange} sent in these dates`}
              href={`/platform/problem-reports?schoolId=${schoolId}`}
            />
          </StatGrid>

          <Card>
            <CardHeader title="Daily active users" description="People who used the app each day, by role. Someone with two roles counts under both." />
            {h.activeUsers.roles.length === 0 ? (
              <EmptyState compact icon={<Activity />} title="Nobody used the app in these dates" />
            ) : (
              <BarChart
                label="Daily active users by role"
                stacked
                categories={h.activeUsers.days.map((d) => day(d.date).replace(/ \d{4}$/, ""))}
                series={h.activeUsers.roles.map((role) => ({ name: ROLE_LABEL[role] ?? role, values: h.activeUsers.days.map((d) => d.byRole[role] ?? 0) }))}
              />
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2" padding="none">
              <div className="px-5 pt-5">
                <CardHeader
                  icon={<CalendarCheck />}
                  title="Attendance taken"
                  description={`${h.attendance.schoolDays} school days (days any register was taken). Sections that missed a day come first.`}
                />
              </div>
              <DataTable
                bare
                label="Days attendance was marked per section"
                columns={coverageColumns}
                data={h.attendance.sections}
                getRowId={(s) => s.sectionId}
                defaultSort={{ id: "missed", dir: "desc" }}
                pageSize={10}
                empty={{ icon: <CalendarCheck />, title: "No sections this year" }}
              />
            </Card>
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader icon={<MessageCircle />} title="Messages" description={`${h.messages.total} in these dates`} />
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  {(
                    [
                      ["Sent", h.messages.SENT, "text-success-text"],
                      ["Logged only", h.messages.LOGGED, "text-fg"],
                      ["Failed", h.messages.FAILED, h.messages.FAILED ? "text-danger-text" : "text-fg"],
                      ["Waiting", h.messages.QUEUED, "text-fg"],
                    ] as const
                  ).map(([label, n, tone]) => (
                    <div key={label} className="contents">
                      <dt className="text-fg-muted">{label}</dt>
                      <dd className={`text-right font-medium tabular-nums ${tone}`}>{n.toLocaleString("en-PK")}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card>
                <CardHeader icon={<Wallet />} title="Last used" />
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                  {(
                    [
                      ["Signed in", h.lastActivity.signIn],
                      ["Attendance", h.lastActivity.attendance],
                      ["Payment", h.lastActivity.payment],
                      ["Voucher", h.lastActivity.voucher],
                    ] as const
                  ).map(([label, at]) => (
                    <div key={label} className="contents">
                      <dt className="text-fg-muted">{label}</dt>
                      <dd className="text-right text-fg-secondary">{at ? when(at) : "Never"}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader
              icon={<Bug />}
              title="Open problem reports"
              action={
                <Link href={`/platform/problem-reports?schoolId=${schoolId}`} className="text-sm font-medium text-brand hover:underline">
                  Open the inbox
                </Link>
              }
            />
            {h.problemReports.latestOpen.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing open.</p>
            ) : (
              <ul className="divide-y divide-border">
                {h.problemReports.latestOpen.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm text-fg">{r.message}</span>
                      <span className="block text-xs text-fg-muted">
                        {r.reporterName} · {when(r.createdAt)} · <span className="font-mono">{r.page}</span>
                      </span>
                    </span>
                    <StatusPill status={r.status} tone={PROBLEM_STATUS_TONE[r.status]} label={PROBLEM_STATUS_LABEL[r.status]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
