"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ArrowLeftRight, ChevronRight, FileText, History, Search, UserRound } from "lucide-react";
import { Select } from "@/components/select";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DescriptionList,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Skeleton,
  SkeletonRows,
  StatusPill,
  TextField,
} from "@/components/ui";
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
      <PageHeader
        title="Issue a certificate"
        description={studentId ? "Check the details from the school record, then issue." : "Find the student the certificate is for."}
        breadcrumbs={[{ label: "Certificates", href: "/certificates" }, { label: "Issue a certificate" }]}
      />
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
    <Card className="max-w-2xl">
      <CardHeader icon={<Search />} title="Find the student" description="Type at least two letters of the name, admission number or a parent's phone." />
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch("")}
        placeholder="Name, admission number or parent's phone"
        aria-label="Find the student"
        autoFocus
      />
      <div className="mt-3">
        {q.length < 2 ? null : hits.error ? (
          <ErrorState message={hits.error} onRetry={hits.reload} compact />
        ) : !hits.data ? (
          <SkeletonRows rows={3} columns={2} />
        ) : hits.data.length === 0 ? (
          <EmptyState
            icon={<UserRound />}
            title="No students on the rolls match"
            description="Students who have left can be found from the Students page."
            compact
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {hits.data.slice(0, 12).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  onClick={() => onPick(s.id)}
                >
                  <Avatar name={fullName(s)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{fullName(s)}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}, ` : ""}
                      {s.admissionNo}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-fg-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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

  if (!d) {
    if (draft.error) {
      return (
        <Card padding="none">
          <ErrorState message={draft.error} onRetry={draft.reload} />
        </Card>
      );
    }
    return (
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <Skeleton className="mb-3 h-6 w-48" />
          <SkeletonRows rows={4} columns={2} />
        </Card>
        <Card>
          <SkeletonRows rows={5} columns={2} />
        </Card>
      </div>
    );
  }
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
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={d.details.studentName} size="md" />
            <div className="min-w-0">
              <Link href={`/students/${studentId}`} className="text-base font-semibold text-fg hover:text-brand">
                {d.details.studentName}
              </Link>
              <div className="text-[13px] text-fg-muted">
                {[d.details.className, d.details.admissionNo, d.details.guardianName && `${d.details.guardianRelation ?? "Guardian"}: ${d.details.guardianName}`]
                  .filter(Boolean)
                  .join(", ")}
              </div>
              {d.status !== "ACTIVE" && (
                <div className="mt-1">
                  <StatusPill status={d.status} />
                </div>
              )}
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" icon={<ArrowLeftRight />} onClick={onChangeStudent}>
            Choose another student
          </Button>
        </div>

        <SegmentedControl
          aria-label="Certificate"
          size="md"
          value={type}
          onChange={onType}
          options={TYPES.map((t) => ({ value: t, label: CERTIFICATE_SHORT[t] }))}
          className="mb-5"
        />

        <form onSubmit={issue} className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-fg">{CERTIFICATE_TITLE[type]}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Date of issue" name="issuedOn" type="date" defaultValue={today} max={today} required />
            <Select label="Conduct and character" name="conduct" defaultValue="Good" options={CONDUCT.map((c) => ({ value: c, label: c }))} />
            {type === "LEAVING" && (
              <>
                <TextField label="Date of leaving" name="leavingOn" type="date" defaultValue={today} required />
                <TextField label="Reason for leaving" name="reason" placeholder="Family moved to Islamabad" maxLength={200} />
              </>
            )}
          </div>
          <TextField
            label={type === "LEAVING" ? "Remarks (optional)" : "Issued for (optional)"}
            name="remarks"
            maxLength={300}
            placeholder={type === "LEAVING" ? "Passed the annual examination" : "a passport application"}
          />

          {type === "LEAVING" && d.duesOwed > 0 && !blocked && (
            <Alert tone="warning" title={`${rupees(d.duesOwed)} in fees is still owed`}>
              <Checkbox
                checked={allowDues}
                onCheckedChange={setAllowDues}
                label="Issue anyway; the certificate will show the amount outstanding."
                className="mt-1 items-start text-inherit"
              />
            </Alert>
          )}
          {type === "LEAVING" && !blocked && (
            <Alert tone="info">
              Issuing it takes {d.details.studentName} off the rolls: out of {d.details.className ?? "their class"}, off the school van from the leaving date, and no more fee vouchers.
            </Alert>
          )}
          {blocked && <Alert tone="danger">{blocked}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end">
            <Button
              type="submit"
              icon={<FileText />}
              loading={busy}
              disabled={busy || Boolean(blocked) || (type === "LEAVING" && d.duesOwed > 0 && !allowDues)}
            >
              {busy ? "Issuing" : `Issue ${CERTIFICATE_SHORT[type].toLowerCase()} certificate`}
            </Button>
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader icon={<UserRound />} title="From the school record" />
          <DescriptionList
            columns={1}
            items={[
              { label: "Date of birth", value: d.details.dateOfBirth ? day(d.details.dateOfBirth) : "Not recorded" },
              { label: "Admitted", value: `${day(d.details.admittedOn)}${d.details.classAdmitted ? `, ${d.details.classAdmitted}` : ""}` },
              { label: "Campus", value: d.details.campus },
              {
                label: "Fees owed",
                value: d.duesOwed ? <span className="font-medium text-warning-text tabular-nums">{rupees(d.duesOwed)}</span> : "None",
              },
              { label: "Library", value: d.booksOut.length ? `${d.booksOut.length} book${d.booksOut.length > 1 ? "s" : ""} out` : "Nothing out" },
            ]}
          />
          {!d.details.dateOfBirth && (
            <p className="mt-3 text-xs text-fg-muted">Add the date of birth on the student&apos;s page first if it should appear on the certificate.</p>
          )}
        </Card>
        <Card>
          <CardHeader icon={<History />} title="Issued before" />
          {d.issued.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No certificates issued for this student yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.issued.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link className="font-mono text-[13px] font-medium text-brand hover:underline" href={`/certificates/${c.id}`}>
                      {c.serialNo}
                    </Link>
                    <span className="block text-xs text-fg-muted">
                      {CERTIFICATE_SHORT[c.type]}, {day(c.issuedOn)}
                    </span>
                  </span>
                  {c.cancelled ? <StatusPill status="CANCELLED" tone="danger" /> : <StatusPill status="VALID" tone="success" />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
