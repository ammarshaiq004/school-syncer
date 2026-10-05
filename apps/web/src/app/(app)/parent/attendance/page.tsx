"use client";

import { useMemo } from "react";
import { CalendarCheck, CalendarX, Clock, NotebookPen, Percent, Plane, Users } from "lucide-react";
import {
  Avatar,
  CalendarHeatmap,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  ProgressBar,
  SegmentedControl,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type Column,
} from "@/components/ui";
import { monthLabel } from "@/components/attendance/status";
import { cn } from "@/lib/cn";
import { day, todayIso } from "@/lib/format";
import { usePersistedState } from "@/lib/persisted";
import { useApi } from "@/lib/use-api";

type Status = "PRESENT" | "ABSENT" | "LATE" | "LEAVE";

interface ChildSummary {
  id: string;
  name: string;
  class: string | null;
}

interface MonthRow {
  month: string;
  present: number;
  absent: number;
  late: number;
  leave: number;
  total: number;
  rate: number | null;
}

interface ChildAttendance {
  student: { id: string; name: string; admissionNo: string; photoUrl: string | null; className: string | null };
  from: string;
  to: string;
  days: { date: string; status: Status; note: string | null }[];
  summary: { present: number; absent: number; late: number; leave: number; total: number; rate: number | null };
  months: MonthRow[];
}

const TONE = { PRESENT: "success", LATE: "warning", ABSENT: "danger", LEAVE: "info" } as const;
const LABEL: Record<Status, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "Leave" };
const LEGEND = [
  { label: "Present", color: "var(--success)" },
  { label: "Late", color: "var(--warning)" },
  { label: "Absent", color: "var(--danger)" },
  { label: "Leave", color: "var(--info)" },
];

type Range = "3" | "6" | "12";
const RANGE_DAYS: Record<Range, number> = { "3": 91, "6": 182, "12": 365 };
const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

/** YYYY-MM-DD shifted back by n days. */
function daysBefore(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const rateText = (rate: number | null) => (rate == null ? "No data" : `${rate}%`);
const rateTone = (rate: number | null) => (rate == null ? "neutral" : rate >= 90 ? "success" : rate >= 75 ? "warning" : "danger");

/** Parent Dashboard: one child's attendance history (heatmap, monthly table and rate). */
export default function ParentAttendancePage() {
  const children = useApi<ChildSummary[]>("/parent/children");
  const [savedId, setSavedId] = usePersistedState<string>("schoolsyncer.parent.child", "");
  const [range, setRange] = usePersistedState<string>("schoolsyncer.parent.attendance.range", "6");
  const list = children.data;
  const child = list?.find((c) => c.id === savedId) ?? list?.[0];
  const rangeValue: Range = range === "3" || range === "12" ? range : "6";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance history"
        description="Days present, late, absent and on leave, month by month."
        breadcrumbs={[{ label: "Parent Dashboard", href: "/parent" }, { label: "Attendance history" }]}
        actions={
          <SegmentedControl<Range>
            aria-label="Period to show"
            value={rangeValue}
            onChange={(r) => setRange(r)}
            options={RANGE_OPTIONS}
          />
        }
      />

      {children.error ? (
        <Card padding="none">
          <ErrorState message={children.error} onRetry={children.reload} />
        </Card>
      ) : !list ? (
        <>
          <SkeletonCards count={4} />
          <Card>
            <SkeletonRows rows={5} />
          </Card>
        </>
      ) : list.length === 0 || !child ? (
        <Card padding="none">
          <EmptyState
            icon={<Users />}
            title="No children linked yet"
            description="No children are linked to your number yet. Please contact the school office."
          />
        </Card>
      ) : (
        <>
          {list.length > 1 && <ChildSwitcher list={list} selected={child.id} onSelect={setSavedId} />}
          <ChildHistory key={`${child.id}:${rangeValue}`} childId={child.id} childName={child.name} range={rangeValue} />
        </>
      )}
    </div>
  );
}

