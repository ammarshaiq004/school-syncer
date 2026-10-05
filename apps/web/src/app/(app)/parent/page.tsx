"use client";

import Link from "next/link";
import {
  BookOpen,
  Bus,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  Library,
  NotebookPen,
  Phone,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import {
  Avatar,
  buttonClass,
  Card,
  CardHeader,
  DonutChart,
  EmptyState,
  ErrorState,
  KpiCard,
  LetterGrade,
  PageHeader,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { day, rupees } from "@/lib/format";
import { usePersistedState } from "@/lib/persisted";
import { ChildLearning } from "@/components/student-learning/parent-learning";
import { useSchoolMode, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Child {
  id: string;
  name: string;
  relation: string;
  admissionNo: string;
  class: string | null;
  attendanceThisMonth: { present: number; absent: number; leave: number; absentDates: string[] };
  homework: { id: string; subject: string; title: string; details: string | null; dueDate: string }[];
  results: { examId: string; exam: string; percent: number; grade: string; position: number; passed: boolean }[];
  unpaidInvoices: { id: string; voucherNo: string; period: string; dueDate: string; balance: number }[];
  libraryBooks?: { title: string; dueOn: string; returned: boolean; overdue: boolean; fine: number }[];
  transport: {
    route: string;
    stop: string | null;
    pickupTime: string | null;
    dropTime: string | null;
    vehicle: string | null;
    driverName: string | null;
    driverPhone: string | null;
  } | null;
}

const attendancePercent = (a: Child["attendanceThisMonth"]) => {
  const total = a.present + a.absent + a.leave;
  return total ? Math.round((a.present / total) * 1000) / 10 : null;
};
const feesDue = (c: Child) => c.unpaidInvoices.reduce((n, i) => n + i.balance, 0);

/** Parent Dashboard: a switcher across the parent's children and an overview of the chosen one. */
export default function ParentPage() {
  const children = useApi<Child[]>("/parent/children");
  const [savedId, setSavedId] = usePersistedState<string>("schoolsyncer.parent.child", "");
  const list = children.data;
  const child = list?.find((c) => c.id === savedId) ?? list?.[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My children"
        description="Attendance, homework, results, fees and the school van, all in one place."
        breadcrumbs={[{ label: "Parent Dashboard" }, { label: "My children" }]}
      />

      {children.error ? (
        <Card padding="none">
          <ErrorState message={children.error} onRetry={children.reload} />
        </Card>
      ) : !list ? (
        <>
          <div className="flex gap-3">
            <SkeletonRows rows={1} columns={3} className="w-full max-w-md" />
          </div>
          <SkeletonCards count={4} />
          <Card>
            <SkeletonRows rows={4} />
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
          <ChildOverview key={child.id} child={child} />
        </>
      )}
    </div>
  );
}

function ChildSwitcher({ list, selected, onSelect }: { list: Child[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Choose a child" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {list.map((c) => {
        const active = c.id === selected;
        const due = c.unpaidInvoices.length > 0;
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
              <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                {c.class ?? "Not enrolled"}
                {due && (
                  <>
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                    <span className="text-warning-text">Fees due</span>
                  </>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChildOverview({ child: c }: { child: Child }) {
  const att = c.attendanceThisMonth;
  const pct = attendancePercent(att);
  const due = feesDue(c);
  const latest = c.results[0];
  const booksOut = (c.libraryBooks ?? []).filter((b) => !b.returned);
  const overdueBooks = booksOut.filter((b) => b.overdue).length;
  // Hide the van and library parts when the school's plan has no such module (unless there is data anyway).
  const features = useSession().plan?.features;
  const mode = useSchoolMode();
  const showLearning = mode !== "PHYSICAL" && mode !== null && features?.includes("elearning") !== false;
  // Online schools have no van or library, so those parts are hidden (unless there is data anyway).
  const online = mode === "ONLINE";
  const showTransport = !!c.transport || (!online && features?.includes("transport") !== false);
  const showLibrary = (c.libraryBooks?.length ?? 0) > 0 || (!online && features?.includes("library") !== false);
  const kpiCols = (3 + Number(showTransport) + Number(showLibrary)) as 3 | 4 | 5;

  return (
    <div className="flex animate-rise flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={c.name} size="lg" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-fg">{c.name}</h2>
              <p className="text-[13px] text-fg-muted">
                {c.class ?? "Not enrolled"}, admission no. {c.admissionNo}
                {c.relation ? `, your ${c.relation.toLowerCase()}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {due > 0 ? <StatusPill status="DUE" label="Fees due" /> : <StatusPill status="PAID" label="Fees clear" />}
            {c.class && (
              <Link href={`/parent/timetable/${c.id}`} className={buttonClass("secondary", "sm")}>
                <CalendarDays aria-hidden />
                Timetable
              </Link>
            )}
          </div>
        </div>
      </Card>

      <StatGrid cols={kpiCols}>
        <KpiCard
          label="Attendance this month"
          value={pct === null ? "No records" : `${pct}%`}
          icon={<CalendarCheck />}
          tone={pct === null ? "neutral" : pct >= 90 ? "success" : pct >= 75 ? "warning" : "danger"}
          hint={`${att.present} present, ${att.absent} absent, ${att.leave} leave`}
        />
        <KpiCard
          label="Fees outstanding"
          value={due ? rupees(due) : "Rs 0"}
          icon={<Wallet />}
          tone={due ? "warning" : "success"}
          hint={due ? `${c.unpaidInvoices.length} unpaid voucher${c.unpaidInvoices.length === 1 ? "" : "s"}` : "All fees paid"}
        />
        <KpiCard
          label="Latest result"
          value={latest ? `${latest.percent}%` : "None yet"}
          icon={<Trophy />}
          tone={!latest ? "neutral" : latest.passed ? "primary" : "danger"}
          hint={latest ? `${latest.exam}, grade ${latest.grade}, position ${latest.position}` : "Published results appear here"}
          href={latest ? `/parent/results/${latest.examId}/${c.id}` : undefined}
        />
        {showTransport && (
        <KpiCard
          label="School van"
          value={c.transport ? c.transport.route : "Not using"}
          icon={<Bus />}
          tone={c.transport ? "info" : "neutral"}
          hint={c.transport?.pickupTime ? `Pickup ${c.transport.pickupTime}` : c.transport?.stop ?? "No route assigned"}
        />
        )}
        {showLibrary && (
        <KpiCard
          label="Library books"
          value={booksOut.length}
          icon={<Library />}
          tone={overdueBooks ? "danger" : "primary"}
          hint={overdueBooks ? `${overdueBooks} overdue` : booksOut.length ? "None overdue" : "Nothing borrowed"}
        />
        )}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<CalendarCheck />} title="Attendance" description="This month so far" />
          {att.present + att.absent + att.leave === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="No attendance marked yet" description="Days appear here once the class teacher marks them." compact />
          ) : (
            <>
              <DonutChart
                label={`${c.name} attendance this month`}
                size={140}
                centerValue={pct === null ? "" : `${pct}%`}
                centerLabel="present"
                data={[
                  { label: "Present", value: att.present, color: "var(--success)" },
                  { label: "Absent", value: att.absent, color: "var(--danger)" },
                  { label: "Leave", value: att.leave, color: "var(--info)" },
                ]}
              />
              {att.absentDates.length > 0 && (
                <p className="mt-4 text-[13px] text-fg-secondary">
                  <span className="font-medium text-fg">Absent on </span>
                  {att.absentDates.map((d) => day(d)).join(", ")}
                </p>
              )}
            </>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader icon={<NotebookPen />} title="Homework" description="Due from yesterday onwards" />
          {c.homework.length === 0 ? (
            <EmptyState icon={<NotebookPen />} title="No homework right now" description="New homework from teachers shows up here." compact />
          ) : (
            <ul className="divide-y divide-border">
              {c.homework.map((h) => (
                <li key={h.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
                    <BookOpen className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="text-sm text-fg">
                        <span className="font-medium">{h.subject}:</span> {h.title}
                      </p>
                      <span className="text-xs tabular-nums text-fg-muted">Due {day(h.dueDate)}</span>
                    </div>
                    {h.details && <p className="mt-0.5 text-[13px] text-fg-muted">{h.details}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<GraduationCap />} title="Results" description="Published exam results" />
          {c.results.length === 0 ? (
            <EmptyState icon={<GraduationCap />} title="No results published yet" description="Report cards appear here once the school publishes them." compact />
          ) : (
            <ul className="divide-y divide-border">
              {c.results.map((r) => (
                <li key={r.examId}>
                  <Link
                    href={`/parent/results/${r.examId}/${c.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                  >
                    <LetterGrade grade={r.grade} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{r.exam}</span>
                      <span className="text-xs text-fg-muted">Position {r.position}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-fg">{r.percent}%</span>
                    {!r.passed && <StatusPill status="FAILED" label="Not passed" />}
                    <ChevronRight className="size-4 text-fg-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader icon={<Wallet />} title="Unpaid fees" description={due ? `${rupees(due)} outstanding` : undefined} />
          {c.unpaidInvoices.length === 0 ? (
            <EmptyState icon={<Wallet />} title="All fees paid" description="Thank you. There are no unpaid vouchers." compact />
          ) : (
            <ul className="divide-y divide-border">
              {c.unpaidInvoices.map((i) => {
                const late = new Date(i.dueDate) < new Date();
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">{i.period}</span>
                      <span className="text-xs text-fg-muted">
                        Voucher {i.voucherNo}, due {day(i.dueDate)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusPill status={late ? "OVERDUE" : "DUE"} />
                      <span className="text-sm font-semibold tabular-nums text-fg">{rupees(i.balance)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {showTransport && (
        <Card>
          <CardHeader icon={<Bus />} title="School van" />
          {!c.transport ? (
            <EmptyState icon={<Bus />} title="Not on a van route" description="Contact the school office to arrange pick and drop." compact />
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="font-medium text-fg">{c.transport.route}</p>
                {c.transport.stop && <p className="text-[13px] text-fg-muted">Stop: {c.transport.stop}</p>}
              </div>
              {(c.transport.pickupTime || c.transport.dropTime) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-surface-2 p-3">
                    <p className="text-xs text-fg-muted">Picked up</p>
                    <p className="font-semibold tabular-nums text-fg">{c.transport.pickupTime ?? "Not set"}</p>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <p className="text-xs text-fg-muted">Dropped</p>
                    <p className="font-semibold tabular-nums text-fg">{c.transport.dropTime ?? "Not set"}</p>
                  </div>
                </div>
              )}
              {c.transport.driverName && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={c.transport.driverName} size="sm" />
                    <span>
                      <span className="block font-medium text-fg">{c.transport.driverName}</span>
                      {c.transport.vehicle && <span className="text-xs text-fg-muted">{c.transport.vehicle}</span>}
                    </span>
                  </span>
                  {c.transport.driverPhone && (
                    <a className={buttonClass("secondary", "sm")} href={`tel:${c.transport.driverPhone}`} aria-label={`Call driver ${c.transport.driverName}`}>
                      <Phone aria-hidden />
                      {c.transport.driverPhone}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
        )}

        {showLibrary && (
        <Card>
          <CardHeader icon={<Library />} title="Library books" />
          {(c.libraryBooks?.length ?? 0) === 0 ? (
            <EmptyState icon={<Library />} title="No library books" description="Books borrowed from the school library show up here." compact />
          ) : (
            <ul className="divide-y divide-border">
              {c.libraryBooks!.map((b) => (
                <li key={`${b.title}-${b.dueOn}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 truncate text-sm text-fg">{b.title}</span>
                  {b.returned ? (
                    <span className="text-xs font-medium tabular-nums text-warning-text">Late fine {rupees(b.fine)}</span>
                  ) : b.overdue ? (
                    <StatusPill status="OVERDUE" label={`Overdue since ${day(b.dueOn)}`} />
                  ) : (
                    <span className="text-xs tabular-nums text-fg-muted">Due {day(b.dueOn)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        )}
      </div>

      {showLearning && <ChildLearning studentId={c.id} name={c.name} />}
    </div>
  );
}
