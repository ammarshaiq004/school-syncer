"use client";

import { useParams } from "next/navigation";
import { ReportCardView } from "@/components/report-card";
import { Breadcrumbs } from "@/components/ui";

/** The student's own printable report card for one published exam. */
export default function StudentReportCardPage() {
  const { examId } = useParams<{ examId: string }>();
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        className="print:hidden"
        items={[{ label: "Grades and transcripts", href: "/student/grades" }, { label: "Report card" }]}
      />
      <ReportCardView examId={examId} path={`/student/results/${examId}`} />
    </div>
  );
}
