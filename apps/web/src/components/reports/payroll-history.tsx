"use client";

import { useState } from "react";
import { Banknote, Download } from "lucide-react";
import { Button, Card, CardHeader, DataTable, TextField, type Column } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Row {
  userId: string;
  period: string;
  name: string;
  employeeNo: string;
  designation: string;
  basic: number;
  allowances: number;
  deductions: number;
  unpaidDeduction: number;
  lateDeduction: number;
  shortLeaveDeduction: number;
  net: number;
  paidAt: string | null;
}

/** Finalised payroll month by month, and each person's salary history. */
export function PayrollHistory() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const report = useApi<{ from: string; to: string; rows: Row[] }>(`/hr/payroll/history?${q}`);
  const rows = report.data?.rows ?? [];

  const months = new Map<string, { staff: number; net: number }>();
  for (const r of rows) {
    const m = months.get(r.period) ?? { staff: 0, net: 0 };
    months.set(r.period, { staff: m.staff + 1, net: m.net + r.net });
  }
  const cols: Column<Row>[] = [
    { id: "period", header: "Month", sortValue: (r) => r.period, cell: (r) => r.period },
    { id: "name", header: "Staff member", sortValue: (r) => r.name, cell: (r) => <div><div className="font-medium text-fg">{r.name}</div><div className="text-xs text-fg-muted">{r.employeeNo} {r.designation}</div></div> },
    { id: "basic", header: "Basic", align: "right", sortValue: (r) => r.basic, cell: (r) => rupees(r.basic), hideBelow: "md" },
    { id: "allow", header: "Allowances", align: "right", sortValue: (r) => r.allowances, cell: (r) => rupees(r.allowances), hideBelow: "md" },
    { id: "ded", header: "Deductions", align: "right", sortValue: (r) => r.deductions + r.unpaidDeduction + r.lateDeduction + r.shortLeaveDeduction, cell: (r) => rupees(r.deductions + r.unpaidDeduction + r.lateDeduction + r.shortLeaveDeduction), hideBelow: "sm" },
    { id: "net", header: "Net pay", align: "right", sortValue: (r) => r.net, cell: (r) => <span className="font-medium text-fg">{rupees(r.net)}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <TextField label="From month" type="month" value={from} onChange={(e) => setFrom(e.target.value)} wrapperClassName="w-44" />
        <TextField label="To month" type="month" value={to} onChange={(e) => setTo(e.target.value)} wrapperClassName="w-44" />
        <p className="pb-2 text-xs text-fg-muted">Finalised months only. The last twelve are shown unless you choose a range.</p>
      </div>
      <Card>
        <CardHeader title="Payroll by month" />
        <table className="w-full text-sm">
          <thead><tr className="text-left text-fg-muted"><th className="py-1">Month</th><th className="text-right">Staff paid</th><th className="text-right">Net total</th></tr></thead>
          <tbody>
            {[...months.entries()].map(([m, v]) => (
              <tr key={m} className="border-t border-border"><td className="py-1">{m}</td><td className="text-right tabular-nums">{v.staff}</td><td className="text-right tabular-nums">{rupees(v.net)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <DataTable
        label="Salary history"
        columns={cols}
        data={report.data ? rows : undefined}
        error={report.error}
        onRetry={report.reload}
        getRowId={(r) => `${r.period}${r.userId}`}
        getSearchText={(r) => `${r.name} ${r.employeeNo} ${r.designation}`}
        searchPlaceholder="Search a staff member to see their salary history"
        toolbarActions={
          <Button variant="secondary" size="sm" icon={<Download />} disabled={!rows.length} onClick={() => downloadCsv("payroll-history.csv", ["Month", "Employee no.", "Staff member", "Designation", "Basic", "Allowances", "Other deductions", "Unpaid days", "Late", "Short leave", "Net pay", "Paid on"], rows.map((r) => [r.period, r.employeeNo, r.name, r.designation, r.basic, r.allowances, r.deductions, r.unpaidDeduction, r.lateDeduction, r.shortLeaveDeduction, r.net, r.paidAt?.slice(0, 10) ?? ""]))}>
            Download
          </Button>
        }
        empty={{ icon: <Banknote />, title: "No finalised payroll in this range" }}
      />
    </div>
  );
}
