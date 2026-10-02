"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { StudentLibrary } from "@/components/student-library";
import { StudentTransport } from "@/components/student-transport";
import { Badge, Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day, fullName, rupees } from "@/lib/format";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Profile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dateOfBirth: string | null;
  bFormNo: string | null;
  address: string | null;
  medicalNotes: string | null;
  status: string;
  admittedOn: string;
  campus: { name: string };
  guardians: {
    relation: string;
    isPrimary: boolean;
    guardianId: string;
    guardian: { name: string; phone: string; cnic: string | null; userId: string | null };
  }[];
  enrollments: { id: string; rollNo: number | null; status: string; academicYear: { name: string }; section: { name: string; class: { name: string } } }[];
  invoices: { id: string; period: string; total: number; paid: number; status: string }[];
  attendanceSummary: Record<string, number>;
}

const statusTone = (s: string) => (s === "PAID" ? "green" : s === "PARTIAL" ? "amber" : s === "UNPAID" ? "red" : "gray");

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const student = useApi<Profile>(`/students/${id}`);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const s = student.data;

  async function invite(guardianId: string) {
    try {
      const res = await api<{ usesExistingLogin: boolean }>(`/students/${id}/guardians/${guardianId}/invite`, { method: "POST" });
      setMessage(res.usesExistingLogin ? "This guardian already had a login; parent access was added." : "Login details sent to the guardian on WhatsApp.");
      await student.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!s) return <ErrorText>{student.error}</ErrorText>;
  const att = s.attendanceSummary;
  const marked = Object.values(att).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle action={<Badge tone={s.status === "ACTIVE" ? "green" : "gray"}>{s.status.toLowerCase()}</Badge>}>
        {fullName(s)}
      </PageTitle>
      <Notice>{message}</Notice>
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="opacity-60">Admission no.</dt><dd className="font-mono">{s.admissionNo}</dd>
            <dt className="opacity-60">Campus</dt><dd>{s.campus.name}</dd>
            <dt className="opacity-60">Gender</dt><dd>{s.gender.toLowerCase()}</dd>
            <dt className="opacity-60">Date of birth</dt><dd>{s.dateOfBirth ? day(s.dateOfBirth) : "–"}</dd>
            <dt className="opacity-60">B-Form</dt><dd>{s.bFormNo ?? "–"}</dd>
            <dt className="opacity-60">Admitted</dt><dd>{day(s.admittedOn)}</dd>
            <dt className="opacity-60">Address</dt><dd>{s.address ?? "–"}</dd>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Guardians</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {s.guardians.map((g) => (
              <li key={g.guardianId} className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{g.guardian.name} {g.isPrimary && <Badge tone="blue">primary</Badge>}</div>
                  <div className="opacity-70">{g.relation} · {g.guardian.phone}</div>
                </div>
                {hasRole(user, SETUP) &&
                  (g.guardian.userId ? (
                    <Badge tone="green">has login</Badge>
                  ) : (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => invite(g.guardianId)}>
                      Invite to parent app
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Attendance (all time)</h2>
          {marked ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Present: <strong>{(att.PRESENT ?? 0) + (att.LATE ?? 0)}</strong></div>
              <div>Absent: <strong>{att.ABSENT ?? 0}</strong></div>
              <div>Leave: <strong>{att.LEAVE ?? 0}</strong></div>
              <div>Rate: <strong>{Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / marked) * 100)}%</strong></div>
            </div>
          ) : (
            <p className="text-sm opacity-60">No attendance marked yet.</p>
          )}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Class history</h2>
          <table className={tableClass}>
            <thead className="opacity-60"><tr><th className="py-2">Year</th><th>Class</th><th>Roll</th><th>Status</th></tr></thead>
            <tbody>
              {s.enrollments.map((e) => (
                <tr key={e.id} className={rowClass}>
                  <td className="py-2">{e.academicYear.name}</td>
                  <td>{e.section.class.name} {e.section.name}</td>
                  <td>{e.rollNo ?? "–"}</td>
                  <td>{e.status.toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {hasRole(user, FEES) && (
          <Card>
            <h2 className="mb-3 font-semibold">Fees</h2>
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Month</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>
                {s.invoices.map((i) => (
                  <tr key={i.id} className={rowClass}>
                    <td className="py-2"><Link className="text-brand" href={`/fees/invoices/${i.id}`}>{i.period}</Link></td>
                    <td>{rupees(i.total)}</td>
                    <td>{rupees(i.paid)}</td>
                    <td><Badge tone={statusTone(i.status)}>{i.status.toLowerCase()}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.invoices.length === 0 && <p className="text-sm opacity-60">No invoices yet.</p>}
          </Card>
        )}
        {user.plan?.features.includes("transport") !== false && (
          <StudentTransport studentId={s.id} active={s.status === "ACTIVE"} />
        )}
        {user.plan?.features.includes("library") !== false && <StudentLibrary studentId={s.id} />}
      </div>
    </div>
  );
}
