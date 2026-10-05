"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Save } from "lucide-react";
import { Select } from "@/components/select";
import {
  Alert,
  Avatar,
  Button,
  DataTable,
  Drawer,
  Field,
  NativeSelect,
  PageHeader,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  status: string;
  enrollments: { rollNo: number | null; section: { name: string; class: { name: string } } }[];
  guardians: { guardian: { name: string; phone: string } }[];
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "LEFT", label: "Left" },
  { value: "GRADUATED", label: "Graduated" },
  { value: "SUSPENDED", label: "Suspended" },
];
const FORM_ID = "new-student-form";

const classOf = (s: StudentRow) => (s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}` : "");

export default function StudentsPage() {
  const user = useSession();
  const router = useRouter();
  const toast = useToast();
  const canEdit = hasRole(user, SETUP);
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
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Search runs on the server; wait for a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const multiCampus = new Set(sections.classes.map((c) => c.campus.name)).size > 1;
  const classOptions = sections.classes.map((c) => ({ value: c.id, label: multiCampus ? `${c.name}, ${c.campus.name}` : c.name }));
  const sectionOptions = sections.options.filter((o) => !classId || o.classId === classId);
  const filtered = !!(classId || sectionId || status !== "ACTIVE");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setSaving(true);
    try {
      await api("/students", {
        method: "POST",
        body: {
          sectionId: f.get("sectionId"),
          firstName: f.get("firstName"),
          lastName: f.get("lastName") || undefined,
          gender: f.get("gender"),
          dateOfBirth: f.get("dateOfBirth") || undefined,
          bFormNo: f.get("bFormNo") || undefined,
          address: f.get("address") || undefined,
          guardians: [
            {
              name: f.get("guardianName"),
              phone: f.get("guardianPhone"),
              relation: f.get("relation"),
              cnic: f.get("cnic") || undefined,
              isPrimary: true,
            },
          ],
        },
      });
      formEl.reset();
      setError("");
      setAdding(false);
      toast.success("Student added", `${f.get("firstName")} is now enrolled.`);
      await students.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
    {
      id: "class",
      header: "Class",
      sortValue: (s) => classOf(s),
      cell: (s) => classOf(s) || <span className="text-fg-muted">Not enrolled</span>,
    },
    {
      id: "roll",
      header: "Roll",
      align: "right",
      width: "72px",
      sortValue: (s) => s.enrollments[0]?.rollNo ?? null,
      cell: (s) => s.enrollments[0]?.rollNo ?? "–",
      hideBelow: "sm",
    },
    {
      id: "guardian",
      header: "Guardian",
      sortValue: (s) => s.guardians[0]?.guardian.name ?? "",
      cell: (s) => s.guardians[0]?.guardian.name ?? "–",
      hideBelow: "md",
    },
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
    {
      id: "status",
      header: "Status",
      sortValue: (s) => s.status,
      cell: (s) => <StatusPill status={s.status} />,
      hideBelow: "sm",
    },
  ];

  const addButton = canEdit ? (
    <Button icon={<Plus />} onClick={() => setAdding(true)}>
      Add student
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Students"
        description={
          students.data
            ? `${students.data.length.toLocaleString("en-PK")} ${status === "ACTIVE" ? "active" : status.toLowerCase()} student${students.data.length === 1 ? "" : "s"}${filtered ? " in this view" : ""}.`
            : "Everyone enrolled at your school."
        }
        breadcrumbs={[{ label: "People" }, { label: "Students" }]}
        actions={addButton}
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
            <NativeSelect
              aria-label="Status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapperClassName="w-36"
            />
          </>
        }
        filtered={filtered || !!query}
        defaultSort={{ id: "name", dir: "asc" }}
        empty={{
          title: "No students yet",
          description: canEdit ? "Add your first student, or admit one from Admissions." : "Students appear here once the office enrols them.",
          action: addButton,
        }}
        onRowClick={(s) => router.push(`/students/${s.id}`)}
        getRowLabel={(s) => fullName(s)}
      />

      {canEdit && (
        <Drawer
          open={adding}
          onOpenChange={(o) => {
            setAdding(o);
            if (!o) setError("");
          }}
          title="New student"
          description="Enrol a student into a section. The admission number is assigned automatically."
          size="lg"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" form={FORM_ID} loading={saving} icon={<Save />}>
                Save student
              </Button>
            </>
          }
        >
          <form id={FORM_ID} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
            <p className="col-span-full text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Student</p>
            <div className="sm:col-span-full">
              <Select label="Class and section" name="sectionId" required options={sections.options} />
            </div>
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" />
            <Select
              label="Gender"
              name="gender"
              options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]}
            />
            <Field label="Date of birth" name="dateOfBirth" type="date" />
            <Field label="B-Form number" name="bFormNo" />
            <Field label="Address" name="address" />
            <p className="col-span-full mt-2 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Primary guardian</p>
            <Field label="Guardian name" name="guardianName" required />
            <Field label="Guardian phone (WhatsApp)" name="guardianPhone" type="tel" placeholder="03001234567" required />
            <Select
              label="Relation"
              name="relation"
              options={["Father", "Mother", "Guardian", "Uncle", "Grandparent"].map((r) => ({ value: r, label: r }))}
            />
            <Field label="Guardian CNIC" name="cnic" placeholder="35202-1234567-1" />
            {error && (
              <Alert tone="danger" className="col-span-full">
                {error}
              </Alert>
            )}
          </form>
        </Drawer>
      )}
    </div>
  );
}
