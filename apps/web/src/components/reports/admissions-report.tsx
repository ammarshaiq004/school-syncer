"use client";

import { useState } from "react";
import { Download, UserMinus, UserPlus } from "lucide-react";
import { Button, Card, CardHeader, DataTable, ErrorState, KpiCard, SkeletonRows, StatGrid, type Column } from "@/components/ui";
import { DateRange } from "@/components/date-range";
import { downloadCsv } from "@/lib/csv";
import { day, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Person { name: string; admissionNo: string; gender: string; class: string; on: string }
interface Report {
  totals: { admitted: number; withdrawn: number };
  months: { month: string; admitted: number; withdrawn: number; net: number }[];
  admitted: Person[];
  withdrawn: Person[];
}

const people = (label: string): Column<Person>[] => [
  { id: "name", header: "Student", sortValue: (p) => p.name, cell: (p) => <div><div className="font-medium text-fg">{p.name}</div><div className="text-xs text-fg-muted">{p.admissionNo}</div></div> },
  { id: "class", header: "Class", sortValue: (p) => p.class, cell: (p) => p.class, hideBelow: "sm" },
  { id: "on", header: label, sortValue: (p) => p.on, cell: (p) => day(p.on) },
];

/** Who joined and who left in a school year, month by month. */
export function AdmissionsReport() {
  const [range, setRange] = useState({ from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso() });
  const report = useApi<Report>(`/reports/admissions-withdrawals?from=${range.from}&to=${range.to}`);
  const r = report.data;

  const list = (title: string, rows: Person[], label: string, file: string) => (
    <DataTable
      label={title}
      columns={people(label)}
      data={rows}
      getRowId={(p) => `${p.admissionNo}${p.on}`}
      getSearchText={(p) => `${p.name} ${p.admissionNo} ${p.class}`}
      searchPlaceholder="Search student or class"
      pageSize={10}
      toolbarActions={
        <Button variant="secondary" size="sm" icon={<Download />} disabled={!rows.length} onClick={() => downloadCsv(file, ["Admission no.", "Student", "Gender", "Class", label], rows.map((p) => [p.admissionNo, p.name, p.gender, p.class, p.on]))}>
          Download
        </Button>
      }
      empty={{ icon: <UserPlus />, title: "Nobody in this period" }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <DateRange from={range.from} to={range.to} onChange={setRange} className="print:hidden" />
      {report.error ? (
        <ErrorState compact message={report.error} onRetry={report.reload} />
      ) : !r ? (
        <SkeletonRows rows={4} columns={3} />
      ) : (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Admitted" value={r.totals.admitted} icon={<UserPlus />} tone="success" />
            <KpiCard label="Withdrawn" value={r.totals.withdrawn} icon={<UserMinus />} tone="warning" />
            <KpiCard label="Net change" value={r.totals.admitted - r.totals.withdrawn} tone="info" />
          </StatGrid>
          <Card>
            <CardHeader title="Month by month" />
            <table className="w-full text-sm">
              <thead><tr className="text-left text-fg-muted"><th className="py-1">Month</th><th className="text-right">Admitted</th><th className="text-right">Withdrawn</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {r.months.map((m) => (
                  <tr key={m.month} className="border-t border-border"><td className="py-1">{m.month}</td><td className="text-right tabular-nums">{m.admitted}</td><td className="text-right tabular-nums">{m.withdrawn}</td><td className="text-right tabular-nums">{m.net}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          {list("Admitted", r.admitted, "Admitted on", "admissions.csv")}
          {list("Withdrawn", r.withdrawn, "Left on", "withdrawals.csv")}
        </>
      )}
    </div>
  );
}
