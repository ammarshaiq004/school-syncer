"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, SearchX } from "lucide-react";
import { VerifyForm } from "@/app/verify/verify-form";
import { Card, DescriptionList, ErrorState, Skeleton, SkeletonRows, StatusPill, type DescriptionItem } from "@/components/ui";
import { VerifyShell } from "@/components/verify/verify-shell";
import { api } from "@/lib/api";
import { CERTIFICATE_TITLE, type CertificateType } from "@/lib/certificates";
import { cn } from "@/lib/cn";
import { day } from "@/lib/format";

interface Result {
  found: boolean;
  valid?: boolean;
  type?: CertificateType;
  serialNo?: string;
  issuedOn?: string;
  school?: { name: string; city: string | null };
  studentName?: string;
  guardianName?: string | null;
  admissionNo?: string;
  className?: string | null;
  leavingOn?: string | null;
  cancelledOn?: string | null;
}

/** Public: checks a certificate's code, for whoever is handed the paper. */
export default function VerifyCodePage() {
  const { code } = useParams<{ code: string }>();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Result>(`/verify/${encodeURIComponent(code)}`).then(
      (r) => {
        if (cancelled) return;
        setResult(r);
        setError("");
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  const items: DescriptionItem[] = result?.found
    ? [
        { label: "Certificate", value: CERTIFICATE_TITLE[result.type!] },
        { label: "Serial No.", value: <span className="font-mono">{result.serialNo}</span> },
        { label: "Issued on", value: day(result.issuedOn!) },
        { label: "Student", value: result.studentName },
        ...(result.guardianName ? [{ label: "Parent", value: result.guardianName }] : []),
        { label: "Admission No.", value: result.admissionNo },
        ...(result.className ? [{ label: "Class", value: result.className }] : []),
        ...(result.leavingOn ? [{ label: "Left on", value: day(result.leavingOn) }] : []),
        { label: "School", value: result.school!.name, full: true },
      ]
    : [];

  return (
    <VerifyShell title="Certificate check" description={<>Result for code <span className="font-mono font-medium text-fg">{code.toUpperCase()}</span></>}>
      {error ? (
        <Card padding="none">
          <ErrorState title="Could not check this code" message={error} onRetry={() => setAttempt((n) => n + 1)} compact />
        </Card>
      ) : !result ? (
        <Card aria-busy>
          <Skeleton className="mb-3 h-6 w-56" />
          <SkeletonRows rows={4} columns={2} />
        </Card>
      ) : !result.found ? (
        <Card className="animate-rise">
          <ResultHeading tone="danger" icon={<SearchX />} title={`No certificate has the code ${code.toUpperCase()}`}>
            Check the code printed at the bottom of the certificate and try again. If it still doesn&apos;t match, the certificate was not issued through SchoolSyncer.
          </ResultHeading>
        </Card>
      ) : (
        <Card className="animate-rise">
          <ResultHeading
            tone={result.valid ? "success" : "danger"}
            icon={result.valid ? <CircleCheck /> : <CircleX />}
            title={result.valid ? "Genuine certificate" : `This certificate was cancelled on ${day(result.cancelledOn!)}`}
            pill={result.valid ? <StatusPill status="VALID" tone="success" /> : <StatusPill status="CANCELLED" tone="danger" />}
          >
            {result.valid
              ? `Issued by ${result.school!.name}${result.school!.city ? `, ${result.school!.city}` : ""}. The details below should match the paper.`
              : "The school withdrew it, usually to issue a corrected one. Ask the school for the current certificate."}
          </ResultHeading>
          <div className="mt-5 border-t border-border pt-5">
            <DescriptionList items={items} columns={2} />
          </div>
        </Card>
      )}
      <Card>
        <VerifyForm label="Check another code" />
      </Card>
    </VerifyShell>
  );
}

function ResultHeading({
  tone,
  icon,
  title,
  pill,
  children,
}: {
  tone: "success" | "danger";
  icon: ReactNode;
  title: string;
  pill?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5" role="status">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-5",
          tone === "success" ? "bg-success-tint text-success" : "bg-danger-tint text-danger",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={cn("text-base font-semibold", tone === "success" ? "text-success-text" : "text-danger-text")}>{title}</h2>
          {pill}
        </div>
        <p className="mt-1 text-sm text-fg-muted">{children}</p>
      </div>
    </div>
  );
}
