"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Download, Scale, Wallet } from "lucide-react";
import { DateRange } from "@/components/date-range";
import { BarChart, Button, Card, CardHeader, DataTable, KpiCard, StatGrid, TextField, type Column } from "@/components/ui";
import { ReportBody, shortRupees, Totals, type Total } from "@/components/reports/shared";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

interface Sheet {
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  in: { byMethod: Total[]; bySource: Total[] };
  out: { byMethod: Total[]; bySource: Total[] };
}

function SheetBody({ r }: { r: Sheet }) {
  return (
    <>
      <StatGrid cols={4}>
        <KpiCard label="Opening balance" value={rupees(r.opening)} icon={<Wallet />} tone="neutral" />
        <KpiCard label="Money in" value={rupees(r.totalIn)} icon={<ArrowDownLeft />} tone="success" />
        <KpiCard label="Money out" value={rupees(r.totalOut)} icon={<ArrowUpRight />} tone="danger" />
        <KpiCard label="Closing balance" value={rupees(r.closing)} icon={<Scale />} tone="info" />
      </StatGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Money in" description="By payment method" />
          <Totals rows={r.in.byMethod.map((m) => ({ ...m, name: label(m.name) }))} tone="success" empty="Nothing came in." />
        </Card>
        <Card>
          <CardHeader title="Money out" description="By payment method" />
          <Totals rows={r.out.byMethod.map((m) => ({ ...m, name: label(m.name) }))} tone="danger" empty="Nothing went out." />
        </Card>
      </div>
    </>
  );
}

interface DailyRow { date: string; flow: "IN" | "OUT"; amount: number; source: string; description: string; method: string; balance: number }

