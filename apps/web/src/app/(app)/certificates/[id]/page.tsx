"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { QrCode } from "@/components/qr-code";
import { Award, Ban, Printer } from "lucide-react";
import { Alert, Button, Card, Dialog, ErrorState, PageHeader, Skeleton, StatusPill, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import {
  CERTIFICATE_TITLE,
  childOf,
  pronoun,
  verifyUrl,
  type Certificate,
  type CertificateDetails,
} from "@/lib/certificates";
import { day, rupees } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

/** One certificate, laid out for an A4 sheet. */
export default function CertificatePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const toast = useToast();
  const certificate = useApi<Certificate>(`/certificates/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = certificate.data;

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    setBusy(true);
    try {
      await api(`/certificates/${id}/cancel`, { method: "POST", body: { reason } });
      setCancelling(false);
      setError("");
      toast.success("Certificate cancelled", "Its code no longer verifies.");
      await certificate.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!c) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Certificate" breadcrumbs={[{ label: "Certificates", href: "/certificates" }, { label: "Certificate" }]} />
        {certificate.error ? (
          <Card padding="none">
            <ErrorState message={certificate.error} onRetry={certificate.reload} />
          </Card>
        ) : (
          <Card>
            <Skeleton className="mx-auto h-[60vh] w-full max-w-[210mm]" />
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${CERTIFICATE_TITLE[c.type]} ${c.serialNo}`}
        breadcrumbs={[{ label: "Certificates", href: "/certificates" }, { label: c.serialNo }]}
        leading={
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
            <Award className="size-5" />
          </span>
        }
        description={
          <>
            <Link className="font-medium text-brand hover:underline" href={`/students/${c.studentId}`}>{c.details.studentName}</Link>, issued {day(c.issuedOn)} by {c.issuedBy}
          </>
        }
        meta={c.cancelledAt ? <StatusPill status="CANCELLED" tone="danger" /> : <StatusPill status="VALID" tone="success" />}
        actions={
          <>
            {!c.cancelledAt && hasRole(user, SETUP) && (
              <Button type="button" variant="secondary" icon={<Ban />} onClick={() => setCancelling(true)}>
                Cancel certificate
              </Button>
            )}
            <Button type="button" icon={<Printer />} onClick={() => window.print()} disabled={Boolean(c.cancelledAt)}>
              Print
            </Button>
          </>
        }
      />
      {c.cancelledAt && (
        <Alert tone="danger" title={`Cancelled on ${day(c.cancelledAt)}`} className="print:hidden">
          {c.cancelReason}. Anyone checking code {c.verifyCode} is told it is no longer valid.
        </Alert>
      )}
      <Dialog
        open={cancelling}
        onOpenChange={(o) => {
          setCancelling(o);
          if (!o) setError("");
        }}
        title="Cancel this certificate?"
        description="The certificate stops verifying. The student's record is not changed; issue a corrected one if needed."
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)} disabled={busy}>
              Keep it
            </Button>
            <Button type="submit" form="cancel-certificate-form" variant="danger" loading={busy}>
              Cancel it
            </Button>
          </>
        }
      >
        <form id="cancel-certificate-form" onSubmit={cancel} className="flex flex-col gap-3">
          <TextField label="Why is it being cancelled?" name="reason" required minLength={3} placeholder="Wrong leaving date" autoFocus />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Dialog>

      <article className="relative mx-auto w-full max-w-[210mm] bg-white p-3 text-black shadow print:max-w-none print:p-0 print:shadow-none">
        <div className="flex min-h-[270mm] flex-col border-[3px] border-double border-black/70 p-4 sm:p-8 print:min-h-[277mm] print:p-8">
          {c.cancelledAt && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold uppercase tracking-widest text-red-600/20 -rotate-30">
              Cancelled
            </div>
          )}
          <header className="flex items-center gap-4 border-b border-black/30 pb-4">
            {c.school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.school.logoUrl} alt="" className="h-20 w-20 object-contain" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-black/60 text-2xl font-bold">
                {c.school.name.split(/\s+/).map((w) => w[0]).slice(0, 3).join("")}
              </div>
            )}
            <div className="flex-1 text-center">
              <div className="text-3xl font-bold tracking-wide">{c.school.name}</div>
              <div className="text-sm">
                {[
                  c.campus.address ?? c.campus.name,
                  c.school.city && !(c.campus.address ?? "").includes(c.school.city) ? c.school.city : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
              <div className="text-xs opacity-70">
                {[c.campus.phone ?? c.school.phone, c.school.email].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="w-20" />
          </header>

          <div className="mt-4 flex justify-between text-sm">
            <span>Serial No. <b>{c.serialNo}</b></span>
            <span>Date: <b>{day(c.issuedOn)}</b></span>
          </div>
          <h2 className="my-6 text-center font-serif text-3xl font-bold uppercase tracking-wider underline underline-offset-8">
            {CERTIFICATE_TITLE[c.type]}
          </h2>

          <div className="flex-1">
            {c.type === "LEAVING" ? <LeavingBody d={c.details} /> : <LetterBody type={c.type} d={c.details} />}
          </div>

          <footer className="mt-10">
            <div className="flex items-end justify-between gap-6 text-sm">
              <Signature>{c.type === "LEAVING" ? "Class teacher" : "Prepared by"}</Signature>
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-black/40 text-center text-[10px] opacity-60">
                School stamp
              </div>
              <Signature>Principal</Signature>
            </div>
            <div className="mt-6 flex items-center gap-3 border-t border-black/20 pt-3 text-[11px]">
              <QrCode value={verifyUrl(c.verifyCode)} size={64} />
              <p>
                To check this certificate is genuine, scan the code or visit <b>{verifyUrl("")}</b> and enter{" "}
                <b className="font-mono tracking-wider">{c.verifyCode}</b>.
              </p>
            </div>
          </footer>
        </div>
      </article>
    </div>
  );
}

function Signature({ children }: { children: ReactNode }) {
  return (
    <div className="w-44 text-center">
      <div className="border-t border-black/70 pt-1">{children}</div>
    </div>
  );
}

/** The numbered form most Pakistani schools use for leaving certificates. */
function LeavingBody({ d }: { d: CertificateDetails }) {
  const rows: [string, ReactNode][] = [
    ["Name of student", d.studentName],
    [`${d.guardianRelation === "Father" ? "Father’s" : "Guardian’s"} name`, d.guardianName ?? "–"],
    ["Admission No.", d.admissionNo],
    [
      "Date of birth",
      d.dateOfBirth ? (
        <>
          {day(d.dateOfBirth)}
          <div className="text-sm italic">({d.dateOfBirthWords})</div>
        </>
      ) : (
        "–"
      ),
    ],
    ["Date of admission", `${day(d.admittedOn)}${d.classAdmitted ? `, in ${d.classAdmitted}` : ""}`],
    ["Class at the time of leaving", [d.className, d.session && `session ${d.session}`].filter(Boolean).join(", ") || "–"],
    ["Date of leaving", d.leavingOn ? day(d.leavingOn) : "–"],
    ["Reason for leaving", d.reason || "–"],
    ["Conduct and character", d.conduct],
    ["School dues", d.duesOwed ? `${rupees(d.duesOwed)} outstanding` : "All dues cleared"],
    ["Remarks", d.remarks || "–"],
  ];
  return (
    <table className="w-full border-collapse text-[15px]">
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={label} className="align-top">
            <td className="w-6 py-2 sm:w-8">{i + 1}.</td>
            <td className="w-[40%] py-2 pe-2 sm:w-64 print:w-64">{label}</td>
            <td className="border-b border-dotted border-black/50 py-2 font-medium">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Character and enrolment certificates read as a short letter. */
function LetterBody({ type, d }: { type: "CHARACTER" | "ENROLMENT"; d: CertificateDetails }) {
  const p = pronoun(d.gender);
  const studying = d.status === "ACTIVE";
  const of = d.guardianName ? `, ${childOf(d.gender)} of ${d.guardianName},` : "";
  const dob = d.dateOfBirth
    ? ` ${p.His} date of birth as recorded by the school is ${day(d.dateOfBirth)} (${d.dateOfBirthWords}).`
    : "";
  return (
    <div className="space-y-5 font-serif text-[17px] leading-8">
      <p>To whom it may concern,</p>
      {type === "ENROLMENT" ? (
        <p>
          This is to certify that <b>{d.studentName}</b>{of} Admission No. <b>{d.admissionNo}</b>, is a bonafide student of
          this school, studying in <b>{d.className ?? "–"}</b>
          {d.session && <> in the {d.session} session</>}. {p.He} has been a student here since {day(d.admittedOn)}.{dob}
        </p>
      ) : (
        <p>
          This is to certify that <b>{d.studentName}</b>{of} Admission No. <b>{d.admissionNo}</b>, {studying ? "is" : "was"} a
          student of this school{d.className && <>, {studying ? "currently in" : "last in"} <b>{d.className}</b></>}. During{" "}
          {p.his} time here {p.his} conduct and character {studying ? "have been" : "were"} <b>{d.conduct.toLowerCase()}</b>.
          To the best of our knowledge {p.he} bears a good moral character.
        </p>
      )}
      {d.remarks && <p>It is issued at the parent&apos;s request for {d.remarks.replace(/^for\s+/i, "").replace(/\.$/, "")}.</p>}
      <p>We wish {p.he === "she" ? "her" : "him"} every success.</p>
    </div>
  );
}
