"use client";

import { useParams } from "next/navigation";
import { ReportCardView } from "@/components/report-card";
import { PageHeader } from "@/components/ui";

export default function StaffReportCardPage() {
  const { id, studentId } = useParams<{ id: string; studentId: string }>();
  return (
    <div className="flex flex-col gap-6 print:gap-0">
      <PageHeader
        title="Report card"
        description="Check the details, then print or save as PDF."
        breadcrumbs={[{ label: "Exams", href: "/exams" }, { label: "Exam results", href: `/exams/${id}` }, { label: "Report card" }]}
      />
      <ReportCardView examId={id} studentId={studentId} />
    </div>
  );
}
