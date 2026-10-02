"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Button, Card, ErrorText, Field, PageTitle, rowClass, tableClass } from "@/components/ui";
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
  enrollments: { rollNo: number | null; section: { name: string; class: { name: string } } }[];
  guardians: { guardian: { name: string; phone: string } }[];
}

export default function StudentsPage() {
  const user = useSession();
  const canEdit = hasRole(user, SETUP);
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ ...(sectionId && { sectionId }), ...(search && { search }) }).toString();
  const students = useApi<StudentRow[]>(`/students?${query}`);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
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
      await students.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle action={canEdit && <Button onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "Add student"}</Button>}>
        Students
      </PageTitle>

      {adding && (
        <Card>
          <h2 className="mb-4 font-semibold">New student</h2>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Class and section" name="sectionId" required options={sections.options} />
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" />
            <Select label="Gender" name="gender" options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]} />
            <Field label="Date of birth" name="dateOfBirth" type="date" />
            <Field label="B-Form number" name="bFormNo" />
            <Field label="Address" name="address" />
            <Field label="Guardian name" name="guardianName" required />
            <Field label="Guardian phone (WhatsApp)" name="guardianPhone" placeholder="03001234567" required />
            <Select label="Relation" name="relation" options={["Father", "Mother", "Guardian", "Uncle", "Grandparent"].map((r) => ({ value: r, label: r }))} />
            <Field label="Guardian CNIC" name="cnic" placeholder="35202-1234567-1" />
            <div className="flex items-end"><Button type="submit">Save student</Button></div>
          </form>
          <ErrorText>{error}</ErrorText>
        </Card>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            placeholder="Search name, admission no. or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-64 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          >
            <option value="">All sections</option>
            {sections.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <ErrorText>{students.error}</ErrorText>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">Adm. no.</th><th>Name</th><th>Class</th><th>Roll</th><th>Guardian</th><th>Phone</th></tr>
            </thead>
            <tbody>
              {students.data?.map((s) => (
                <tr key={s.id} className={rowClass}>
                  <td className="py-2 font-mono text-xs">{s.admissionNo}</td>
                  <td><Link className="font-medium text-brand" href={`/students/${s.id}`}>{fullName(s)}</Link></td>
                  <td>{s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}` : "–"}</td>
                  <td>{s.enrollments[0]?.rollNo ?? "–"}</td>
                  <td>{s.guardians[0]?.guardian.name ?? "–"}</td>
                  <td>{s.guardians[0]?.guardian.phone ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {students.data?.length === 0 && <p className="py-6 text-center text-sm opacity-60">No students found.</p>}
        </div>
      </Card>
    </div>
  );
}
