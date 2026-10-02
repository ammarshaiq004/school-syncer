"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReportCardView } from "@/components/report-card";

export default function ParentReportCardPage() {
  const { examId, studentId } = useParams<{ examId: string; studentId: string }>();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/parent" className="text-sm text-brand print:hidden">Back to my children</Link>
      <ReportCardView examId={examId} studentId={studentId} />
    </div>
  );
}
