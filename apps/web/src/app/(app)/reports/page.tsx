"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarCheck,
  ChartColumn,
  CircleAlert,
  Download,
  ReceiptText,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import { DateRange } from "@/components/date-range";
import {
  AreaChart,
  BarChart,
  Button,
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
  SkeletonRows,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  TextField,
  type Column,
  type Tone,
} from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "income" | "collection" | "outstanding" | "attendance";
interface Total { name: string; total: number }
type Range = { from: string; to: string };

const TAB_META: Record<Tab, { label: string; icon: ReactNode }> = {
  income: { label: "Income and expenditure", icon: <Scale /> },
  collection: { label: "Fee collection", icon: <Banknote /> },
  outstanding: { label: "Outstanding fees", icon: <Wallet /> },
  attendance: { label: "Attendance", icon: <CalendarCheck /> },
};

/** Short rupee figures for chart axes: Rs 950, Rs 12k, Rs 1.4M. */
function shortRupees(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `Rs ${Math.round(n / 1_000)}k`;
  return `Rs ${n}`;
}

/** Top slices for a donut, with the rest folded into "Other". */
function topSlices(rows: Total[], n = 5) {
  const sorted = [...rows].filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, n).map((r) => ({ label: r.name, value: r.total }));
  const rest = sorted.slice(n).reduce((s, r) => s + r.total, 0);
  return rest > 0 ? [...top, { label: "Other", value: rest, color: "var(--chart-6)" }] : top;
}

