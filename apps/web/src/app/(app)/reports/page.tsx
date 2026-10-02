"use client";

import { useState } from "react";
import { DateRange } from "@/components/date-range";
import { Badge, Button, Card, ErrorText, Field, PageTitle, rowClass, tableClass } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "Income and expenditure" | "Fee collection" | "Outstanding fees" | "Attendance";
interface Total { name: string; total: number }

export default function ReportsPage() {
  const user = useSession();
  const tabs: Tab[] = [
    ...(hasRole(user, FEES) ? (["Income and expenditure", "Fee collection", "Outstanding fees"] as const) : []),
    ...(hasRole(user, SETUP) ? (["Attendance"] as const) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [range, setRange] = useState({ from: `${todayIso().slice(0, 7)}-01`, to: todayIso() });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Reports</PageTitle>
      <div className="flex gap-2 overflow-x-auto border-b border-black/10 dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {(tab === "Income and expenditure" || tab === "Fee collection") && <DateRange from={range.from} to={range.to} onChange={setRange} />}
      {tab === "Income and expenditure" && <IncomeExpense range={range} />}
      {tab === "Fee collection" && <FeeCollection range={range} />}
      {tab === "Outstanding fees" && <Outstanding />}
      {tab === "Attendance" && <AttendanceReport />}
    </div>
  );
}

/** A labelled list of totals with proportional bars. */
function Totals({ title, rows, tone }: { title: string; rows: Total[]; tone: "green" | "red" | "brand" }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  const bar = tone === "green" ? "bg-green-500" : tone === "red" ? "bg-red-400" : "bg-brand";
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {!rows.length && <p className="text-sm opacity-60">None.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.name} className="text-sm">
            <div className="flex justify-between gap-3"><span>{r.name}</span><span className="font-medium">{rupees(r.total)}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10"><div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${(r.total / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IncomeExpense({ range }: { range: { from: string; to: string } }) {
  const report = useApi<{ income: Total[]; expenses: Total[]; totalIncome: number; totalExpenses: number; surplus: number }>(
    `/reports/income-expense?from=${range.from}&to=${range.to}`,
  );
  const r = report.data;
  return (
    <Card>
      <ErrorText>{report.error}</ErrorText>
      {r && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10"><div className="text-xs opacity-60">Income</div><div className="text-lg font-semibold">{rupees(r.totalIncome)}</div></div>
            <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10"><div className="text-xs opacity-60">Expenditure</div><div className="text-lg font-semibold">{rupees(r.totalExpenses)}</div></div>
            <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10"><div className="text-xs opacity-60">{r.surplus >= 0 ? "Surplus" : "Deficit"}</div><div className={`text-lg font-semibold ${r.surplus >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700"}`}>{rupees(Math.abs(r.surplus))}</div></div>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <Totals title="Income" rows={r.income} tone="green" />
            <Totals title="Expenditure" rows={r.expenses} tone="red" />
          </div>
        </>
      )}
    </Card>
  );
}

function FeeCollection({ range }: { range: { from: string; to: string } }) {
  const report = useApi<{ total: number; receipts: number; byDay: Total[]; byMethod: Total[]; byClass: Total[] }>(
    `/reports/fee-collection?from=${range.from}&to=${range.to}`,
  );
  const r = report.data;
  return (
    <Card>
      <ErrorText>{report.error}</ErrorText>
      {r && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg"><strong>{rupees(r.total)}</strong> <span className="text-sm opacity-70">from {r.receipts} receipts</span></p>
            <Button variant="ghost" onClick={() => downloadCsv(`fee-collection-${range.from}-to-${range.to}.csv`, ["Date", "Collected"], r.byDay.map((d) => [d.name, d.total]))}>
              Download for Excel
            </Button>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            <Totals title="By class" rows={r.byClass} tone="brand" />
            <Totals title="By method" rows={r.byMethod.map((m) => ({ ...m, name: m.name.toLowerCase() }))} tone="green" />
            <Totals title="By day" rows={r.byDay.map((d) => ({ ...d, name: day(d.name) }))} tone="brand" />
          </div>
        </>
      )}
    </Card>
  );
}

function Outstanding() {
  const report = useApi<{
    total: number;
    byClass: Total[];
    students: { id: string; name: string; admissionNo: string; class: string; balance: number; invoices: number }[];
  }>("/reports/outstanding");
  const r = report.data;
  return (
    <Card>
      <ErrorText>{report.error}</ErrorText>
      {r && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg"><strong>{rupees(r.total)}</strong> <span className="text-sm opacity-70">owed by {r.students.length} students</span></p>
            <Button
              variant="ghost"
              onClick={() => downloadCsv("outstanding-fees.csv", ["Admission no.", "Student", "Class", "Unpaid vouchers", "Balance"], r.students.map((s) => [s.admissionNo, s.name, s.class, s.invoices, s.balance]))}
            >
              Download for Excel
            </Button>
          </div>
          <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
            <Totals title="By class" rows={r.byClass} tone="red" />
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="opacity-60"><tr><th className="py-2">Student</th><th>Class</th><th>Vouchers</th><th className="text-right">Balance</th></tr></thead>
                <tbody>
                  {r.students.map((s) => (
                    <tr key={s.id} className={rowClass}>
                      <td className="py-2">{s.name}<div className="text-xs opacity-60">{s.admissionNo}</div></td>
                      <td>{s.class}</td>
                      <td>{s.invoices}</td>
                      <td className="text-right font-medium">{rupees(s.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function AttendanceReport() {
  const [month, setMonth] = useState(thisMonth());
  const [threshold, setThreshold] = useState(75);
  const report = useApi<{
    sections: { sectionId: string; name: string; days: number; percent: number }[];
    lowAttendance: { id: string; name: string; admissionNo: string; class: string; days: number; present: number; percent: number }[];
  }>(`/reports/attendance?month=${month}&threshold=${threshold}`);
  const r = report.data;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Field label="Flag below %" type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
      </div>
      <ErrorText>{report.error}</ErrorText>
      {r && (
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Sections</h3>
            {!r.sections.length && <p className="text-sm opacity-60">No attendance taken this month.</p>}
            <table className={tableClass}>
              <tbody>
                {r.sections.map((s) => (
                  <tr key={s.sectionId} className={rowClass}>
                    <td className="py-2">{s.name}</td>
                    <td className="text-xs opacity-60">{s.days} days</td>
                    <td className="text-right font-medium">{s.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Students below {r && threshold}%</h3>
              {!!r.lowAttendance.length && (
                <button
                  className="text-sm text-brand"
                  onClick={() => downloadCsv(`low-attendance-${month}.csv`, ["Admission no.", "Student", "Class", "Days", "Present", "%"], r.lowAttendance.map((s) => [s.admissionNo, s.name, s.class, s.days, s.present, s.percent]))}
                >
                  Download
                </button>
              )}
            </div>
            {!r.lowAttendance.length && <p className="text-sm opacity-60">Nobody this month.</p>}
            <ul className="flex flex-col gap-1 text-sm">
              {r.lowAttendance.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span>{s.name} <span className="opacity-60">· {s.class}</span></span>
                  <Badge tone="red">{s.percent}%</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
