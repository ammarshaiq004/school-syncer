"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarCheck, ChartColumn, FileText } from "lucide-react";
import {
  Card,
  CardHeader,
  CalendarHeatmap,
  DataTable,
  DonutChart,
  EmptyState,
  ErrorState,
  Input,
  SkeletonRows,
  StatusPill,
  type Column,
} from "@/components/ui";
import { day, thisMonth } from "@/lib/format";
import { useApi } from "@/lib/use-api";

/** All-time attendance counts by status, as returned on the student profile. */
export type AttendanceSummary = Record<string, number>;

const TONE: Record<string, "success" | "warning" | "danger" | "info"> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "danger",
  LEAVE: "info",
};

export function attendanceRate(att: AttendanceSummary) {
  const marked = Object.values(att).reduce((a, b) => a + b, 0);
  const present = (att.PRESENT ?? 0) + (att.LATE ?? 0);
  return { marked, present, rate: marked ? Math.round((present / marked) * 100) : null };
}

/** All-time donut plus a month calendar of marks. */
export function StudentAttendance({ studentId, summary }: { studentId: string; summary: AttendanceSummary }) {
  const [month, setMonth] = useState(thisMonth());
  const records = useApi<{ status: string; note: string | null; session: { date: string } }[]>(
    month ? `/attendance/students/${studentId}?month=${month}` : null,
  );
  const { marked, rate } = attendanceRate(summary);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const counts = (records.data ?? []).reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader title="All time" description="Every day marked since admission." icon={<ChartColumn />} />
        {marked ? (
          <DonutChart
            label="Attendance since admission"
            centerValue={`${rate}%`}
            centerLabel="present"
            data={[
              { label: "Present", value: summary.PRESENT ?? 0, color: "var(--success)" },
              { label: "Late", value: summary.LATE ?? 0, color: "var(--warning)" },
              { label: "Absent", value: summary.ABSENT ?? 0, color: "var(--danger)" },
              { label: "Leave", value: summary.LEAVE ?? 0, color: "var(--info)" },
            ]}
          />
        ) : (
          <EmptyState icon={<CalendarCheck />} title="No attendance marked yet" compact />
        )}
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader
          title="Month view"
          description="Present, late, absent and leave days for the month."
          icon={<CalendarCheck />}
          action={
            <Input
              type="month"
              aria-label="Month"
              value={month}
              max={thisMonth()}
              onChange={(e) => setMonth(e.target.value)}
              className="h-8 w-40"
            />
          }
        />
        {records.error ? (
          <ErrorState message={records.error} onRetry={records.reload} compact />
        ) : !records.data ? (
          <SkeletonRows rows={3} columns={3} />
        ) : records.data.length === 0 ? (
          <EmptyState icon={<CalendarCheck />} title="Nothing marked this month" description="Pick another month to see earlier records." compact />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="overflow-x-auto">
              <CalendarHeatmap
                label={`Attendance for ${month}`}
                from={`${month}-01`}
                to={`${month}-${String(lastDay).padStart(2, "0")}`}
                cellSize={18}
                days={records.data.map((r) => ({
                  date: r.session.date.slice(0, 10),
                  tone: TONE[r.status] ?? "neutral",
                  title: `${day(r.session.date)}: ${r.status.toLowerCase()}${r.note ? ` (${r.note})` : ""}`,
                }))}
                legend={[
                  { label: "Present", color: "var(--success)" },
                  { label: "Late", color: "var(--warning)" },
                  { label: "Absent", color: "var(--danger)" },
                  { label: "Leave", color: "var(--info)" },
                ]}
              />
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["PRESENT", "LATE", "ABSENT", "LEAVE"] as const).map((s) => (
                <div key={s} className="rounded-lg bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-fg-muted">{s.charAt(0) + s.slice(1).toLowerCase()}</dt>
                  <dd className="font-display text-lg font-semibold tabular-nums text-fg">{counts[s] ?? 0}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Card>
    </div>
  );
}

interface ExamRow {
  id: string;
  name: string;
  status: string;
  startsOn: string | null;
  academicYear: { name: string };
}

/** Exams of the school with a link to this student's report card once results are published. */
export function StudentExams({ studentId }: { studentId: string }) {
  const exams = useApi<ExamRow[]>("/exams");
  const columns: Column<ExamRow>[] = [
    { id: "name", header: "Exam", sortValue: (e) => e.name, cell: (e) => <span className="font-medium text-fg">{e.name}</span> },
    { id: "year", header: "Year", cell: (e) => e.academicYear.name, hideBelow: "sm" },
    { id: "starts", header: "Starts", sortValue: (e) => e.startsOn ?? "", cell: (e) => (e.startsOn ? day(e.startsOn) : "–"), hideBelow: "md" },
    { id: "status", header: "Results", cell: (e) => <StatusPill status={e.status} label={e.status === "PUBLISHED" ? "Published" : "Not published"} /> },
    {
      id: "card",
      header: <span className="sr-only">Report card</span>,
      align: "right",
      cell: (e) =>
        e.status === "PUBLISHED" ? (
          <Link href={`/exams/${e.id}/report-cards/${studentId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <FileText className="size-4" aria-hidden />
            Report card
          </Link>
        ) : null,
    },
  ];
  return (
    <DataTable
      label="Exams"
      columns={columns}
      data={exams.data}
      getRowId={(e) => e.id}
      error={exams.error}
      onRetry={exams.reload}
      pageSize={10}
      empty={{ title: "No exams yet", description: "Report cards appear here once the school publishes exam results." }}
    />
  );
}
