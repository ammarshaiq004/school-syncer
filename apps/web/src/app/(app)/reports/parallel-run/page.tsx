"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Banknote, CalendarCheck, Download, Printer, ReceiptText, Scale } from "lucide-react";
import { DateRange } from "@/components/date-range";
import { Button, Card, CardHeader, EmptyState, ErrorState, KpiCard, PageHeader, SkeletonRows, StatGrid, TabPanel, Tabs } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, todayIso } from "@/lib/format";
import {
  attendanceTable,
  feeDayTable,
  methodLabel,
  voucherTable,
  type AttendanceGrid,
  type FeeTotals,
  type VoucherTotals,
} from "@/lib/parallel-run";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "fees" | "vouchers" | "attendance";
type Range = { from: string; to: string };
type Row = (string | number)[];

const TAB_META: Record<Tab, { label: string; icon: ReactNode }> = {
  fees: { label: "Fees collected", icon: <Banknote /> },
  vouchers: { label: "Vouchers issued and paid", icon: <ReceiptText /> },
  attendance: { label: "Attendance", icon: <CalendarCheck /> },
};

/**
 * Parallel-run comparison (SCHOOL-150): during the pilot month the school
 * keeps its old registers too, and these sheets are ticked off against them
 * line by line. Printed, each table gets a blank column for the tick.
 * Campus-limited staff see only their campuses; reversed payments are left out.
 */
export default function ParallelRunPage() {
  const user = useSession();
  const school = useApi<{ name: string }>("/school");
  const tabs: Tab[] = [...(hasRole(user, FEES) ? (["fees", "vouchers"] as const) : []), ...(hasRole(user, SETUP) ? (["attendance"] as const) : [])];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? "fees");
  const [range, setRange] = useState<Range>({ from: `${todayIso().slice(0, 7)}-01`, to: todayIso() });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Parallel-run check"
        description="Totals to tick off against the school's old fee and attendance registers during the pilot month. Reversed payments are not counted."
        breadcrumbs={[{ label: "Finance" }, { label: "Reports", href: "/reports" }, { label: "Parallel-run check" }]}
        actions={
          <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
            Print
          </Button>
        }
      />
      <div className="hidden print:block">
        <h1 className="font-display text-xl font-semibold text-black">{school.data?.name ?? "School"}: parallel-run check</h1>
        <p className="text-sm text-black">
          {TAB_META[tab].label} · {day(range.from)} to {day(range.to)} · printed {day(todayIso())}
        </p>
      </div>
      {tabs.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={<Scale />} title="No reports for your role" description="These sheets are for fee and admin staff." />
        </Card>
      ) : (
        <Tabs
          tabs={tabs.map((t) => ({ value: t, ...TAB_META[t] }))}
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          aria-label="Parallel-run sheets"
          listClassName="print:hidden"
        >
          <DateRange from={range.from} to={range.to} onChange={setRange} className="pt-5 print:hidden" />
          <TabPanel value="fees">
            <Fees range={range} />
          </TabPanel>
          <TabPanel value="vouchers">
            <Vouchers range={range} />
          </TabPanel>
          <TabPanel value="attendance">
            <Attendance range={range} />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}

function Loaded<T>({ report, children }: { report: { data: T | null; error: string; reload: () => Promise<void> }; children: (data: T) => ReactNode }) {
  if (report.error)
    return (
      <Card padding="none">
        <ErrorState message={report.error} onRetry={report.reload} />
      </Card>
    );
  if (!report.data)
    return (
      <Card aria-busy="true" aria-label="Loading report">
        <SkeletonRows rows={6} columns={4} />
      </Card>
    );
  return <div className="flex flex-col gap-6">{children(report.data)}</div>;
}

/**
 * A plain table that prints whole (no paging), totals row in bold, numbers
 * right-aligned, and on paper a blank "Register" column to tick.
 */
