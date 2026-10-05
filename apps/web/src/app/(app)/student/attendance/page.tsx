"use client";

import { useState } from "react";
import { CalendarCheck, CalendarX, Clock, Percent, Plane } from "lucide-react";
import type { StudentAttendanceMonth } from "@/components/student/types";
import {
  CalendarHeatmap,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  KpiCard,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
} from "@/components/ui";
import { day, thisMonth } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const TONE = { PRESENT: "success", LATE: "warning", ABSENT: "danger", LEAVE: "info" } as const;
const LABEL = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "Leave" } as const;

const monthName = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export default function StudentAttendancePage() {
  const [month, setMonth] = useState(thisMonth());
  const att = useApi<StudentAttendanceMonth>(month ? `/student/attendance?month=${month}` : null);
  const d = att.data && att.data.month === month ? att.data : null;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const notes = d?.days.filter((x) => x.status !== "PRESENT" || x.note) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description="Your days present, late, absent and on leave."
        breadcrumbs={[{ label: "Learning" }, { label: "Attendance" }]}
        actions={
          <Input
            type="month"
            aria-label="Month"
            value={month}
            max={thisMonth()}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="w-44"
          />
        }
      />

      {att.error && !d ? (
        <ErrorState message={att.error} onRetry={att.reload} />
      ) : (
        <>
          <StatGrid>
            <KpiCard
              label="This year"
              icon={<Percent />}
              loading={!d}
              value={d?.year.total ? `${d.year.percent}%` : "–"}
              hint={d ? `${d.year.present + d.year.late} of ${d.year.total} days present` : undefined}
              tone={d && d.year.total && d.year.percent < 75 ? "danger" : "success"}
            />
            <KpiCard
              label={`Present in ${d ? monthName(d.month).split(" ")[0] : "month"}`}
              icon={<CalendarCheck />}
              tone="success"
              loading={!d}
              value={d ? d.summary.present : "–"}
              hint={d?.summary.total ? `${d.summary.percent}% of ${d.summary.total} school days` : "No days marked yet"}
            />
            <KpiCard label="Late" icon={<Clock />} tone="warning" loading={!d} value={d ? d.summary.late : "–"} />
            <KpiCard
              label="Absent or on leave"
              icon={<CalendarX />}
              tone="danger"
              loading={!d}
              value={d ? d.summary.absent + d.summary.leave : "–"}
              hint={d ? `${d.summary.absent} absent, ${d.summary.leave} leave` : undefined}
            />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title={monthName(month)} description="Each square is a school day. Hover or focus a day for details." icon={<CalendarCheck />} />
              {!d ? (
                <SkeletonRows rows={4} columns={3} />
              ) : d.days.length === 0 ? (
                <EmptyState icon={<CalendarCheck />} title="Nothing marked this month" description="Pick an earlier month to see past attendance." compact />
              ) : (
                <div className="overflow-x-auto">
                  <CalendarHeatmap
                    label={`Attendance for ${monthName(month)}`}
                    from={`${month}-01`}
                    to={`${month}-${String(lastDay).padStart(2, "0")}`}
                    cellSize={22}
                    days={d.days.map((x) => ({
                      date: x.date,
                      tone: TONE[x.status],
                      title: `${day(x.date)}: ${LABEL[x.status]}${x.note ? ` (${x.note})` : ""}`,
                    }))}
                    legend={[
                      { label: "Present", color: "var(--success)" },
                      { label: "Late", color: "var(--warning)" },
                      { label: "Absent", color: "var(--danger)" },
                      { label: "Leave", color: "var(--info)" },
                    ]}
                  />
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Days to note" description="Late, absent and leave days, and any teacher notes." icon={<Plane />} />
              {!d ? (
                <SkeletonRows rows={4} columns={2} />
              ) : notes.length === 0 ? (
                <EmptyState
                  icon={<CalendarCheck />}
                  title={d.days.length ? "Present every day" : "Nothing to show"}
                  description={d.days.length ? "Well done. Keep it up." : undefined}
                  compact
                />
              ) : (
                <ul className="-my-2 flex flex-col divide-y divide-border">
                  {notes.map((x) => (
                    <li key={x.date} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium tabular-nums text-fg">{day(x.date)}</div>
                        {x.note && <div className="text-[13px] text-fg-muted">{x.note}</div>}
                      </div>
                      <StatusPill status={x.status} label={LABEL[x.status]} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
