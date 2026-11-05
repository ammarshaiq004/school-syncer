"use client";

import { useState } from "react";
import { ChartColumn } from "lucide-react";
import { DataTable, NativeSelect, type Column } from "@/components/ui";
import { DateRange } from "@/components/date-range";
import { rupees, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const REPORTS = [
  { value: "profit", label: "Profit by day", dated: true },
  { value: "product-sales", label: "Product sales", dated: true },
  { value: "stock", label: "Stock", dated: false },
  { value: "warehouse-stock", label: "Stock by store", dated: false },
  { value: "receiving", label: "Receiving (purchases)", dated: true },
  { value: "receivables", label: "Receivables (student accounts)", dated: false },
  { value: "payables", label: "Payables (vendors)", dated: false },
  { value: "stock-transactions", label: "Stock transactions", dated: true },
];

const MONEY = new Set(["revenue", "profit", "total", "paid", "owed", "amount", "value", "costPrice", "salePrice"]);
const title = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

type Row = Record<string, string | number | boolean | null>;

/** Any POS report as a table; the columns are whatever the report returns. */
export function PosReports() {
  const [kind, setKind] = useState("profit");
  const [range, setRange] = useState({ from: `${todayIso().slice(0, 7)}-01`, to: todayIso() });
  const report = REPORTS.find((r) => r.value === kind)!;
  const rows = useApi<Row[]>(`/pos/reports/${kind}${report.dated ? `?from=${range.from}&to=${range.to}` : ""}`);
  const columns: Column<Row>[] = Object.keys(rows.data?.[0] ?? {})
    .filter((k) => k !== "low")
    .map((k) => ({
      id: k,
      header: title(k),
      align: typeof rows.data?.[0]?.[k] === "number" ? ("right" as const) : undefined,
      sortValue: (r: Row) => r[k] as string | number | null,
      cell: (r: Row) => (MONEY.has(k) && typeof r[k] === "number" ? rupees(r[k] as number) : String(r[k] ?? "–")),
    }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <NativeSelect aria-label="Report" wrapperClassName="w-64" value={kind} onChange={(e) => setKind(e.target.value)} options={REPORTS} />
        {report.dated && <DateRange from={range.from} to={range.to} onChange={setRange} />}
      </div>
      <DataTable label={report.label} columns={columns} data={rows.data} error={rows.error} onRetry={rows.reload} getRowId={(r) => JSON.stringify(r)} pageSize={50}
        empty={{ title: "Nothing to report", description: "No records match yet.", icon: <ChartColumn /> }} />
    </div>
  );
}