export default function ReportsPage() {
  const user = useSession();
  const tabs: Tab[] = [
    ...(hasRole(user, FEES) ? (["income", "collection", "outstanding"] as const) : []),
    ...(hasRole(user, SETUP) ? (["attendance"] as const) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [range, setRange] = useState({ from: `${todayIso().slice(0, 7)}-01`, to: todayIso() });
  const dated = tab === "income" || tab === "collection";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Money and attendance at a glance. Download any list for Excel."
        breadcrumbs={[{ label: "Finance" }, { label: "Reports" }]}
      />
      {tabs.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={<ChartColumn />} title="No reports for your role" description="Reports are available to fee and admin staff." />
        </Card>
      ) : (
        <Tabs
          tabs={tabs.map((t) => ({ value: t, ...TAB_META[t] }))}
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          aria-label="Reports"
        >
          {dated && <DateRange from={range.from} to={range.to} onChange={setRange} className="pt-5" />}
          <TabPanel value="income">
            <IncomeExpense range={range} />
          </TabPanel>
          <TabPanel value="collection">
            <FeeCollection range={range} />
          </TabPanel>
          <TabPanel value="outstanding">
            <Outstanding />
          </TabPanel>
          <TabPanel value="attendance">
            <AttendanceReport />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}

/** Loading, error and empty handling for a report body. */
function ReportBody<T>({
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
function Totals({ rows, tone, empty }: { rows: Total[]; tone: Tone; empty: string }) {
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

function IncomeExpense({ range }: { range: Range }) {
  const report = useApi<{ income: Total[]; expenses: Total[]; totalIncome: number; totalExpenses: number; surplus: number }>(
    `/reports/income-expense?from=${range.from}&to=${range.to}`,
  );
  return (
    <ReportBody report={report}>
      {(r) => (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Income" value={rupees(r.totalIncome)} icon={<ArrowDownLeft />} tone="success" />
            <KpiCard label="Expenditure" value={rupees(r.totalExpenses)} icon={<ArrowUpRight />} tone="danger" />
            <KpiCard
              label={r.surplus >= 0 ? "Surplus" : "Deficit"}
              value={<span className={r.surplus >= 0 ? "text-success-text" : "text-danger-text"}>{rupees(Math.abs(r.surplus))}</span>}
              icon={<Scale />}
              tone={r.surplus >= 0 ? "success" : "danger"}
              hint={r.totalIncome ? `${Math.round((r.surplus / r.totalIncome) * 1000) / 10}% of income` : undefined}
            />
          </StatGrid>
          <div className="grid gap-6 lg:grid-cols-2">
            {([
              ["Income", r.income, r.totalIncome, "success", "No income in these dates."],
              ["Expenditure", r.expenses, r.totalExpenses, "danger", "No spending in these dates."],
            ] as const).map(([title, rows, total, tone, empty]) => (
              <Card key={title}>
                <CardHeader title={title} description={`${rows.length} ${rows.length === 1 ? "head" : "heads"}`} />
                {rows.length > 0 && (
                  <div className="mb-6 flex justify-center">
                    <DonutChart
                      label={`${title} by head`}
                      data={topSlices([...rows])}
                      centerValue={shortRupees(total)}
                      centerLabel="total"
                      formatValue={rupees}
                    />
                  </div>
                )}
                <Totals rows={[...rows]} tone={tone} empty={empty} />
              </Card>
            ))}
          </div>
        </>
      )}
    </ReportBody>
  );
}

function FeeCollection({ range }: { range: Range }) {
  const report = useApi<{ total: number; receipts: number; byDay: Total[]; byMethod: Total[]; byClass: Total[] }>(
    `/reports/fee-collection?from=${range.from}&to=${range.to}`,
  );
  return (
    <ReportBody report={report}>
      {(r) => (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Collected" value={rupees(r.total)} icon={<Banknote />} tone="success" />
            <KpiCard label="Receipts" value={r.receipts.toLocaleString("en-PK")} icon={<ReceiptText />} />
            <KpiCard label="Average receipt" value={rupees(r.receipts ? Math.round(r.total / r.receipts) : 0)} icon={<Wallet />} tone="info" />
          </StatGrid>
          {r.receipts === 0 ? (
            <Card padding="none">
              <EmptyState icon={<Banknote />} title="No fees collected in these dates" description="Try a wider date range, or record payments from a fee voucher." />
            </Card>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader
                    title="Collected by day"
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Download />}
                        onClick={() => downloadCsv(`fee-collection-${range.from}-to-${range.to}.csv`, ["Date", "Collected"], r.byDay.map((d) => [d.name, d.total]))}
                      >
                        Download for Excel
                      </Button>
                    }
                  />
                  <AreaChart
                    label="Fees collected by day"
                    categories={r.byDay.map((d) => day(d.name).replace(/ \d{4}$/, ""))}
                    series={[{ name: "Collected", values: r.byDay.map((d) => d.total) }]}
                    formatValue={shortRupees}
                    showLegend={false}
                  />
                </Card>
                <Card>
                  <CardHeader title="By method" />
                  <div className="flex justify-center">
                    <DonutChart
                      label="Fees collected by payment method"
                      data={topSlices(r.byMethod.map((m) => ({ ...m, name: m.name.charAt(0) + m.name.slice(1).toLowerCase() })))}
                      centerValue={r.receipts.toLocaleString("en-PK")}
                      centerLabel="receipts"
                      formatValue={rupees}
                    />
                  </div>
                </Card>
              </div>
              <Card>
                <CardHeader title="By class" />
                <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                  <BarChart
                    label="Fees collected by class"
                    categories={r.byClass.map((c) => c.name)}
                    series={[{ name: "Collected", values: r.byClass.map((c) => c.total) }]}
                    formatValue={shortRupees}
                    showLegend={false}
                  />
                  <Totals rows={r.byClass} tone="primary" empty="No classes." />
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </ReportBody>
  );
}

interface OwingStudent { id: string; name: string; admissionNo: string; class: string; balance: number; invoices: number }

function Outstanding() {
  const report = useApi<{ total: number; byClass: Total[]; students: OwingStudent[] }>("/reports/outstanding");
  const columns: Column<OwingStudent>[] = [
    {
      id: "name",
      header: "Student",
      sortValue: (s) => s.name,
      cell: (s) => (
        <div>
          <div className="font-medium text-fg">{s.name}</div>
          <div className="text-xs text-fg-muted">{s.admissionNo}</div>
        </div>
      ),
    },
    { id: "class", header: "Class", sortValue: (s) => s.class, cell: (s) => s.class, hideBelow: "sm" },
    { id: "invoices", header: "Vouchers", align: "right", sortValue: (s) => s.invoices, cell: (s) => s.invoices },
    { id: "balance", header: "Balance", align: "right", sortValue: (s) => s.balance, cell: (s) => <span className="font-medium text-fg">{rupees(s.balance)}</span> },
  ];
  return (
    <ReportBody report={report}>
      {(r) => (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Outstanding" value={rupees(r.total)} icon={<Wallet />} tone="danger" />
            <KpiCard label="Students owing" value={r.students.length.toLocaleString("en-PK")} icon={<Users />} tone="warning" />
            <KpiCard
              label="Average per student"
              value={rupees(r.students.length ? Math.round(r.total / r.students.length) : 0)}
              icon={<CircleAlert />}
              tone="neutral"
            />
          </StatGrid>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card className="self-start">
              <CardHeader title="By class" />
              {r.byClass.length > 0 && (
                <BarChart
                  label="Outstanding fees by class"
                  categories={r.byClass.map((c) => c.name)}
                  series={[{ name: "Outstanding", values: r.byClass.map((c) => c.total), color: "var(--danger)" }]}
                  formatValue={shortRupees}
                  showLegend={false}
                  height={200}
                  className="mb-5"
                />
              )}
              <Totals rows={r.byClass} tone="danger" empty="Nothing is owed." />
            </Card>
            <DataTable
              label="Students with unpaid fees"
              columns={columns}
              data={r.students}
              getRowId={(s) => s.id}
              getSearchText={(s) => `${s.name} ${s.admissionNo} ${s.class}`}
              searchPlaceholder="Search student or class"
              defaultSort={{ id: "balance", dir: "desc" }}
              toolbarActions={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download />}
                  disabled={!r.students.length}
                  onClick={() => downloadCsv("outstanding-fees.csv", ["Admission no.", "Student", "Class", "Unpaid vouchers", "Balance"], r.students.map((s) => [s.admissionNo, s.name, s.class, s.invoices, s.balance]))}
                >
                  Download for Excel
                </Button>
              }
              empty={{ icon: <Wallet />, title: "Nobody owes fees", description: "Every voucher is paid up." }}
            />
          </div>
        </>
      )}
    </ReportBody>
  );
}

interface LowStudent { id: string; name: string; admissionNo: string; class: string; days: number; present: number; percent: number }

function AttendanceReport() {
  const [month, setMonth] = useState(thisMonth());
  const [threshold, setThreshold] = useState(75);
  const report = useApi<{
    sections: { sectionId: string; name: string; days: number; percent: number }[];
    lowAttendance: LowStudent[];
  }>(`/reports/attendance?month=${month}&threshold=${threshold}`);

  const columns: Column<LowStudent>[] = [
    {
      id: "name",
      header: "Student",
      sortValue: (s) => s.name,
      cell: (s) => (
        <div>
          <div className="font-medium text-fg">{s.name}</div>
          <div className="text-xs text-fg-muted">{s.admissionNo}</div>
        </div>
      ),
    },
    { id: "class", header: "Class", sortValue: (s) => s.class, cell: (s) => s.class, hideBelow: "sm" },
    { id: "present", header: "Present", align: "right", sortValue: (s) => s.present, cell: (s) => `${s.present}/${s.days}`, hideBelow: "md" },
    {
      id: "percent",
      header: "Attendance",
      align: "right",
      sortValue: (s) => s.percent,
      cell: (s) => <StatusPill status="ABSENT" tone={s.percent < threshold / 2 ? "danger" : "warning"} label={`${s.percent}%`} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} wrapperClassName="w-44" />
        <TextField
          label="Flag below %"
          type="number"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          wrapperClassName="w-32"
        />
      </div>
      <ReportBody report={report} kpis={3}>
        {(r) => {
          const avg = r.sections.length ? Math.round((r.sections.reduce((s, x) => s + x.percent, 0) / r.sections.length) * 10) / 10 : 0;
          return (
            <>
              <StatGrid cols={3}>
                <KpiCard label="Average attendance" value={r.sections.length ? `${avg}%` : "None"} icon={<CalendarCheck />} tone="success" hint="Across sections" />
                <KpiCard label="Sections reporting" value={r.sections.length.toLocaleString("en-PK")} icon={<Users />} />
                <KpiCard label={`Students below ${threshold}%`} value={r.lowAttendance.length.toLocaleString("en-PK")} icon={<CircleAlert />} tone="danger" />
              </StatGrid>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="self-start">
                  <CardHeader title="Sections" description="Share of students present on days attendance was taken." />
                  {r.sections.length === 0 ? (
                    <EmptyState icon={<CalendarCheck />} title="No attendance taken this month" compact />
                  ) : (
                    <>
                      <BarChart
                        label="Attendance by section"
                        categories={r.sections.map((s) => s.name)}
                        series={[{ name: "Present", values: r.sections.map((s) => s.percent), color: "var(--success)" }]}
                        yMax={100}
                        formatValue={(n) => `${n}%`}
                        showLegend={false}
                        height={200}
                      />
                      <ul className="mt-5 divide-y divide-border">
                        {r.sections.map((s) => (
                          <li key={s.sectionId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                            <span className="font-medium text-fg">{s.name}</span>
                            <span className="flex items-center gap-3">
                              <span className="text-xs text-fg-muted">{s.days} days</span>
                              <span className={`w-14 text-end font-medium tabular-nums ${s.percent < threshold ? "text-danger-text" : "text-fg"}`}>{s.percent}%</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Card>
                <DataTable
                  label={`Students below ${threshold}%`}
                  columns={columns}
                  data={r.lowAttendance}
                  getRowId={(s) => s.id}
                  getSearchText={(s) => `${s.name} ${s.admissionNo} ${s.class}`}
                  searchPlaceholder="Search student or class"
                  defaultSort={{ id: "percent", dir: "asc" }}
                  pageSize={10}
                  toolbarActions={
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Download />}
                      disabled={!r.lowAttendance.length}
                      onClick={() =>
                        downloadCsv(
                          `low-attendance-${month}.csv`,
                          ["Admission no.", "Student", "Class", "Days", "Present", "%"],
                          r.lowAttendance.map((s) => [s.admissionNo, s.name, s.class, s.days, s.present, s.percent]),
                        )
                      }
                    >
                      Download
                    </Button>
                  }
                  empty={{ icon: <CalendarCheck />, title: "Nobody this month", description: `No student is below ${threshold}% attendance.` }}
                />
              </div>
            </>
          );
        }}
      </ReportBody>
    </div>
  );
}
