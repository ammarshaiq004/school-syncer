"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, Card, DataTable, NativeSelect, SelectField, StatusPill, TextField, type Column } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { todayIso } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { BlankSheet } from "./blank-sheet";
import { META_BY_STATUS, type AttendanceStatus } from "./status";

type Report = "daily" | "class" | "staff" | "staffRank" | "blank";

interface DailyRow { studentId: string; name: string; admissionNo: string; section: string; status: AttendanceStatus; note: string | null; scannedAt: string | null }
interface ClassReport {
  days: (Record<AttendanceStatus, number> & { date: string; rate: number | null })[];
  students: (Record<AttendanceStatus, number> & { id: string; name: string; admissionNo: string; rollNo: number | null })[];
}
interface StaffRow { userId: string; name: string; designation: string | null; status: AttendanceStatus; note: string | null; scannedAt: string | null }
interface RankRow extends Record<AttendanceStatus, number> { userId: string; name: string; marked: number }

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
const pill = (s: AttendanceStatus) => <StatusPill status={s} label={META_BY_STATUS[s].label} />;

const STATUS_FILTERS = [
  { value: "ABSENT,LATE,LEAVE", label: "Absent, late and on leave" },
  { value: "ABSENT", label: "Absent" },
  { value: "LATE", label: "Late" },
  { value: "LEAVE", label: "On leave" },
];

