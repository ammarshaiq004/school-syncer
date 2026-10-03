"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { VerifyForm } from "@/app/verify/verify-form";
import { Card, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { CERTIFICATE_TITLE, type CertificateType } from "@/lib/certificates";
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

  useEffect(() => {
    api<Result>(`/verify/${encodeURIComponent(code)}`).then(setResult, (e: Error) => setError(e.message));
  }, [code]);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Certificate check</h1>
      <ErrorText>{error}</ErrorText>
      {result && !result.found && (
        <Card>
          <p className="font-medium text-red-700 dark:text-red-400">No certificate has the code {code.toUpperCase()}.</p>
          <p className="mt-1 text-sm opacity-70">Check the code printed at the bottom of the certificate and try again. If it still doesn&apos;t match, the certificate was not issued through SchoolSyncer.</p>
        </Card>
      )}
      {result?.found && (
        <Card>
          <p className={`text-lg font-semibold ${result.valid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
            {result.valid ? "Genuine certificate" : `This certificate was cancelled on ${day(result.cancelledOn!)}`}
          </p>
          <p className="mb-4 text-sm opacity-70">
            {result.valid
              ? `Issued by ${result.school!.name}${result.school!.city ? `, ${result.school!.city}` : ""}. The details below should match the paper.`
              : "The school withdrew it, usually to issue a corrected one. Ask the school for the current certificate."}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="opacity-60">Certificate</dt><dd>{CERTIFICATE_TITLE[result.type!]}</dd>
            <dt className="opacity-60">Serial No.</dt><dd className="font-mono">{result.serialNo}</dd>
            <dt className="opacity-60">Issued on</dt><dd>{day(result.issuedOn!)}</dd>
            <dt className="opacity-60">Student</dt><dd>{result.studentName}</dd>
            {result.guardianName && (<><dt className="opacity-60">Parent</dt><dd>{result.guardianName}</dd></>)}
            <dt className="opacity-60">Admission No.</dt><dd>{result.admissionNo}</dd>
            {result.className && (<><dt className="opacity-60">Class</dt><dd>{result.className}</dd></>)}
            {result.leavingOn && (<><dt className="opacity-60">Left on</dt><dd>{day(result.leavingOn)}</dd></>)}
            <dt className="opacity-60">School</dt><dd>{result.school!.name}</dd>
          </dl>
        </Card>
      )}
      <Card>
        <VerifyForm label="Check another code" />
      </Card>
    </main>
  );
}
