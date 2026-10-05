"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, DataTable, NativeSelect, PageHeader, StatusPill, type Column } from "@/components/ui";
import { fullName } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";
import { STATUS_OPTIONS } from "./directory-types";

interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  status: string;
  enrollments: { rollNo: number | null; section: { name: string; class: { name: string } } }[];
  guardians: { guardian: { name: string; phone: string } }[];
}

const classOf = (s: StudentRow) => (s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}` : "");

const columns: Column<StudentRow>[] = [
  {
    id: "name",
    header: "Student",
    sortValue: (s) => fullName(s),
    cell: (s) => (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={fullName(s)} size="sm" />
        <div className="min-w-0">
          <Link href={`/students/${s.id}`} className="block truncate font-medium text-fg hover:text-brand">
            {fullName(s)}
          </Link>
          <span className="block font-mono text-xs text-fg-muted">{s.admissionNo}</span>
        </div>
      </div>
    ),
  },
  { id: "class", header: "Class", sortValue: (s) => classOf(s), cell: (s) => classOf(s) || <span className="text-fg-muted">Not enrolled</span> },
  {
    id: "roll",
    header: "Roll",
    align: "right",
    width: "72px",
    sortValue: (s) => s.enrollments[0]?.rollNo ?? null,
    cell: (s) => s.enrollments[0]?.rollNo ?? "–",
    hideBelow: "sm",
  },
  { id: "guardian", header: "Guardian", sortValue: (s) => s.guardians[0]?.guardian.name ?? "", cell: (s) => s.guardians[0]?.guardian.name ?? "–", hideBelow: "md" },
  {
    id: "phone",
    header: "Phone",
    cell: (s) =>
      s.guardians[0] ? (
        <a href={`tel:${s.guardians[0].guardian.phone}`} className="tabular-nums text-fg-secondary hover:text-brand">
          {s.guardians[0].guardian.phone}
        </a>
      ) : (
        "–"
      ),
    hideBelow: "lg",
  },
  { id: "status", header: "Status", sortValue: (s) => s.status, cell: (s) => <StatusPill status={s.status} />, hideBelow: "sm" },
];

/**
 * The simple class list for teachers and office staff (the admin directory with
 * fees and attendance is for setup roles and accountants only).
 */
export function StudentList() {
  const router = useRouter();
  const sections = useSectionOptions();
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const params = new URLSearchParams({
    ...(sectionId ? { sectionId } : classId ? { classId } : {}),
    ...(query && { search: query }),
    ...(status !== "ACTIVE" && { status }),
  }).toString();
  const students = useApi<StudentRow[]>(`/students?${params}`);

  // Search runs on the server; wait for a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const multiCampus = new Set(sections.classes.map((c) => c.campus.name)).size > 1;
  const classOptions = sections.classes.map((c) => ({ value: c.id, label: multiCampus ? `${c.name}, ${c.campus.name}` : c.name }));
  const sectionOptions = sections.options.filter((o) => !classId || o.classId === classId);
  const filtered = !!(classId || sectionId || status !== "ACTIVE");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Students"
        description={
          students.data
            ? `${students.data.length.toLocaleString("en-PK")} ${status === "ACTIVE" ? "active" : status.toLowerCase()} student${students.data.length === 1 ? "" : "s"}${filtered ? " in this view" : ""}.`
            : "Students in your classes."
        }
        breadcrumbs={[{ label: "People" }, { label: "Students" }]}
      />
      <DataTable
        label="Students"
        columns={columns}
        data={students.data}
        getRowId={(s) => s.id}
        error={students.error}
        onRetry={students.reload}
        search={search}
        onSearchChange={setSearch}
        manualFiltering
        searchPlaceholder="Search name, admission no. or phone"
        filters={
          <>
            <NativeSelect
              aria-label="Class"
              placeholder="All classes"
              options={classOptions}
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
              wrapperClassName="w-40"
            />
            <NativeSelect
              aria-label="Section"
              placeholder="All sections"
              options={sectionOptions}
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              wrapperClassName="w-44"
            />
            <NativeSelect aria-label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} wrapperClassName="w-36" />
          </>
        }
        filtered={filtered || !!query}
        defaultSort={{ id: "name", dir: "asc" }}
        empty={{ title: "No students yet", description: "Students appear here once the office enrols them." }}
        onRowClick={(s) => router.push(`/students/${s.id}`)}
        getRowLabel={(s) => fullName(s)}
      />
    </div>
  );
}