function Sheet({ title, description, header, csvHeader = header, rows, filename, money = [], sticky }: { title: string; description?: string; header: string[]; csvHeader?: string[]; rows: Row[]; filename: string; money?: number[]; sticky?: boolean }) {
  return (
    <Card padding="none" className="break-inside-avoid print:border-0 print:shadow-none">
      <div className="px-5 pt-5 print:px-0">
        <CardHeader
          title={title}
          description={description}
          action={
            <Button variant="secondary" size="sm" className="print:hidden" icon={<Download />} disabled={rows.length <= 1} onClick={() => downloadCsv(filename, csvHeader, rows)}>
              Download for Excel
            </Button>
          }
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-y border-border bg-surface-2 text-left text-xs font-medium text-fg-muted print:bg-white print:text-black">
              {header.map((h, i) => (
                <th key={h} scope="col" className={`whitespace-nowrap px-3 py-2 first:ps-5 last:pe-5 ${i > 0 ? "text-right" : ""} ${i === 0 && sticky ? "sticky start-0 bg-surface-2" : ""}`}>
                  {h}
                </th>
              ))}
              <th scope="col" className="hidden w-24 px-3 py-2 print:table-cell">
                Register
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const total = ri === rows.length - 1;
              return (
                <tr key={ri} className={`border-b border-border last:border-b-0 ${total ? "font-semibold text-fg" : "text-fg-secondary"} print:text-black`}>
                  {r.map((c, i) => (
                    <td key={i} className={`whitespace-nowrap px-3 py-2 first:ps-5 last:pe-5 ${i > 0 ? "text-right" : "text-fg"} ${i === 0 && sticky ? "sticky start-0 bg-surface" : ""}`}>
                      {i === 0 && !total && /^\d{4}-\d{2}-\d{2}$/.test(String(c)) ? day(String(c)) : money.includes(i) && typeof c === "number" ? rupees(c) : c}
                    </td>
                  ))}
                  <td className="hidden border-s border-border print:table-cell" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Fees({ range }: { range: Range }) {
  const report = useApi<FeeTotals>(`/reports/parallel-run/fees?from=${range.from}&to=${range.to}`);
  const span = `${range.from}-to-${range.to}`;
  return (
    <Loaded report={report}>
      {(r) => {
        const days = feeDayTable(r);
        return (
          <>
            <StatGrid cols={3}>
              <KpiCard label="Collected" value={rupees(r.total)} icon={<Banknote />} tone="success" />
              <KpiCard label="Receipts" value={r.receipts.toLocaleString("en-PK")} icon={<ReceiptText />} />
              <KpiCard label="Days with collections" value={r.byDay.length.toLocaleString("en-PK")} icon={<CalendarCheck />} tone="info" />
            </StatGrid>
            {r.receipts === 0 ? (
              <Card padding="none">
                <EmptyState icon={<Banknote />} title="No fees collected in these dates" description="Payments recorded on fee vouchers appear here, by the day they were received." />
              </Card>
            ) : (
              <>
                <Sheet
                  title="Collected per day"
                  description="Compare each day's total with the old fee register or cash book."
                  header={days.header}
                  rows={days.rows}
                  money={days.header.map((_, i) => i).filter((i) => i >= 2)}
                  filename={`parallel-run-fees-by-day-${span}.csv`}
                />
                <div className="grid gap-6 lg:grid-cols-2">
                  <Sheet
                    title="Per payment method"
                    header={["Method", "Receipts", "Collected"]}
                    rows={[...r.byMethod.map((m) => [methodLabel(m.name), m.receipts, m.total]), ["Total", r.receipts, r.total]]}
                    money={[2]}
                    filename={`parallel-run-fees-by-method-${span}.csv`}
                  />
                  <Sheet
                    title="Per fee head"
                    description="Each payment is split across its voucher's heads in the order they are settled."
                    header={["Fee head", "Collected"]}
                    rows={[...r.byHead.map((h) => [h.name, h.total]), ["Total", r.total]]}
                    money={[1]}
                    filename={`parallel-run-fees-by-head-${span}.csv`}
                  />
                </div>
              </>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

function Vouchers({ range }: { range: Range }) {
  const report = useApi<VoucherTotals>(`/reports/parallel-run/vouchers?from=${range.from}&to=${range.to}`);
  const span = `${range.from}-to-${range.to}`;
  return (
    <Loaded report={report}>
      {(r) => {
        const byClass = voucherTable(r.byClass, r.totals, "Class");
        const byPeriod = voucherTable(r.byPeriod, r.totals, "Billing month");
        return (
          <>
            <StatGrid cols={4}>
              <KpiCard label="Vouchers issued" value={r.totals.issued.toLocaleString("en-PK")} icon={<ReceiptText />} hint={r.voided ? `${r.voided} voided, not counted` : undefined} />
              <KpiCard label="Paid in full" value={r.totals.paid.toLocaleString("en-PK")} icon={<Banknote />} tone="success" hint={`${r.totals.partial} part paid`} />
              <KpiCard label="Billed" value={rupees(r.totals.billed)} icon={<Scale />} tone="info" />
              <KpiCard label="Outstanding" value={rupees(r.totals.outstanding)} icon={<Scale />} tone="danger" hint={`${rupees(r.totals.collected)} collected`} />
            </StatGrid>
            {r.totals.issued === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={<ReceiptText />}
                  title="No vouchers issued in these dates"
                  description={
                    <>
                      Vouchers count by their issue date. <Link href="/fees" className="font-medium text-brand hover:underline">Generate vouchers</Link> from the fees page.
                    </>
                  }
                />
              </Card>
            ) : (
              <>
                <Sheet title="Per class" description="Vouchers issued in these dates, against how many are paid." header={byClass.header} rows={byClass.rows} money={[2, 7, 8]} filename={`parallel-run-vouchers-by-class-${span}.csv`} />
                <Sheet title="Per billing month" header={byPeriod.header} rows={byPeriod.rows} money={[2, 7, 8]} filename={`parallel-run-vouchers-by-month-${span}.csv`} />
              </>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

function Attendance({ range }: { range: Range }) {
  const report = useApi<AttendanceGrid>(`/reports/parallel-run/attendance?from=${range.from}&to=${range.to}`);
  const span = `${range.from}-to-${range.to}`;
  return (
    <Loaded report={report}>
      {(r) => {
        const grid = attendanceTable(r);
        // Short day headings on screen ("1 Oct"); the download keeps full dates.
        const header = grid.header.map((h) => (/^\d{4}-\d{2}-\d{2}$/.test(h) ? day(h).replace(/ \d{4}$/, "") : h));
        return (
          <>
            <StatGrid cols={3}>
              <KpiCard label="Present" value={`${r.percent}%`} icon={<CalendarCheck />} tone="success" hint={`${r.present} of ${r.marked} marked (late counts as present)`} />
              <KpiCard label="Days marked" value={r.dates.length.toLocaleString("en-PK")} icon={<CalendarCheck />} tone="info" />
              <KpiCard label="Sections" value={r.sections.length.toLocaleString("en-PK")} icon={<Scale />} />
            </StatGrid>
            {r.sections.length === 0 ? (
              <Card padding="none">
                <EmptyState icon={<CalendarCheck />} title="No attendance marked in these dates" />
              </Card>
            ) : (
              <>
                <Sheet
                  title="Per section per day"
                  description="Present of marked in each register. A blank means the register was not taken that day."
                  header={header}
                  csvHeader={grid.header}
                  rows={grid.rows}
                  sticky
                  filename={`parallel-run-attendance-${span}.csv`}
                />
                <Sheet
                  title="Per day"
                  header={["Date", "Sections marked", "Present", "Marked", "% present"]}
                  rows={[...r.byDate.map((d) => [d.date, d.sections, d.present, d.marked, d.percent]), ["Total", r.sections.length, r.present, r.marked, r.percent]]}
                  filename={`parallel-run-attendance-by-day-${span}.csv`}
                />
              </>
            )}
          </>
        );
      }}
    </Loaded>
  );
}