/** "Reports" tab: who was absent, late or on leave, a class by date, and staff absences. */
export function ReportsTab() {
  const isAdmin = hasRole(useSession(), SETUP);
  const [report, setReport] = useState<Report>("daily");
  const [date, setDate] = useState(todayIso());
  const [status, setStatus] = useState(STATUS_FILTERS[0].value);
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayIso());
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const sections = useSectionOptions({ enabled: isAdmin });
  const mine = useApi<{ id: string; name: string }[]>(isAdmin ? null : "/attendance/sections");
  const sectionOptions = isAdmin ? sections.options : (mine.data ?? []).map((s) => ({ value: s.id, label: s.name }));

  const options = [
    { value: "daily", label: "Students absent, late or on leave" },
    { value: "class", label: "Class by date" },
    { value: "blank", label: "Blank attendance sheet (to print)" },
    ...(isAdmin ? [{ value: "staff", label: "Staff absent or late" }, { value: "staffRank", label: "Most absent staff" }] : []),
  ];
  const wantsDate = report === "daily" || report === "staff";
  const wantsStatus = wantsDate;
  const rangeOk = from <= to;
  const q = new URLSearchParams(wantsDate ? { date, status } : { from, to });

  const daily = useApi<{ rows: DailyRow[] }>(report === "daily" ? `/attendance/reports/daily?${q}` : null);
  const cls = useApi<ClassReport>(report === "class" && sectionId && rangeOk ? `/attendance/reports/class?${new URLSearchParams({ sectionId, from, to })}` : null);
  const staff = useApi<{ rows: StaffRow[] }>(report === "staff" ? `/attendance/reports/staff?${q}` : null);
  const rank = useApi<{ rows: RankRow[] }>(report === "staffRank" && rangeOk ? `/attendance/reports/staff-absences?${q}&limit=20` : null);

  const dailyCols: Column<DailyRow>[] = [
    { id: "name", header: "Student", sortValue: (r) => r.name, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "adm", header: "Admission no.", cell: (r) => r.admissionNo, hideBelow: "md" },
    { id: "section", header: "Class", sortValue: (r) => r.section, cell: (r) => r.section },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => pill(r.status) },
    { id: "at", header: "Scanned at", cell: (r) => time(r.scannedAt) || "-", hideBelow: "sm" },
    { id: "note", header: "Note", cell: (r) => r.note ?? "", hideBelow: "lg" },
  ];
  const dayCols: Column<ClassReport["days"][number]>[] = [
    { id: "date", header: "Date", sortValue: (r) => r.date, cell: (r) => r.date },
    { id: "p", header: "Present", align: "right", sortValue: (r) => r.PRESENT, cell: (r) => r.PRESENT },
    { id: "a", header: "Absent", align: "right", sortValue: (r) => r.ABSENT, cell: (r) => r.ABSENT },
    { id: "l", header: "Late", align: "right", sortValue: (r) => r.LATE, cell: (r) => r.LATE },
    { id: "e", header: "On leave", align: "right", sortValue: (r) => r.LEAVE, cell: (r) => r.LEAVE },
    { id: "rate", header: "Attendance", align: "right", sortValue: (r) => r.rate, cell: (r) => (r.rate === null ? "-" : `${r.rate}%`) },
  ];
  const studentCols: Column<ClassReport["students"][number]>[] = [
    { id: "roll", header: "Roll", cell: (r) => r.rollNo ?? "", width: "70px" },
    { id: "name", header: "Student", sortValue: (r) => r.name, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "p", header: "Present", align: "right", sortValue: (r) => r.PRESENT, cell: (r) => r.PRESENT },
    { id: "a", header: "Absent", align: "right", sortValue: (r) => r.ABSENT, cell: (r) => r.ABSENT },
    { id: "l", header: "Late", align: "right", sortValue: (r) => r.LATE, cell: (r) => r.LATE },
    { id: "e", header: "On leave", align: "right", sortValue: (r) => r.LEAVE, cell: (r) => r.LEAVE },
  ];
  const staffCols: Column<StaffRow>[] = [
    { id: "name", header: "Staff member", sortValue: (r) => r.name, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "des", header: "Designation", cell: (r) => r.designation ?? "", hideBelow: "md" },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => pill(r.status) },
    { id: "at", header: "Scanned at", cell: (r) => time(r.scannedAt) || "-", hideBelow: "sm" },
    { id: "note", header: "Note", cell: (r) => r.note ?? "", hideBelow: "lg" },
  ];
  const rankCols: Column<RankRow>[] = [
    { id: "name", header: "Staff member", sortValue: (r) => r.name, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "a", header: "Days absent", align: "right", sortValue: (r) => r.ABSENT, cell: (r) => <span className={r.ABSENT ? "text-danger-text" : undefined}>{r.ABSENT}</span> },
    { id: "l", header: "Days late", align: "right", sortValue: (r) => r.LATE, cell: (r) => r.LATE },
    { id: "e", header: "On leave", align: "right", sortValue: (r) => r.LEAVE, cell: (r) => r.LEAVE },
    { id: "m", header: "Days marked", align: "right", sortValue: (r) => r.marked, cell: (r) => r.marked },
  ];

  function exportCsv() {
    if (report === "daily" && daily.data)
      downloadCsv(`students-${date}.csv`, ["Student", "Admission no.", "Class", "Status", "Scanned at", "Note"], daily.data.rows.map((r) => [r.name, r.admissionNo, r.section, META_BY_STATUS[r.status].label, time(r.scannedAt), r.note ?? ""]));
    if (report === "class" && cls.data)
      downloadCsv(`class-${from}-to-${to}.csv`, ["Date", "Present", "Absent", "Late", "On leave", "Attendance %"], cls.data.days.map((d) => [d.date, d.PRESENT, d.ABSENT, d.LATE, d.LEAVE, d.rate ?? ""]));
    if (report === "staff" && staff.data)
      downloadCsv(`staff-${date}.csv`, ["Staff member", "Designation", "Status", "Scanned at", "Note"], staff.data.rows.map((r) => [r.name, r.designation ?? "", META_BY_STATUS[r.status].label, time(r.scannedAt), r.note ?? ""]));
    if (report === "staffRank" && rank.data)
      downloadCsv(`staff-absences-${from}-to-${to}.csv`, ["Staff member", "Days absent", "Days late", "On leave", "Days marked"], rank.data.rows.map((r) => [r.name, r.ABSENT, r.LATE, r.LEAVE, r.marked]));
  }

  return (
    <div className="flex flex-col gap-6">
      <Card padding="sm" className="print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label="Report" value={report} onChange={(e) => setReport(e.target.value as Report)} options={options} wrapperClassName="w-full sm:w-64" />
          {report === "blank" ? (
            <TextField label="Month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} wrapperClassName="w-full sm:w-44" />
          ) : wantsDate ? (
            <TextField label="Date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} wrapperClassName="w-full sm:w-44" />
          ) : (
            <>
              <TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} wrapperClassName="w-full sm:w-44" />
              <TextField label="To" type="date" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} wrapperClassName="w-full sm:w-44" error={rangeOk ? undefined : "Start must be before the end"} />
            </>
          )}
          {(report === "class" || report === "blank") && (
            <SelectField label="Class and section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Choose a section" options={sectionOptions} wrapperClassName="w-full sm:w-64" />
          )}
          {wantsStatus && (
            <div>
              <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_FILTERS} />
            </div>
          )}
          <Button type="button" variant="secondary" icon={<Download />} onClick={exportCsv} disabled={report === "blank"} className="sm:ml-auto">
            Export CSV
          </Button>
        </div>
        <p className="mt-2 text-xs text-fg-muted">Reports cover up to 92 days. Run &ldquo;Close the day&rdquo; on the Scan tab so students and staff who never came show as absent.</p>
      </Card>

      {report === "daily" && (
        <DataTable label="Students absent, late or on leave" columns={dailyCols} data={daily.data?.rows} error={daily.error} onRetry={daily.reload} getRowId={(r) => `${r.studentId}`} getSearchText={(r) => `${r.name} ${r.admissionNo} ${r.section}`} searchPlaceholder="Search students" empty={{ title: "No one in this list", description: "Nobody was absent, late or on leave on this day." }} />
      )}
      {report === "class" &&
        (sectionId ? (
          <>
            <DataTable label="Attendance by date" columns={dayCols} data={cls.data?.days} error={cls.error} onRetry={cls.reload} getRowId={(r) => r.date} empty={{ title: "No registers in this range" }} />
            <DataTable label="Attendance by student" columns={studentCols} data={cls.data?.students} getRowId={(r) => r.id} getSearchText={(r) => r.name} searchPlaceholder="Search students" />
          </>
        ) : (
          <Card><p className="text-sm text-fg-muted">Choose a section to see its attendance by date.</p></Card>
        ))}
      {report === "blank" &&
        (sectionId ? (
          <BlankSheet sectionId={sectionId} month={month} />
        ) : (
          <Card><p className="text-sm text-fg-muted">Choose a section to see its blank sheet.</p></Card>
        ))}
      {report === "staff" && (
        <DataTable label="Staff absent, late or on leave" columns={staffCols} data={staff.data?.rows} error={staff.error} onRetry={staff.reload} getRowId={(r) => r.userId} empty={{ title: "No one in this list", description: "No staff were absent, late or on leave on this day." }} />
      )}
      {report === "staffRank" && (
        <DataTable label="Most absent staff" columns={rankCols} data={rank.data?.rows} error={rank.error} onRetry={rank.reload} getRowId={(r) => r.userId} empty={{ title: "No absences", description: "Nobody was absent or late in this range." }} />
      )}
    </div>
  );
}
