"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Award, Ban, Printer } from "lucide-react";
import { QrCode } from "@/components/qr-code";
import { Alert, Button, Card, Dialog, ErrorState, PageHeader, Skeleton, StatusPill, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { verifyUrl } from "@/lib/certificates";
import { day } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface StaffCertificate {
  id: string;
  serialNo: string;
  verifyCode: string;
  issuedOn: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  details: {
    staffName: string;
    employeeNo: string;
    designation: string;
    department: string | null;
    cnic: string | null;
    joinedOn: string;
    leftOn: string | null;
    conduct: string;
    remarks: string | null;
  };
  school: { name: string; city: string | null; phone: string | null; email: string | null; logoUrl: string | null };
  issuedBy: string;
}

/** One experience certificate, laid out for an A4 sheet. */
export default function StaffCertificatePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const toast = useToast();
  const certificate = useApi<StaffCertificate>(`/hr/experience-certificates/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = certificate.data;

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    setBusy(true);
    try {
      await api(`/hr/experience-certificates/${id}/cancel`, { method: "POST", body: { reason } });
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

  const crumbs = [{ label: "HR and payroll", href: "/hr" }, { label: "Experience certificate" }];
  if (!c) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Experience certificate" breadcrumbs={crumbs} />
        {certificate.error ? (
          <Card padding="none"><ErrorState message={certificate.error} onRetry={certificate.reload} /></Card>
        ) : (
          <Card><Skeleton className="mx-auto h-[60vh] w-full max-w-[210mm]" /></Card>
        )}
      </div>
    );
  }

  const d = c.details;
  const working = !d.leftOn;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Experience certificate ${c.serialNo}`}
        breadcrumbs={[crumbs[0], { label: c.serialNo }]}
        leading={<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden><Award className="size-5" /></span>}
        description={<>{d.staffName}, issued {day(c.issuedOn)} by {c.issuedBy}</>}
        meta={c.cancelledAt ? <StatusPill status="CANCELLED" tone="danger" /> : <StatusPill status="VALID" tone="success" />}
        actions={
          <>
            {!c.cancelledAt && hasRole(user, SETUP) && (
              <Button type="button" variant="secondary" icon={<Ban />} onClick={() => setCancelling(true)}>Cancel certificate</Button>
            )}
            <Button type="button" icon={<Printer />} onClick={() => window.print()} disabled={Boolean(c.cancelledAt)}>Print</Button>
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
        onOpenChange={(o) => { setCancelling(o); if (!o) setError(""); }}
        title="Cancel this certificate?"
        description="The certificate stops verifying. Issue a corrected one if needed."
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)} disabled={busy}>Keep it</Button>
            <Button type="submit" form="cancel-staff-certificate" variant="danger" loading={busy}>Cancel it</Button>
          </>
        }
      >
        <form id="cancel-staff-certificate" onSubmit={cancel} className="flex flex-col gap-3">
          <TextField label="Why is it being cancelled?" name="reason" required minLength={3} placeholder="Wrong last working day" autoFocus />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Dialog>

      <article className="relative mx-auto w-full max-w-[210mm] bg-white p-3 text-black shadow print:max-w-none print:p-0 print:shadow-none">
        <div className="flex min-h-[270mm] flex-col border-[3px] border-double border-black/70 p-4 sm:p-8 print:min-h-[277mm] print:p-8">
          {c.cancelledAt && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold uppercase tracking-widest text-red-600/20 -rotate-30">Cancelled</div>
          )}
          <header className="border-b border-black/30 pb-4 text-center">
            <div className="text-3xl font-bold tracking-wide">{c.school.name}</div>
            <div className="text-sm">{c.school.city}</div>
            <div className="text-xs opacity-70">{[c.school.phone, c.school.email].filter(Boolean).join(" · ")}</div>
          </header>
          <div className="mt-4 flex justify-between text-sm">
            <span>Serial No. <b>{c.serialNo}</b></span>
            <span>Date: <b>{day(c.issuedOn)}</b></span>
          </div>
          <h2 className="my-6 text-center font-serif text-3xl font-bold uppercase tracking-wider underline underline-offset-8">Experience Certificate</h2>
          <div className="flex-1 space-y-5 font-serif text-[17px] leading-8">
            <p>To whom it may concern,</p>
            <p>
              This is to certify that <b>{d.staffName}</b>
              {d.cnic && <>, CNIC <b>{d.cnic.length === 13 ? `${d.cnic.slice(0, 5)}-${d.cnic.slice(5, 12)}-${d.cnic.slice(12)}` : d.cnic}</b>,</>}{" "}
              {working ? "has been working" : "worked"} at this school as <b>{d.designation}</b>
              {d.department && <> in the {d.department} department</>} (Employee No. <b>{d.employeeNo}</b>) {working ? "since" : "from"} <b>{day(d.joinedOn)}</b>
              {!working && <> to <b>{day(d.leftOn!)}</b></>}. During {working ? "this time" : "that time"} the staff member’s conduct and performance {working ? "have been" : "were"} <b>{d.conduct.toLowerCase()}</b>.
            </p>
            {d.remarks && <p>{d.remarks}</p>}
            <p>We wish them every success in the future.</p>
          </div>
          <footer className="mt-10">
            <div className="flex items-end justify-between gap-6 text-sm">
              <Signature>Prepared by</Signature>
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-black/40 text-center text-[10px] opacity-60">School stamp</div>
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
