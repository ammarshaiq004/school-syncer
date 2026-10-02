"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Button, Card, ErrorText, Field, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import {
  CERTIFICATE_SHORT,
  CERTIFICATE_TITLE,
  CONDUCT,
  type Certificate,
  type CertificateDetails,
  type CertificateType,
} from "@/lib/certificates";
import { day, fullName, rupees, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Draft {
  details: CertificateDetails;
  status: string;
  duesOwed: number;
  booksOut: string[];
  issued: { id: string; type: CertificateType; serialNo: string; issuedOn: string; cancelled: boolean }[];
}

interface StudentHit {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
  enrollments: { section: { name: string; class: { name: string } } }[];
}

const TYPES: CertificateType[] = ["LEAVING", "CHARACTER", "ENROLMENT"];

/** Pick a student, then fill in and issue a certificate for them. */
export default function NewCertificatePage() {
  return (
    <Suspense>
      <NewCertificate />
    </Suspense>
  );
}

function NewCertificate() {
  const query = useSearchParams();
  const [studentId, setStudentId] = useState(() => query.get("studentId") ?? "");
  const [type, setType] = useState<CertificateType>(() => {
    const t = query.get("type");
    return TYPES.includes(t as CertificateType) ? (t as CertificateType) : "LEAVING";
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Issue a certificate</PageTitle>
      {studentId ? (
        <IssueForm key={studentId} studentId={studentId} type={type} onType={setType} onChangeStudent={() => setStudentId("")} />
      ) : (
        <StudentPicker onPick={setStudentId} />
      )}
    </div>
  );
}

function StudentPicker({ onPick }: { onPick: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const hits = useApi<StudentHit[]>(q.length >= 2 ? `/students?search=${encodeURIComponent(q)}` : null);
  return (
    <Card>
      <Field label="Find the student" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, admission number or parent's phone" autoFocus />
      <ErrorText>{hits.error}</ErrorText>
      {q.length >= 2 && hits.data && (
        <ul className="mt-3 divide-y divide-black/5 text-sm dark:divide-white/10">
          {hits.data.slice(0, 12).map((s) => (
            <li key={s.id}>
              <button className="flex w-full justify-between gap-3 py-2 text-left hover:text-brand" onClick={() => onPick(s.id)}>
                <span>{fullName(s)}</span>
                <span className="opacity-60">
                  {s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name} · ` : ""}
                  {s.admissionNo}
                </span>
              </button>
            </li>
          ))}
          {hits.data.length === 0 && <li className="py-2 opacity-60">No students on the rolls match. Students who have left can be found from the Students page.</li>}
        </ul>
      )}
    </Card>
  );
}

function IssueForm({
  studentId,
  type,
  onType,
  onChangeStudent,
}: {
  studentId: string;
  type: CertificateType;
  onType: (t: CertificateType) => void;
  onChangeStudent: () => void;
}) {
  const router = useRouter();
  const draft = useApi<Draft>(`/certificates/students/${studentId}/draft`);
  const [allowDues, setAllowDues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = draft.data;

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    setBusy(true);
    try {
      const created = await api<Certificate>("/certificates", {
        method: "POST",
        body: {
          studentId,
          type,
          issuedOn: text("issuedOn"),
          conduct: text("conduct"),
          remarks: text("remarks") ?? null,
          ...(type === "LEAVING" ? { leavingOn: text("leavingOn"), reason: text("reason") ?? null, allowDues } : {}),
        },
      });
      router.push(`/certificates/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!d) return <ErrorText>{draft.error}</ErrorText>;
  const openLeaving = d.issued.find((c) => c.type === "LEAVING" && !c.cancelled);
  const blocked =
    type === "LEAVING"
      ? openLeaving
        ? `A leaving certificate (${openLeaving.serialNo}) was already issued. Cancel it first to issue a corrected one.`
        : d.booksOut.length
          ? `Library books still out: ${d.booksOut.join(", ")}. They need to be returned (or marked lost) first.`
          : null
      : type === "ENROLMENT" && d.status !== "ACTIVE"
        ? `${d.details.studentName} is not on the rolls now, so an enrolment certificate doesn't apply. A character certificate does.`
        : null;
  const today = todayIso();

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-lg font-semibold">
              <Link href={`/students/${studentId}`} className="text-brand">{d.details.studentName}</Link>
            </div>
            <div className="text-sm opacity-70">
              {[d.details.className, d.details.admissionNo, d.details.guardianName && `${d.details.guardianRelation ?? "Guardian"}: ${d.details.guardianName}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {d.status !== "ACTIVE" && <div className="text-sm opacity-70">Status: {d.status.toLowerCase()}</div>}
          </div>
          <button className="text-sm text-brand" onClick={onChangeStudent}>Choose another student</button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Certificate">
          {TYPES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={type === t}
              onClick={() => onType(t)}
              className={`rounded-full border px-4 py-1.5 text-sm ${type === t ? "border-brand bg-brand/10 font-medium text-brand" : "border-black/15 dark:border-white/20"}`}
            >
              {CERTIFICATE_SHORT[t]}
            </button>
          ))}
        </div>

        <form onSubmit={issue} className="flex flex-col gap-3">
          <h2 className="font-semibold">{CERTIFICATE_TITLE[type]}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date of issue" name="issuedOn" type="date" defaultValue={today} max={today} required />
            <Select label="Conduct and character" name="conduct" defaultValue="Good" options={CONDUCT.map((c) => ({ value: c, label: c }))} />
            {type === "LEAVING" && (
              <>
                <Field label="Date of leaving" name="leavingOn" type="date" defaultValue={today} required />
                <Field label="Reason for leaving" name="reason" placeholder="Family moved to Islamabad" maxLength={200} />
              </>
            )}
          </div>
          <Field
            label={type === "LEAVING" ? "Remarks (optional)" : "Issued for (optional)"}
            name="remarks"
            maxLength={300}
            placeholder={type === "LEAVING" ? "Passed the annual examination" : "a passport application"}
          />

          {type === "LEAVING" && d.duesOwed > 0 && !blocked && (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <input type="checkbox" className="mt-1" checked={allowDues} onChange={(e) => setAllowDues(e.target.checked)} />
              <span>
                {rupees(d.duesOwed)} in fees is still owed. Tick to issue anyway; the certificate will show the amount outstanding.
              </span>
            </label>
          )}
          {type === "LEAVING" && !blocked && (
            <p className="text-sm opacity-70">
              Issuing it takes {d.details.studentName} off the rolls: out of {d.details.className ?? "their class"}, off the school van from the leaving date, and no more fee vouchers.
            </p>
          )}
          {blocked && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">{blocked}</p>}
          <ErrorText>{error}</ErrorText>
          <div>
            <Button type="submit" disabled={busy || Boolean(blocked) || (type === "LEAVING" && d.duesOwed > 0 && !allowDues)}>
              {busy ? "Issuing..." : `Issue ${CERTIFICATE_SHORT[type].toLowerCase()} certificate`}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">From the school record</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="opacity-60">Date of birth</dt>
          <dd>{d.details.dateOfBirth ? day(d.details.dateOfBirth) : "not recorded"}</dd>
          <dt className="opacity-60">Admitted</dt>
          <dd>{day(d.details.admittedOn)}{d.details.classAdmitted ? `, ${d.details.classAdmitted}` : ""}</dd>
          <dt className="opacity-60">Campus</dt>
          <dd>{d.details.campus}</dd>
          <dt className="opacity-60">Fees owed</dt>
          <dd>{d.duesOwed ? rupees(d.duesOwed) : "none"}</dd>
          <dt className="opacity-60">Library</dt>
          <dd>{d.booksOut.length ? `${d.booksOut.length} book${d.booksOut.length > 1 ? "s" : ""} out` : "nothing out"}</dd>
        </dl>
        {!d.details.dateOfBirth && (
          <p className="mt-2 text-xs opacity-60">Add the date of birth on the student&apos;s page first if it should appear on the certificate.</p>
        )}
        {d.issued.length > 0 && (
          <>
            <h3 className="mb-1 mt-4 text-sm font-semibold">Issued before</h3>
            <ul className="space-y-1 text-sm">
              {d.issued.map((c) => (
                <li key={c.id}>
                  <Link className="text-brand" href={`/certificates/${c.id}`}>{c.serialNo}</Link>{" "}
                  <span className="opacity-60">{CERTIFICATE_SHORT[c.type].toLowerCase()}, {day(c.issuedOn)}{c.cancelled ? ", cancelled" : ""}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