function ChildSwitcher({ list, selected, onSelect }: { list: ChildSummary[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Choose a child" className="flex flex-wrap gap-2 pb-1 sm:flex-nowrap sm:overflow-x-auto sm:[scrollbar-width:none]">
      {list.map((c) => {
        const active = c.id === selected;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-full border py-1.5 pe-4 ps-1.5 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
              active ? "border-primary bg-primary-tint shadow-card" : "border-border bg-surface hover:border-border-strong",
            )}
          >
            <Avatar name={c.name} size="md" />
            <span className="min-w-0">
              <span className={cn("block text-sm font-medium", active ? "text-brand" : "text-fg")}>{c.name}</span>
              <span className="block text-xs text-fg-muted">{c.class ?? "Not enrolled"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChildHistory({ childId, childName, range }: { childId: string; childName: string; range: Range }) {
  const to = todayIso();
  const from = daysBefore(to, RANGE_DAYS[range] - 1);
  const res = useApi<ChildAttendance>(`/parent/children/${childId}/attendance?from=${from}&to=${to}`);
  const d = res.data;

  const notes = useMemo(() => (d ? d.days.filter((x) => x.status !== "PRESENT" || x.note).reverse() : []), [d]);
  const months = useMemo(() => (d ? [...d.months].reverse() : null), [d]);

  const columns: Column<MonthRow>[] = [
    { id: "month", header: "Month", sortValue: (r) => r.month, cell: (r) => <span className="font-medium text-fg">{monthLabel(r.month)}</span> },
    { id: "present", header: "Present", align: "right", sortValue: (r) => r.present, cell: (r) => r.present },
    { id: "late", header: "Late", align: "right", sortValue: (r) => r.late, cell: (r) => r.late, hideBelow: "sm" },
    { id: "absent", header: "Absent", align: "right", sortValue: (r) => r.absent, cell: (r) => r.absent },
    { id: "leave", header: "Leave", align: "right", sortValue: (r) => r.leave, cell: (r) => r.leave },
    { id: "total", header: "Days marked", align: "right", sortValue: (r) => r.total, cell: (r) => r.total, hideBelow: "md" },
    {
      id: "rate",
      header: "Rate",
      width: "180px",
      sortValue: (r) => r.rate ?? -1,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="hidden w-20 sm:block" aria-hidden>
            <ProgressBar value={r.rate ?? 0} tone={rateTone(r.rate)} size="sm" />
          </div>
          <span className="tabular-nums font-medium text-fg">{rateText(r.rate)}</span>
        </div>
      ),
    },
  ];

  if (res.error && !d) {
    return (
      <Card padding="none">
        <ErrorState message={res.error} onRetry={res.reload} />
      </Card>
    );
  }

  const s = d?.summary;
  return (
    <>
      <StatGrid>
        <KpiCard
          label="Attendance rate"
          icon={<Percent />}
          loading={!s}
          tone={rateTone(s?.rate ?? null)}
          value={s ? rateText(s.rate) : ""}
          hint={s?.total ? `${s.present + s.late} of ${s.total} days attended` : "No days marked in this period"}
        />
        <KpiCard label="Present" icon={<CalendarCheck />} tone="success" loading={!s} value={s?.present ?? ""} />
        <KpiCard label="Late" icon={<Clock />} tone="warning" loading={!s} value={s?.late ?? ""} hint="Counts as attended" />
        <KpiCard
          label="Absent or on leave"
          icon={<CalendarX />}
          tone="danger"
          loading={!s}
          value={s ? s.absent + s.leave : ""}
          hint={s ? `${s.absent} absent, ${s.leave} leave` : undefined}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title={`${childName}'s attendance`}
            description={d ? `${day(d.from)} to ${day(d.to)}. Tap or hover a day for details.` : "Each square is one day."}
            icon={<CalendarCheck />}
          />
          {!d ? (
            <SkeletonRows rows={4} columns={3} />
          ) : d.days.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="No attendance marked yet" description="Try a longer period, or check back after the next school day." compact />
          ) : (
            <CalendarHeatmap
              label={`Attendance for ${childName}`}
              from={d.from}
              to={d.to}
              cellSize={range === "3" ? 18 : 14}
              days={d.days.map((x) => ({
                date: x.date,
                tone: TONE[x.status],
                title: `${day(x.date)}: ${LABEL[x.status]}${x.note ? ` (${x.note})` : ""}`,
              }))}
              legend={LEGEND}
            />
          )}
        </Card>

        <Card className="self-start">
          <CardHeader title="Days to note" description="Late, absent and leave days, with teacher notes." icon={<Plane />} />
          {!d ? (
            <SkeletonRows rows={4} columns={2} />
          ) : notes.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck />}
              title={d.days.length ? "Present every day" : "Nothing to show"}
              description={d.days.length ? `${childName} has not missed a day in this period.` : undefined}
              compact
            />
          ) : (
            <ul className="-my-2 flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
              {notes.map((x) => (
                <li key={x.date} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium tabular-nums text-fg">{day(x.date)}</div>
                    {x.note && (
                      <div className="flex items-start gap-1.5 text-[13px] text-fg-muted">
                        <NotebookPen className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {x.note}
                      </div>
                    )}
                  </div>
                  <StatusPill status={x.status} label={LABEL[x.status]} tone={TONE[x.status]} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <DataTable
        label={`Monthly attendance for ${childName}`}
        columns={columns}
        data={months}
        getRowId={(r) => r.month}
        pageSize={0}
        defaultSort={{ id: "month", dir: "desc" }}
        empty={{ icon: <CalendarCheck />, title: "No months to show", description: "Attendance will appear here once the class register is taken." }}
      />
    </>
  );
}
