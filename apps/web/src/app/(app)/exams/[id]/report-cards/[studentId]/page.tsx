"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReportCardView } from "@/components/report-card";

export default function StaffReportCardPage() {
  const { id, studentId } = useParams<{ id: string; studentId: string }>();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/exams/${id}`} className="text-sm text-brand print:hidden">Back to exam</Link>
      <ReportCardView examId={id} studentId={studentId} />
    </div>
  );
}