/** Daily and monthly closing sheets, from the cash book. */
export function ClosingReport() {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const [date, setDate] = useState(todayIso());
  const [month, setMonth] = useState(thisMonth());
  const daily = useApi<Sheet & { date: string; rows: DailyRow[] }>(mode === "daily" ? `/accounts/closing/daily?date=${date}` : null);
  const monthly = useApi<Sheet & { month: string; days: { date: string; in: number; out: number; closing: number }[] }>(
    mode === "monthly" ? `/accounts/closing/monthly?month=${month}` : null,
  );
  const rowColumns: Column<DailyRow>[] = [
    { id: "what", header: "What", cell: (r) => r.description || label(r.source) },
    { id: "method", header: "Method", hideBelow: "sm", cell: (r) => label(r.method) },
    { id: "in", header: "In", align: "right", cell: (r) => (r.flow === "IN" ? rupees(r.amount) : "") },
    { id: "out", header: "Out", align: "right", cell: (r) => (r.flow === "OUT" ? rupees(r.amount) : "") },
    { id: "balance", header: "Balance", align: "right", cell: (r) => rupees(r.balance) },
  ];
  return (
    <div className="flex flex-col gap-6 pt-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Button variant={mode === "daily" ? "primary" : "secondary"} size="sm" onClick={() => setMode("daily")}>
          Daily closing
        </Button>
        <Button variant={mode === "monthly" ? "primary" : "secondary"} size="sm" onClick={() => setMode("monthly")}>
          Monthly closing
        </Button>
        {mode === "daily" ? (
          <TextField label="Day" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        ) : (
          <TextField label="Month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        )}
      </div>
      {mode === "daily" ? (
        <ReportBody report={daily} kpis={4}>
          {(r) => (
            <>
              <p className="text-sm text-fg-muted">Closing for {day(r.date)}</p>
              <SheetBody r={r} />
              <DataTable
                label="Cash book lines for the day"
                columns={rowColumns}
                data={r.rows}
                getRowId={(x) => `${x.source}|${x.method}|${x.description}|${x.balance}`}
                getSearchText={(x) => x.description}
                empty={{ icon: <Wallet />, title: "No money moved on this day" }}
              />
            </>
          )}
        </ReportBody>
      ) : (
        <ReportBody report={monthly} kpis={4}>
          {(r) => (
            <>
              <SheetBody r={r} />
              <Card>
                <CardHeader
                  title="Day by day"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="print:hidden"
                      icon={<Download />}
                      onClick={() => downloadCsv(`monthly-closing-${r.month}.csv`, ["Date", "In", "Out", "Closing balance"], r.days.map((d) => [d.date, d.in, d.out, d.closing]))}
                    >
                      Download for Excel
                    </Button>
                  }
                />
                <BarChart
                  label="Money in and out by day"
                  categories={r.days.map((d) => d.date.slice(8))}
                  series={[
                    { name: "In", values: r.days.map((d) => d.in), color: "var(--success)" },
                    { name: "Out", values: r.days.map((d) => d.out), color: "var(--danger)" },
                  ]}
                  formatValue={shortRupees}
                />
                <table className="mt-5 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-fg-muted">
                      <th className="py-1.5 font-medium">Date</th>
                      <th className="py-1.5 text-right font-medium">In</th>
                      <th className="py-1.5 text-right font-medium">Out</th>
                      <th className="py-1.5 text-right font-medium">Closing balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.days.map((d) => (
                      <tr key={d.date} className="border-t border-border tabular-nums">
                        <td className="py-1.5">{day(d.date)}</td>
                        <td className="py-1.5 text-right">{d.in ? rupees(d.in) : ""}</td>
                        <td className="py-1.5 text-right">{d.out ? rupees(d.out) : ""}</td>
                        <td className="py-1.5 text-right font-medium text-fg">{rupees(d.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </ReportBody>
      )}
    </div>
  );
}

interface Pnl {
  months: string[];
  income: { name: string; byMonth: number[]; total: number }[];
  expenses: { name: string; byMonth: number[]; total: number }[];
  netByMonth: number[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
}
interface UserRow { userId: string | null; name: string; collected: number; receipts: number; otherIncome: number; expenses: number; salaries: number; net: number }

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Annual profit and loss by month, and profit and loss per user. */
export function ProfitLoss() {
  const [start, setStart] = useState(`${todayIso().slice(0, 4)}-01`);
  const [range, setRange] = useState({ from: `${thisMonth()}-01`, to: todayIso() });
  const annual = useApi<Pnl>(`/accounts/pnl/annual?start=${start}`);
  const users = useApi<{ users: UserRow[] }>(`/accounts/pnl/users?from=${range.from}&to=${range.to}`);
  const userColumns: Column<UserRow>[] = [
    { id: "name", header: "User", sortValue: (u) => u.name, cell: (u) => <span className="font-medium text-fg">{u.name}</span> },
    { id: "receipts", header: "Receipts", align: "right", hideBelow: "sm", sortValue: (u) => u.receipts, cell: (u) => u.receipts },
    { id: "collected", header: "Fees collected", align: "right", sortValue: (u) => u.collected, cell: (u) => rupees(u.collected) },
    { id: "income", header: "Other income", align: "right", hideBelow: "md", sortValue: (u) => u.otherIncome, cell: (u) => rupees(u.otherIncome) },
    { id: "expenses", header: "Expenses", align: "right", hideBelow: "md", sortValue: (u) => u.expenses, cell: (u) => rupees(u.expenses) },
    { id: "salaries", header: "Salaries paid", align: "right", hideBelow: "md", sortValue: (u) => u.salaries, cell: (u) => rupees(u.salaries) },
    { id: "net", header: "Net", align: "right", sortValue: (u) => u.net, cell: (u) => <span className={u.net < 0 ? "text-danger-text" : "text-fg"}>{rupees(u.net)}</span> },
  ];
  return (
    <div className="flex flex-col gap-8 pt-5">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-fg">Annual profit and loss</h2>
          <TextField label="First month" type="month" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} wrapperClassName="print:hidden" hint="Twelve months from here" />
        </div>
        <ReportBody report={annual} kpis={3}>
          {(r) => (
            <>
              <StatGrid cols={3}>
                <KpiCard label="Income" value={rupees(r.totalIncome)} icon={<ArrowDownLeft />} tone="success" />
                <KpiCard label="Expenditure" value={rupees(r.totalExpenses)} icon={<ArrowUpRight />} tone="danger" />
                <KpiCard label={r.net >= 0 ? "Profit" : "Loss"} value={rupees(Math.abs(r.net))} icon={<Scale />} tone={r.net >= 0 ? "success" : "danger"} />
              </StatGrid>
              <Card>
                <CardHeader
                  title="Month by month"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="print:hidden"
                      icon={<Download />}
                      onClick={() =>
                        downloadCsv(`profit-and-loss-${r.months[0]}.csv`, ["", ...r.months, "Total"], [
                          ...r.income.map((x) => [`Income: ${x.name}`, ...x.byMonth, x.total]),
                          ...r.expenses.map((x) => [`Expense: ${x.name}`, ...x.byMonth, x.total]),
                          ["Net", ...r.netByMonth, r.net],
                        ])
                      }
                    >
                      Download for Excel
                    </Button>
                  }
                />
                <BarChart
                  label="Net profit or loss by month"
                  categories={r.months.map(monthName)}
                  series={[{ name: "Net", values: r.netByMonth.map((n) => Math.max(0, n)), color: "var(--success)" }, { name: "Loss", values: r.netByMonth.map((n) => Math.max(0, -n)), color: "var(--danger)" }]}
                  formatValue={shortRupees}
                />
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[56rem] text-sm tabular-nums">
                    <thead>
                      <tr className="text-xs text-fg-muted">
                        <th className="sticky left-0 bg-surface py-1.5 pr-3 text-left font-medium"> </th>
                        {r.months.map((m) => (
                          <th key={m} className="px-2 py-1.5 text-right font-medium">{monthName(m)}</th>
                        ))}
                        <th className="px-2 py-1.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([["Income", r.income], ["Expenditure", r.expenses]] as const).map(([title, rows]) => (
                        <FragmentRows key={title} title={title} rows={rows} />
                      ))}
                      <tr className="border-t-2 border-border font-semibold text-fg">
                        <td className="sticky left-0 bg-surface py-1.5 pr-3">Net</td>
                        {r.netByMonth.map((n, i) => (
                          <td key={i} className={`px-2 py-1.5 text-right ${n < 0 ? "text-danger-text" : ""}`}>{n ? rupees(n) : ""}</td>
                        ))}
                        <td className="px-2 py-1.5 text-right">{rupees(r.net)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </ReportBody>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-base font-semibold text-fg">Profit and loss by user</h2>
        <DateRange from={range.from} to={range.to} onChange={setRange} className="print:hidden" />
        <ReportBody report={users} kpis={2}>
          {(r) => (
            <DataTable
              label="Profit and loss by user"
              columns={userColumns}
              data={r.users}
              getRowId={(u) => u.userId ?? "system"}
              getSearchText={(u) => u.name}
              defaultSort={{ id: "collected", dir: "desc" }}
              empty={{ icon: <Wallet />, title: "No money moved in these dates" }}
            />
          )}
        </ReportBody>
      </section>
    </div>
  );
}

function FragmentRows({ title, rows }: { title: string; rows: { name: string; byMonth: number[]; total: number }[] }) {
  return (
    <>
      <tr>
        <td colSpan={14} className="sticky left-0 bg-surface-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</td>
      </tr>
      {rows.map((x) => (
        <tr key={x.name} className="border-t border-border">
          <td className="sticky left-0 bg-surface py-1.5 pr-3">{x.name}</td>
          {x.byMonth.map((n, i) => (
            <td key={i} className="px-2 py-1.5 text-right">{n ? rupees(n) : ""}</td>
          ))}
          <td className="px-2 py-1.5 text-right font-medium text-fg">{rupees(x.total)}</td>
        </tr>
      ))}
    </>
  );
}
