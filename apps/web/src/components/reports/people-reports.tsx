"use client";

import { useState } from "react";
import { Cake, Download } from "lucide-react";
import { Button, DataTable, SelectField, type Column } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Report = "birthdays";
const REPORTS: { value: Report; label: string }[] = [{ value: "birthdays", label: "Birthdays" }];

/** Lists of people for the school office. */
export function PeopleReports() {
  const [report, setReport] = useState<Report>("birthdays");
  return (
    <div className="flex flex-col gap-4">
      <SelectField label="Report" value={report} onChange={(e) => setReport(e.target.value as Report)} options={REPORTS} wrapperClassName="w-full sm:w-64 print:hidden" />
      {report === "birthdays" && <Birthdays />}
    </div>
  );
}

interface Birthday { kind: "student" | "staff"; name: string; ref: string; detail: string; dateOfBirth: string; day: number; turns: number }

function Birthdays() {
  const [month, setMonth] = useState(Number(todayIso().slice(5, 7)));
  const report = useApi<{ month: number; people: Birthday[] }>(`/reports/people/birthdays?month=${month}`);
  const rows = report.data?.people ?? [];
  const cols: Column<Birthday>[] = [
    { id: "day", header: "Day", sortValue: (p) => p.day, cell: (p) => `${p.day} ${MONTHS[month - 1].slice(0, 3)}` },
    { id: "name", header: "Name", sortValue: (p) => p.name, cell: (p) => <div><div className="font-medium text-fg">{p.name}</div><div className="text-xs text-fg-muted">{p.ref}</div></div> },
    { id: "kind", header: "Who", sortValue: (p) => p.kind, cell: (p) => (p.kind === "student" ? "Student" : "Staff"), hideBelow: "sm" },
    { id: "detail", header: "Class or post", sortValue: (p) => p.detail, cell: (p) => p.detail, hideBelow: "sm" },
    { id: "turns", header: "Turns", sortValue: (p) => p.turns, cell: (p) => p.turns },
  ];
  return (
    <DataTable
      label={`Birthdays in ${MONTHS[month - 1]}`}
      columns={cols}
      data={report.data ? rows : undefined}
      error={report.error}
      onRetry={report.reload}
      getRowId={(p) => `${p.kind}${p.ref}`}
      getSearchText={(p) => `${p.name} ${p.ref} ${p.detail}`}
      searchPlaceholder="Search name"
      toolbarActions={
        <>
          <SelectField aria-label="Month" value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} wrapperClassName="w-40 print:hidden" />
          <Button variant="secondary" size="sm" icon={<Download />} disabled={!rows.length} onClick={() => downloadCsv(`birthdays-${MONTHS[month - 1].toLowerCase()}.csv`, ["Date of birth", "Name", "Who", "Number", "Class or post", "Turns"], rows.map((p) => [p.dateOfBirth, p.name, p.kind, p.ref, p.detail, p.turns]))}>
            Download
          </Button>
        </>
      }
      empty={{ icon: <Cake />, title: "No birthdays this month", description: "Staff birthdays need a date of birth on their HR record." }}
    />
  );
}
