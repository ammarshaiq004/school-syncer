"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  CalendarCheck,
  ClipboardCheck,
  GraduationCap,
  Layers,
  Megaphone,
  Plus,
  Receipt,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import {
  Avatar,
  BarChart,
  Badge,
  buttonClass,
  Card,
  CardHeader,
  DataTable,
  DonutChart,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  ProgressBar,
  Skeleton,
  Sparkline,
  StatGrid,
  StatusPill,
  type Column,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { fullName, rupees } from "@/lib/format";
import { allNavItems } from "@/lib/nav";
import { FEES, hasRole, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import {
  compactRupees,
  firstName,
  greeting,
  longDate,
  NoticeBoard,
  QuickActions,
  relativeTime,
  SectionState,
  ViewAll,
  type Notice,
  type QuickAction,
} from "./shared";

interface DayAttendance {
  date: string;
  present: number;
  late: number;
  absent: number;
  leave: number;
  marked: number;
  rate: number;
}
interface RecentPayment {
  id: string;
  amount: number;
  method: string;
  receiptNo: string;
  receivedAt: string;
  invoiceId: string;
  period: string;
  invoiceStatus: string;
  student: { id: string; firstName: string; lastName: string | null; admissionNo: string };
}
interface UpcomingExam {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
}
export interface Summary {
  students: number;
  newStudentsThisMonth?: number;
  staff?: number;
  teachers?: number;
  attendanceToday: { marked: number; present: number; absent: number; leave: number; late?: number };
  attendanceWeek?: DayAttendance[];
  feesThisMonth: {
    period: string;
    invoices: number;
    billed: number;
    collected: number;
    outstanding?: number;
    collectedToday: number;
  };
  overdue?: { invoices: number; amount: number };
  collectionTrend?: { period: string; billed: number; collected: number }[];
  recentPayments?: RecentPayment[];
  upcomingExams?: UpcomingExam[];
  announcements?: Notice[];
  studentsByClass?: { id: string; name: string; students: number }[];
  admissions: Record<string, number>;
}
interface School {
  name: string;
  slug: string;
  city: string | null;
}

const STAGES = ["ENQUIRY", "TEST_SCHEDULED", "TEST_DONE", "INTERVIEW", "OFFERED", "ADMITTED"];

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const weekdayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const monthYear = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function AdminDashboard() {
  const user = useSession();
  const school = useApi<School>("/school");
  const summary = useApi<Summary>("/dashboard/summary");
  const s = summary.data;
  const loading = !s && !summary.error;
  const now = new Date();

  const reachable = new Set(allNavItems(user).map((i) => i.href));
  const canFees = hasRole(user, FEES) && reachable.has("/fees");

  const t = s?.attendanceToday;
  const attendanceRate = t ? pct(t.present, t.marked) : null;
  const week = s?.attendanceWeek ?? [];
  const todayIso = now.toLocaleDateString("en-CA");
  const previousDay = [...week].reverse().find((d) => d.date < todayIso);
  const attendanceDelta =
    attendanceRate !== null && previousDay ? Math.round((attendanceRate - previousDay.rate) * 10) / 10 : undefined;
  const fees = s?.feesThisMonth;
  const collectionRate = fees ? pct(fees.collected, fees.billed) : null;
  const trend = s?.collectionTrend ?? [];

  const quickActions: QuickAction[] = (
    [
      { href: "/students", label: "Add student", description: "Enrol a new pupil", icon: <Plus /> },
      { href: "/attendance", label: "Take attendance", description: "Mark today's register", icon: <CalendarCheck /> },
      { href: "/fees", label: "Collect fees", description: "Record a payment", icon: <Receipt /> },
      { href: "/announcements", label: "Post a notice", description: "Message parents and staff", icon: <Megaphone /> },
      { href: "/admissions", label: "New enquiry", description: "Log an admission enquiry", icon: <UserPlus /> },
      { href: "/exams", label: "Enter marks", description: "Exams and results", icon: <ClipboardCheck /> },
    ] satisfies QuickAction[]
  )
    .filter((a) => reachable.has(a.href))
    .slice(0, 6);

  const paymentColumns: Column<RecentPayment>[] = [
    {
      id: "student",
      header: "Student",
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={fullName(p.student)} size="xs" />
          <span className="min-w-0">
            <Link href={`/fees/invoices/${p.invoiceId}`} className="block truncate font-medium text-fg hover:text-brand">
              {fullName(p.student)}
            </Link>
            <span className="block text-xs text-fg-muted">{p.student.admissionNo}</span>
          </span>
        </span>
      ),
    },
    { id: "receipt", header: "Receipt", cell: (p) => <span className="tabular-nums text-fg-secondary">{p.receiptNo}</span>, hideBelow: "md" },
    { id: "method", header: "Method", cell: (p) => <Badge tone="neutral">{p.method === "CASH" ? "Cash" : p.method.charAt(0) + p.method.slice(1).toLowerCase().replace(/_/g, " ")}</Badge>, hideBelow: "lg" },
    { id: "when", header: "Received", cell: (p) => <time dateTime={p.receivedAt} className="text-fg-secondary">{relativeTime(p.receivedAt)}</time>, hideBelow: "sm" },
    { id: "amount", header: "Amount", align: "right", cell: (p) => <span className="font-medium text-fg">{rupees(p.amount)}</span> },
    { id: "status", header: "Invoice", cell: (p) => <StatusPill status={p.invoiceStatus} /> },
  ];

  const byClass = s?.studentsByClass;
  const maxClass = Math.max(1, ...(byClass ?? []).map((c) => c.students));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting(now)}, ${firstName(user.name)}`}
        description={
          <>
            {longDate(now)}
            {school.data ? ` · ${school.data.name}` : ""}
          </>
        }
        meta={
          school.data && (
            <>
              <Badge tone="neutral">
                School code <span className="ms-1 font-semibold text-fg">{school.data.slug}</span>
              </Badge>
              {school.data.city && <Badge tone="neutral">{school.data.city}</Badge>}
              <span className="text-[13px] text-fg-muted">
                Online admission form:{" "}
                <Link className="font-medium text-brand hover:underline" href={`/apply/${school.data.slug}`}>
                  /apply/{school.data.slug}
                </Link>
              </span>
            </>
          )
        }
        actions={
          <>
            {reachable.has("/attendance") && (
              <Link href="/attendance" className={buttonClass("secondary")}>
                <CalendarCheck aria-hidden />
                Take attendance
              </Link>
            )}
            {reachable.has("/students") && (
              <Link href="/students" className={buttonClass("primary")}>
                <Plus aria-hidden />
                Add student
              </Link>
            )}
          </>
        }
      />

      <StatGrid>
        <KpiCard
          label="Active students"
          value={s?.students.toLocaleString("en-PK") ?? ""}
          icon={<GraduationCap />}
          href="/students"
          loading={loading}
          error={!s && !!summary.error}
          delta={s?.newStudentsThisMonth ? { value: s.newStudentsThisMonth, unit: "", label: "new this month" } : undefined}
          hint={s && !s.newStudentsThisMonth ? "No new admissions this month" : undefined}
        />
        <KpiCard
          label="Staff"
          value={s?.staff?.toLocaleString("en-PK") ?? ""}
          icon={<BriefcaseBusiness />}
          tone="info"
          href={reachable.has("/users") ? "/users" : undefined}
          loading={loading}
          error={!s && !!summary.error}
          hint={s?.teachers !== undefined ? `${s.teachers} teaching staff` : undefined}
        />
        <KpiCard
          label="Attendance today"
          value={attendanceRate === null ? "Not taken" : `${attendanceRate}%`}
          icon={<CalendarCheck />}
          tone="success"
          href="/attendance"
          loading={loading}
          error={!s && !!summary.error}
          delta={attendanceDelta !== undefined ? { value: attendanceDelta, unit: " pts", label: "vs last school day" } : undefined}
          hint={t && t.marked ? `${t.absent} absent of ${t.marked}` : t ? "No registers yet today" : undefined}
          sparkline={week.length > 1 ? <Sparkline data={week.map((d) => d.rate)} color="var(--success)" label="Attendance rate, last school days" /> : undefined}
        />
        {canFees ? (
          <KpiCard
            label={fees ? `Fees collected, ${monthLabel(fees.period)}` : "Fees collected"}
            value={fees ? compactRupees(fees.collected) : ""}
            icon={<Wallet />}
            tone="warning"
            href="/fees"
            loading={loading}
            error={!s && !!summary.error}
            hint={fees ? `${collectionRate ?? 0}% of ${compactRupees(fees.billed)} billed` : undefined}
            sparkline={trend.length > 1 ? <Sparkline data={trend.map((m) => m.collected)} label="Fees collected, last 6 months" /> : undefined}
          />
        ) : (
          <KpiCard
            label="Classes running"
            value={byClass?.length.toLocaleString("en-PK") ?? ""}
            icon={<Layers />}
            tone="warning"
            loading={loading}
            error={!s && !!summary.error}
            hint="With students enrolled this year"
          />
        )}
      </StatGrid>

      {summary.error && !s ? (
        <Card padding="none">
          <ErrorState title="Could not load the dashboard" message={summary.error} onRetry={summary.reload} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-flow-row-dense lg:grid-cols-3">
          {/* Attendance */}
          <Card className="lg:col-span-2">
            <CardHeader
              title="Attendance"
              description="Today and the last school days"
              icon={<CalendarCheck />}
              action={<ViewAll href="/attendance" label="Open registers" />}
            />
            {!s ? (
              <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
                <Skeleton className="mx-auto size-40 rounded-full" />
                <Skeleton className="h-52 w-full" />
              </div>
            ) : (
              <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,200px)_1fr]">
                {t && t.marked > 0 ? (
                  <DonutChart
                    label="Attendance today"
                    size={152}
                    centerValue={`${attendanceRate}%`}
                    centerLabel="present"
                    data={[
                      { label: "Present", value: t.present - (t.late ?? 0), color: "var(--success)" },
                      { label: "Late", value: t.late ?? 0, color: "var(--warning)" },
                      { label: "Absent", value: t.absent, color: "var(--danger)" },
                      { label: "Leave", value: t.leave, color: "var(--info)" },
                    ]}
                  />
                ) : (
                  <EmptyState
                    icon={<CalendarCheck />}
                    title="No registers yet today"
                    description="Today's split shows once teachers mark attendance."
                    compact
                  />
                )}
                {week.length > 0 ? (
                  <BarChart
                    label="Attendance by day, last school days"
                    stacked
                    height={210}
                    categories={week.map((d) => weekdayLabel(d.date))}
                    series={[
                      { name: "Present", values: week.map((d) => d.present), color: "var(--success)" },
                      { name: "Late", values: week.map((d) => d.late), color: "var(--warning)" },
                      { name: "Absent", values: week.map((d) => d.absent), color: "var(--danger)" },
                      { name: "Leave", values: week.map((d) => d.leave), color: "var(--info)" },
                    ]}
                  />
                ) : (
                  <EmptyState title="No attendance this week" description="Daily bars appear after the first registers are saved." compact />
                )}
              </div>
            )}
          </Card>

          <NoticeBoard
            notices={s ? (s.announcements ?? []) : null}
            error={summary.error}
            onRetry={summary.reload}
            canPost={reachable.has("/announcements") && hasRole(user, ["OWNER", "PRINCIPAL", "ADMIN"])}
          />

          {/* Fees */}
          {canFees && (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Fee collection"
                description={fees ? `${monthYear(fees.period)} and the five months before` : "Billed and collected by month"}
                icon={<Wallet />}
                action={<ViewAll href="/fees" label="Open fees" />}
              />
              {!s || !fees ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-12" />
                    ))}
                  </div>
                  <Skeleton className="h-52 w-full" />
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    <FeeStat label="Collected" value={rupees(fees.collected)} tone="text-success-text" />
                    <FeeStat label="Outstanding" value={rupees(fees.outstanding ?? Math.max(0, fees.billed - fees.collected))} />
                    <FeeStat
                      label="Overdue"
                      value={rupees(s.overdue?.amount ?? 0)}
                      note={s.overdue ? `${s.overdue.invoices} ${s.overdue.invoices === 1 ? "invoice" : "invoices"}` : undefined}
                      tone={s.overdue?.amount ? "text-danger-text" : undefined}
                    />
                    <FeeStat label="Collected today" value={rupees(fees.collectedToday)} />
                  </dl>
                  <ProgressBar
                    label={`${fees.invoices} ${fees.invoices === 1 ? "invoice" : "invoices"} this month`}
                    value={fees.collected}
                    max={fees.billed || 1}
                    valueText={fees.billed ? `${collectionRate}% collected` : "Nothing billed yet"}
                    tone="success"
                  />
                  {trend.some((m) => m.billed > 0 || m.collected > 0) ? (
                    <BarChart
                      label="Fees billed and collected by month"
                      height={220}
                      categories={trend.map((m) => monthLabel(m.period))}
                      formatValue={compactRupees}
                      series={[
                        { name: "Billed", values: trend.map((m) => m.billed), color: "var(--chart-6)" },
                        { name: "Collected", values: trend.map((m) => m.collected), color: "var(--chart-1)" },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={<Wallet />}
                      title="No invoices in the last six months"
                      description="Generate monthly invoices to start tracking collection."
                      compact
                    />
                  )}
                </div>
              )}
            </Card>
          )}

          <QuickActions actions={quickActions} />

          {/* Recent payments */}
          {canFees && (
            <Card padding="none" className="flex flex-col lg:col-span-2">
              <div className="px-5 pt-5 sm:px-6 sm:pt-6">
                <CardHeader
                  title="Recent payments"
                  description="The last five receipts"
                  icon={<Receipt />}
                  action={<ViewAll href="/fees" />}
                />
              </div>
              <DataTable
                label="Recent payments"
                bare
                dense
                pageSize={0}
                skeletonRows={5}
                columns={paymentColumns}
                data={s ? (s.recentPayments ?? []) : null}
                error={summary.error}
                onRetry={summary.reload}
                getRowId={(p) => p.id}
                empty={{ title: "No payments yet", description: "Payments recorded at the counter or online will show here." }}
              />
            </Card>
          )}

          {/* Upcoming exams */}
          {reachable.has("/exams") && (
            <Card>
              <CardHeader title="Upcoming exams" description="Scheduled and in progress" icon={<ClipboardCheck />} action={<ViewAll href="/exams" />} />
              <SectionState
                data={s ? (s.upcomingExams ?? []) : null}
                error={summary.error}
                onRetry={summary.reload}
                rows={3}
                empty={{ title: "No exams scheduled", description: "Exams with dates ahead show here.", icon: <ClipboardCheck /> }}
              >
                {(list) => (
                  <ul className="-my-2 divide-y divide-border">
                    {list.map((e) => (
                      <li key={e.id}>
                        <Link
                          href={`/exams/${e.id}`}
                          className="flex items-center gap-3 rounded-lg py-3 hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <DateBlock iso={e.startsOn} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">{e.name}</span>
                            <span className="block text-xs text-fg-muted">
                              {e.startsOn ? shortDate(e.startsOn) : "Date to be set"}
                              {e.endsOn && e.endsOn !== e.startsOn ? ` to ${shortDate(e.endsOn)}` : ""}
                            </span>
                          </span>
                          <StatusPill status={e.status} label={e.status === "PUBLISHED" ? "Results out" : "Upcoming"} tone={e.status === "PUBLISHED" ? "success" : "info"} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionState>
            </Card>
          )}

          {/* Admissions pipeline */}
          {reachable.has("/admissions") && (
            <Card className="lg:col-span-2">
              <CardHeader title="Admissions pipeline" description="Applications at each stage" icon={<UserPlus />} action={<ViewAll href="/admissions" />} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {STAGES.map((stage) => (
                  <Link
                    key={stage}
                    href="/admissions"
                    className="rounded-lg border border-border bg-surface-2 p-3 transition-colors duration-150 hover:border-border-strong hover:bg-surface-3 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="text-xs text-fg-muted">{stage.charAt(0) + stage.slice(1).toLowerCase().replace(/_/g, " ")}</div>
                    {s ? (
                      <div className="mt-1 font-display text-xl font-semibold tabular-nums text-fg">{s.admissions[stage] ?? 0}</div>
                    ) : (
                      <Skeleton className="mt-1.5 h-6 w-10" />
                    )}
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* Students by class */}
          <Card>
            <CardHeader title="Students by class" description="Active enrolments this year" icon={<Users />} action={<ViewAll href="/students" />} />
            <SectionState
              data={s ? (byClass ?? []) : null}
              error={summary.error}
              onRetry={summary.reload}
              empty={{
                title: "No enrolments yet",
                description: "Add classes and enrol students to see the split.",
                icon: <Users />,
              }}
            >
              {(list) => (
                <ul className={cn("flex flex-col gap-3", list.length > 8 && "max-h-80 overflow-y-auto pe-1")}>
                  {list.map((c) => (
                    <li key={c.id}>
                      <ProgressBar label={c.name} value={c.students} max={maxClass} valueText={c.students.toLocaleString("en-PK")} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </SectionState>
          </Card>
        </div>
      )}
    </div>
  );
}

function FeeStat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-display text-base font-semibold tabular-nums text-fg", tone)}>{value}</dd>
      {note && <dd className="text-xs text-fg-muted">{note}</dd>}
    </div>
  );
}

function DateBlock({ iso }: { iso: string | null }) {
  const d = iso ? new Date(iso) : null;
  return (
    <span className="grid w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 py-1 text-center" aria-hidden>
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">
        {d ? d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) : "TBC"}
      </span>
      <span className="font-display text-base leading-tight font-semibold tabular-nums text-fg">
        {d ? d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" }) : "-"}
      </span>
    </span>
  );
}
