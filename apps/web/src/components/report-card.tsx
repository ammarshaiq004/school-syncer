"use client";

import { Button, ErrorText } from "@/components/ui";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface ReportCard {
  school: { name: string; logoUrl: string | null };
  exam: { name: string; academicYear: string; publishedAt: string | null };
  student: { name: string; admissionNo: string; rollNo: number | null; class: string; dateOfBirth: string | null };
  subjects: { subject: string; max: number; pass: number; marks: number | null; absent: boolean; passed: boolean }[];
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  position: number;
  outOf: number;
  passed: boolean;
  teacherRemark: string | null;
  principalRemark: string | null;
  attendance: { present: number; absent: number; leave: number };
  gradeScale: { grade: string; minPercent: number; remark: string | null }[];
}

/** A one-page printable report card, shared by the staff and parent screens. */
export function ReportCardView({ examId, studentId }: { examId: string; studentId: string }) {
  const card = useApi<ReportCard>(`/exams/${examId}/report-cards/${studentId}`);
  if (card.error) return <ErrorText>{card.error}</ErrorText>;
  const c = card.data;
  if (!c) return <p className="text-sm opacity-60">Loading...</p>;
  const cell = "border border-black/20 px-3 py-1.5 dark:border-white/20 print:border-black";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end print:hidden">
        <Button variant="ghost" onClick={() => window.print()}>Print report card</Button>
      </div>
      <article className="mx-auto w-full max-w-3xl rounded-xl border border-black/10 bg-white p-8 text-sm text-black shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold">{c.school.name}</h1>
          <p className="text-base font-medium">Report card · {c.exam.name}</p>
          <p className="opacity-70">Academic year {c.exam.academicYear}</p>
        </header>

        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1">
          <div className="flex gap-2"><dt className="opacity-60">Student</dt><dd className="font-semibold">{c.student.name}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Class</dt><dd className="font-semibold">{c.student.class}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Admission no.</dt><dd>{c.student.admissionNo}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Roll no.</dt><dd>{c.student.rollNo ?? "–"}</dd></div>
        </dl>

        <table className="mb-6 w-full border-collapse text-left">
          <thead className="bg-black/5">
            <tr><th className={cell}>Subject</th><th className={cell}>Total</th><th className={cell}>Pass</th><th className={cell}>Obtained</th><th className={cell}>Result</th></tr>
          </thead>
          <tbody>
            {c.subjects.map((s) => (
              <tr key={s.subject}>
                <td className={cell}>{s.subject}</td>
                <td className={cell}>{s.max}</td>
                <td className={cell}>{s.pass}</td>
                <td className={`${cell} font-medium`}>{s.absent ? "Absent" : s.marks}</td>
                <td className={cell}>{s.passed ? "Pass" : <span className="font-semibold text-red-700">Fail</span>}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={cell}>Total</td>
              <td className={cell}>{c.maxTotal}</td>
              <td className={cell} />
              <td className={cell}>{c.obtained}</td>
              <td className={cell}>{c.passed ? "Pass" : "Fail"}</td>
            </tr>
          </tbody>
        </table>

        <div className="mb-6 grid grid-cols-4 gap-3 text-center">
          {[
            ["Percentage", `${c.percent}%`],
            ["Grade", c.grade],
            ["Position", `${c.position} of ${c.outOf}`],
            ["Days present", `${c.attendance.present} of ${c.attendance.present + c.attendance.absent + c.attendance.leave}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-black/15 p-3">
              <div className="text-lg font-bold">{value}</div>
              <div className="text-xs opacity-60">{label}</div>
            </div>
          ))}
        </div>

        <section className="mb-6 flex flex-col gap-3">
          <div><h2 className="font-semibold">Class teacher&apos;s remarks</h2><p className="min-h-6 border-b border-black/20">{c.teacherRemark}</p></div>
          <div><h2 className="font-semibold">Principal&apos;s remarks</h2><p className="min-h-6 border-b border-black/20">{c.principalRemark}</p></div>
        </section>

        <footer className="flex items-end justify-between gap-6">
          <p className="text-xs opacity-60">
            Grades: {c.gradeScale.map((g) => `${g.grade} ${g.minPercent}%+`).join(", ")}
            {c.exam.publishedAt ? ` · Issued ${day(c.exam.publishedAt)}` : ""}
          </p>
          <div className="flex gap-10 text-center text-xs">
            <div className="w-32 border-t border-black/40 pt-1">Class teacher</div>
            <div className="w-32 border-t border-black/40 pt-1">Principal</div>
          </div>
        </footer>
      </article>
    </div>
  );
}
