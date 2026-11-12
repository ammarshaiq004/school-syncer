"use client";

import { useState } from "react";
import { Cake, Download, MapPin, Printer } from "lucide-react";
import { Button, Card, Checkbox, DataTable, SelectField, SkeletonRows, type Column } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Report = "birthdays" | "localities" | "staff";
const REPORTS: { value: Report; label: string }[] = [
  { value: "birthdays", label: "Birthdays" },
  { value: "localities", label: "Students by locality" },
  { value: "staff", label: "Staff register (choose columns)" },
];

/** Lists of people for the school office. */
export function PeopleReports() {
  const [report, setReport] = useState<Report>("birthdays");
  return (
    <div className="flex flex-col gap-4">
      <SelectField label="Report" value={report} onChange={(e) => setReport(e.target.value as Report)} options={REPORTS} wrapperClassName="w-full sm:w-64 print:hidden" />
      {report === "birthdays" && <Birthdays />}
      {report === "localities" && <Localities />}
      {report === "staff" && <StaffRegister />}
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

interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  roles: { role: string }[];
  staffProfile: {
    employeeNo: string;
    designation: string;
    department: string | null;
    joinedOn: string | null;
    dateOfBirth: string | null;
    cnic: string | null;
    basicSalary: number;
    bankName: string | null;
    bankAccount: string | null;
    status: string;
  } | null;
}

const date = (d: string | null | undefined) => (d ? day(d) : "");
const STAFF_COLUMNS: { id: string; label: string; get: (m: StaffMember) => string; on?: boolean }[] = [
  { id: "no", label: "Employee no.", get: (m) => m.staffProfile?.employeeNo ?? "", on: true },
  { id: "name", label: "Name", get: (m) => m.name, on: true },
  { id: "post", label: "Designation", get: (m) => m.staffProfile?.designation ?? "", on: true },
  { id: "dept", label: "Department", get: (m) => m.staffProfile?.department ?? "" },
  { id: "phone", label: "Phone", get: (m) => m.phone ?? "", on: true },
  { id: "email", label: "Email", get: (m) => m.email ?? "" },
  { id: "cnic", label: "CNIC", get: (m) => m.staffProfile?.cnic ?? "" },
  { id: "dob", label: "Date of birth", get: (m) => date(m.staffProfile?.dateOfBirth) },
  { id: "joined", label: "Joined", get: (m) => date(m.staffProfile?.joinedOn) },
  { id: "salary", label: "Basic salary", get: (m) => (m.staffProfile ? rupees(m.staffProfile.basicSalary) : "") },
  { id: "bank", label: "Bank", get: (m) => m.staffProfile?.bankName ?? "" },
  { id: "account", label: "Account no.", get: (m) => m.staffProfile?.bankAccount ?? "" },
  { id: "status", label: "Status", get: (m) => (m.staffProfile?.status === "LEFT" ? "Left" : m.isActive ? "Active" : "Inactive") },
];

/** The staff list with only the columns you tick, for printing or Excel. */
function StaffRegister() {
  const [picked, setPicked] = useState(() => new Set(STAFF_COLUMNS.filter((c) => c.on).map((c) => c.id)));
  const staff = useApi<StaffMember[]>("/hr/staff");
  const cols = STAFF_COLUMNS.filter((c) => picked.has(c.id));
  const rows = (staff.data ?? []).filter((m) => m.staffProfile);
  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm" className="print:hidden">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {STAFF_COLUMNS.map((c) => (
            <Checkbox key={c.id} label={c.label} checked={picked.has(c.id)} onCheckedChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(c.id); else n.delete(c.id); return n; })} />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" icon={<Download />} disabled={!rows.length || !cols.length} onClick={() => downloadCsv("staff-register.csv", cols.map((c) => c.label), rows.map((m) => cols.map((c) => c.get(m))))}>
            Download
          </Button>
          <Button variant="secondary" size="sm" icon={<Printer />} onClick={() => window.print()}>Print</Button>
        </div>
      </Card>
      {staff.error ? (
        <p className="text-sm text-danger">{staff.error}</p>
      ) : !staff.data ? (
        <SkeletonRows rows={5} columns={4} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" aria-label="Staff register">
            <thead><tr>{cols.map((c) => <th key={c.id} className="border border-border px-2 py-1 text-left">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((m) => <tr key={m.id}>{cols.map((c) => <td key={c.id} className="border border-border px-2 py-1">{c.get(m)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Area { id: string | null; name: string; total: number; boys: number; girls: number }
interface AreaStudent { name: string; admissionNo: string; section: string; address: string; guardian: string; phone: string }

/** How many students live in each area, and the families of any one area. */
function Localities() {
  const [areaId, setAreaId] = useState("");
  const report = useApi<{ localities: Area[]; students: AreaStudent[] }>(`/reports/people/localities${areaId ? `?localityId=${encodeURIComponent(areaId)}` : ""}`);
  const areas = report.data?.localities ?? [];
  const students = report.data?.students ?? [];
  const areaCols: Column<Area>[] = [
    { id: "name", header: "Locality", sortValue: (a) => a.name, cell: (a) => <span className="font-medium text-fg">{a.name}</span> },
    { id: "total", header: "Students", align: "right", sortValue: (a) => a.total, cell: (a) => a.total },
    { id: "boys", header: "Boys", align: "right", sortValue: (a) => a.boys, cell: (a) => a.boys, hideBelow: "sm" },
    { id: "girls", header: "Girls", align: "right", sortValue: (a) => a.girls, cell: (a) => a.girls, hideBelow: "sm" },
  ];
  const studentCols: Column<AreaStudent>[] = [
    { id: "name", header: "Student", sortValue: (s) => s.name, cell: (s) => <div><div className="font-medium text-fg">{s.name}</div><div className="text-xs text-fg-muted">{s.admissionNo}</div></div> },
    { id: "section", header: "Class", sortValue: (s) => s.section, cell: (s) => s.section, hideBelow: "sm" },
    { id: "guardian", header: "Parent", cell: (s) => <div><div>{s.guardian}</div><div className="text-xs text-fg-muted">{s.phone}</div></div> },
    { id: "address", header: "Address", cell: (s) => s.address, hideBelow: "md" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        label="Students by locality"
        columns={areaCols}
        data={report.data ? areas : undefined}
        error={report.error}
        onRetry={report.reload}
        getRowId={(a) => a.id ?? "none"}
        toolbarActions={
          <>
            <SelectField aria-label="Show the families of" value={areaId} onChange={(e) => setAreaId(e.target.value)} placeholder="Show the families of…" options={areas.map((a) => ({ value: a.id ?? "none", label: a.name }))} wrapperClassName="w-56 print:hidden" />
            <Button variant="secondary" size="sm" icon={<Download />} disabled={!areas.length} onClick={() => downloadCsv("students-by-locality.csv", ["Locality", "Students", "Boys", "Girls"], areas.map((a) => [a.name, a.total, a.boys, a.girls]))}>
              Download
            </Button>
          </>
        }
        empty={{ icon: <MapPin />, title: "No students yet", description: "Localities are set on each student's record." }}
      />
      {areaId && (
        <DataTable
          label="Families in this locality"
          columns={studentCols}
          data={report.data ? students : undefined}
          getRowId={(s) => s.admissionNo}
          getSearchText={(s) => `${s.name} ${s.admissionNo} ${s.guardian}`}
          searchPlaceholder="Search student or parent"
          toolbarActions={
            <Button variant="secondary" size="sm" icon={<Download />} disabled={!students.length} onClick={() => downloadCsv("locality-families.csv", ["Admission no.", "Student", "Class", "Parent", "Phone", "Address"], students.map((s) => [s.admissionNo, s.name, s.section, s.guardian, s.phone, s.address]))}>
              Download
            </Button>
          }
          empty={{ title: "No students in this locality" }}
        />
      )}
    </div>
  );
}
