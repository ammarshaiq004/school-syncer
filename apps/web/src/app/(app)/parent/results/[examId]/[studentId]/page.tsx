"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ReportCardView } from "@/components/report-card";
import { buttonClass } from "@/components/ui";

export default function ParentReportCardPage() {
  const { examId, studentId } = useParams<{ examId: string; studentId: string }>();
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Back" className="print:hidden">
        <Link href="/parent" className={buttonClass("ghost", "sm", "-ms-3")}>
          <ArrowLeft aria-hidden />
          Back to my children
        </Link>
      </nav>
      <ReportCardView examId={examId} studentId={studentId} />
    </div>
  );
}
