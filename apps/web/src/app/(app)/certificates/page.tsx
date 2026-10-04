"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Award, BadgeCheck, FilePlus2, IdCard, Printer, Scissors, Users } from "lucide-react";
import { Select } from "@/components/select";
import {
  Avatar,
  buttonClass,
  Card,
  CardHeader,
  DataTable,
  ErrorState,
  NativeSelect,
  PageHeader,
  Skeleton,
  StatusPill,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/ui";
import { CERTIFICATE_SHORT, type CertificateRow, type CertificateType } from "@/lib/certificates";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "issued" | "students" | "staff";

/** The certificate register and the way into printing ID cards. */
export default function CertificatesPage() {
  const user = useSession();
  const canIssue = hasRole(user, SETUP);
  const [tab, setTab] = useState<Tab>("issued");
  const tabs = [
    { value: "issued", label: "Certificates issued", icon: <Award /> },
    { value: "students", label: "Student ID cards", icon: <IdCard /> },
    ...(canIssue ? [{ value: "staff", label: "Staff ID cards", icon: <Users /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Certificates and ID cards"
        description="Leaving, character and enrolment certificates, each with a code anyone can check online, and printable ID cards."
        breadcrumbs={[{ label: "Students" }, { label: "Certificates" }]}
        actions={
          canIssue && (
            <Link href="/certificates/new" className={buttonClass("primary")}>
              <FilePlus2 aria-hidden />
              Issue a certificate
            </Link>
          )
        }
      />
      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)} aria-label="Certificates and ID cards">
        <TabPanel value="issued">
          <Register />
        </TabPanel>
        <TabPanel value="students">
          <StudentCards />
        </TabPanel>
        {canIssue && (
          <TabPanel value="staff">
            <StaffCards />
          </TabPanel>
        )}
      </Tabs>
    </div>
  );
}

function Register() {
  const [type, setType] = useState<"" | CertificateType>("");
  const [search, setSearch] = useState("");
  const q = search.trim();
  const params = new URLSearchParams({ ...(type ? { type } : {}), ...(q.length >= 2 ? { search: q } : {}) });
  const rows = useApi<CertificateRow[]>(`/certificates?${params}`);

  const columns: Column<CertificateRow>[] = [
    {
      id: "serial",
      header: "Serial No.",
      sortValue: (c) => c.serialNo,
      cell: (c) => (
        <Link className="font-mono text-[13px] font-medium text-brand hover:underline" href={`/certificates/${c.id}`}>
          {c.serialNo}
        </Link>
      ),
    },
    { id: "kind", header: "Kind", sortValue: (c) => CERTIFICATE_SHORT[c.type], cell: (c) => CERTIFICATE_SHORT[c.type] },
    {
      id: "student",
      header: "Student",
      sortValue: (c) => c.student.name,
      cell: (c) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={c.student.name} size="xs" />
          <span className="min-w-0">
            <Link className="block font-medium text-fg hover:text-brand" href={`/students/${c.student.id}`}>
              {c.student.name}
            </Link>
            <span className="text-xs text-fg-muted">{c.student.admissionNo}</span>
          </span>
        </span>
      ),
    },
    { id: "class", header: "Class", cell: (c) => c.className ?? <span className="text-fg-muted">Not recorded</span>, hideBelow: "md" },
    { id: "issued", header: "Issued", align: "right", sortValue: (c) => new Date(c.issuedOn), cell: (c) => day(c.issuedOn) },
    { id: "by", header: "By", cell: (c) => <span className="text-fg-secondary">{c.issuedBy}</span>, hideBelow: "lg" },
    {
      id: "status",
      header: "Status",
      cell: (c) => (c.cancelled ? <StatusPill status="CANCELLED" tone="danger" /> : <StatusPill status="VALID" tone="success" />),
    },
  ];

  return (
    <DataTable
      label="Certificates issued"
      columns={columns}
      data={rows.data}
      getRowId={(c) => c.id}
      error={rows.error}
      onRetry={rows.reload}
      search={search}
      onSearchChange={setSearch}
      manualFiltering
      searchPlaceholder="Search by student, admission or serial number"
      filters={
        <NativeSelect
          aria-label="Kind of certificate"
          placeholder="All kinds"
          value={type}
          onChange={(e) => setType(e.target.value as "" | CertificateType)}
          options={(Object.keys(CERTIFICATE_SHORT) as CertificateType[]).map((t) => ({ value: t, label: CERTIFICATE_SHORT[t] }))}
          wrapperClassName="w-44"
        />
      }
      filtered={!!type || q.length >= 2}
      defaultSort={{ id: "issued", dir: "desc" }}
      empty={{
        icon: <Award />,
        title: q || type ? "No certificates match" : "No certificates issued yet",
        description: q || type ? "Try another name, number or kind." : "Certificates you issue are listed here with their serial numbers.",
      }}
    />
  );
}

function PrintSteps({ steps }: { steps: { icon: ReactNode; text: string }[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.text} className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand [&_svg]:size-4" aria-hidden>
            {s.icon}
          </span>
          <span className="text-[13px] text-fg-secondary">
            <span className="font-medium text-fg">Step {i + 1}. </span>
            {s.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StudentCards() {
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  return (
    <Card>
      <CardHeader
        icon={<IdCard />}
        title="Student ID cards"
        description="Cards print ten to an A4 sheet, credit-card size, with the student's photo where one is on record, class, roll number and a parent's phone."
      />
      <PrintSteps
        steps={[
          { icon: <Users />, text: "Choose the class to make cards for." },
          { icon: <Printer />, text: "Print at actual size (100%), not fit to page." },
          { icon: <Scissors />, text: "Cut out and laminate, or send the sheet to a card printer." },
        ]}
      />
      <div className="mt-5 flex flex-wrap items-end gap-3">
        {sections.error ? (
          <ErrorState message={sections.error} compact className="w-full" />
        ) : (
          <div className="w-full sm:w-64">
            <Select label="Class" value={sectionId} onChange={(e) => setSectionId(e.target.value)} options={[{ value: "", label: "Choose a class" }, ...sections.options]} />
          </div>
        )}
        {sectionId && (
          <Link href={`/certificates/id-cards?sectionId=${sectionId}`} className={buttonClass("primary")}>
            <Printer aria-hidden />
            Show cards to print
          </Link>
        )}
      </div>
      <p className="mt-3 text-xs text-fg-muted">For one student, use &ldquo;ID card&rdquo; on their page.</p>
    </Card>
  );
}

function StaffCards() {
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const [campusId, setCampusId] = useState("");
  return (
    <Card>
      <CardHeader icon={<BadgeCheck />} title="Staff ID cards" description="Cards for everyone on the payroll, with their employee number and designation." />
      {campuses.error ? (
        <ErrorState message={campuses.error} onRetry={campuses.reload} compact />
      ) : !campuses.data ? (
        <Skeleton className="h-9 w-64" />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {campuses.data.length > 1 && (
            <div className="w-full sm:w-64">
              <Select
                label="Campus"
                value={campusId}
                onChange={(e) => setCampusId(e.target.value)}
                options={[{ value: "", label: "Every campus" }, ...campuses.data.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
          )}
          <Link href={`/certificates/id-cards?staff=1${campusId ? `&campusId=${campusId}` : ""}`} className={buttonClass("primary")}>
            <Printer aria-hidden />
            Show cards to print
          </Link>
        </div>
      )}
    </Card>
  );
}
