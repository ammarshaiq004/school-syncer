"use client";

import Link from "next/link";
import { useState } from "react";
import { Select } from "@/components/select";
import { Badge, Card, ErrorText, PageTitle, rowClass, tableClass } from "@/components/ui";
import { CERTIFICATE_SHORT, type CertificateRow, type CertificateType } from "@/lib/certificates";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "issued" | "students" | "staff";
const inputClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

/** The certificate register and the way into printing ID cards. */
export default function CertificatesPage() {
  const user = useSession();
  const canIssue = hasRole(user, SETUP);
  const [tab, setTab] = useState<Tab>("issued");
  const tabs: [Tab, string][] = [
    ["issued", "Certificates issued"],
    ["students", "Student ID cards"],
    ...(canIssue ? ([["staff", "Staff ID cards"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        action={
          canIssue && (
            <Link href="/certificates/new" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
              Issue a certificate
            </Link>
          )
        }
      >
        Certificates and ID cards
      </PageTitle>
      <div className="flex gap-1 border-b border-black/10 dark:border-white/10">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "issued" && <Register />}
      {tab === "students" && <StudentCards />}
      {tab === "staff" && <StaffCards />}
    </div>
  );
}

function Register() {
  const [type, setType] = useState<"" | CertificateType>("");
  const [search, setSearch] = useState("");
  const q = search.trim();
  const params = new URLSearchParams({ ...(type ? { type } : {}), ...(q.length >= 2 ? { search: q } : {}) });
  const rows = useApi<CertificateRow[]>(`/certificates?${params}`);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inputClass} min-w-64 flex-1`} placeholder="Search by student, admission or serial number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search certificates" />
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as "" | CertificateType)} aria-label="Kind of certificate">
          <option value="">All kinds</option>
          {(Object.keys(CERTIFICATE_SHORT) as CertificateType[]).map((t) => (
            <option key={t} value={t}>{CERTIFICATE_SHORT[t]}</option>
          ))}
        </select>
      </div>
      <ErrorText>{rows.error}</ErrorText>
      {rows.data && rows.data.length === 0 ? (
        <p className="text-sm opacity-60">No certificates {q || type ? "match" : "issued yet"}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">Serial No.</th><th>Kind</th><th>Student</th><th>Class</th><th>Issued</th><th>By</th><th /></tr>
            </thead>
            <tbody>
              {rows.data?.map((c) => (
                <tr key={c.id} className={rowClass}>
                  <td className="py-2"><Link className="font-mono text-brand" href={`/certificates/${c.id}`}>{c.serialNo}</Link></td>
                  <td>{CERTIFICATE_SHORT[c.type]}</td>
                  <td><Link className="hover:text-brand" href={`/students/${c.student.id}`}>{c.student.name}</Link> <span className="opacity-60">{c.student.admissionNo}</span></td>
                  <td>{c.className ?? "–"}</td>
                  <td>{day(c.issuedOn)}</td>
                  <td>{c.issuedBy}</td>
                  <td>{c.cancelled && <Badge tone="red">cancelled</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StudentCards() {
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  return (
    <Card>
      <p className="mb-4 text-sm opacity-70">
        Cards print ten to an A4 sheet, credit-card size, with the student&apos;s photo where one is on record, class, roll number and a parent&apos;s phone. Cut them out and laminate, or send the sheet to a card printer.
      </p>
      <ErrorText>{sections.error}</ErrorText>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <Select label="Class" value={sectionId} onChange={(e) => setSectionId(e.target.value)} options={[{ value: "", label: "Choose a class" }, ...sections.options]} />
        </div>
        {sectionId && (
          <Link href={`/certificates/id-cards?sectionId=${sectionId}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Show cards to print
          </Link>
        )}
      </div>
      <p className="mt-3 text-xs opacity-60">For one student, use &ldquo;ID card&rdquo; on their page.</p>
    </Card>
  );
}

function StaffCards() {
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const [campusId, setCampusId] = useState("");
  return (
    <Card>
      <p className="mb-4 text-sm opacity-70">Cards for everyone on the payroll, with their employee number and designation.</p>
      <ErrorText>{campuses.error}</ErrorText>
      <div className="flex flex-wrap items-end gap-3">
        {(campuses.data?.length ?? 0) > 1 && (
          <div className="min-w-56">
            <Select label="Campus" value={campusId} onChange={(e) => setCampusId(e.target.value)} options={[{ value: "", label: "Every campus" }, ...(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
        )}
        <Link href={`/certificates/id-cards?staff=1${campusId ? `&campusId=${campusId}` : ""}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          Show cards to print
        </Link>
      </div>
    </Card>
  );
}
