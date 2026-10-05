"use client";

import { Printer } from "lucide-react";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { day } from "@/lib/format";
import { notPassedReason } from "@/lib/results";
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

/*
 * The card is a sheet of paper: it stays white with dark ink in both themes and in print,
 * so it uses fixed slate/emerald/rose colours instead of the theme tokens on purpose.
 * print-color-adjust keeps the light tints when the browser prints backgrounds off.
 */

/** Letter grade chip in fixed paper colours (A green, B indigo, C sky, D/E amber, F/U rose). */
function PaperGrade({ grade }: { grade: string }) {
  const g = grade.trim().toUpperCase();
  const tone = g.startsWith("A")
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : g.startsWith("B")
      ? "border-indigo-300 bg-indigo-50 text-indigo-800"
      : g.startsWith("C")
        ? "border-sky-300 bg-sky-50 text-sky-800"
        : g.startsWith("D") || g.startsWith("E")
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : g.startsWith("F") || g.startsWith("U")
            ? "border-rose-300 bg-rose-50 text-rose-800"
            : "border-slate-300 bg-slate-50 text-slate-800";
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-8 items-center justify-center rounded-full border px-2 font-display text-xs font-semibold tabular-nums",
        tone,
      )}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}

function ReportCardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-xl border border-border bg-surface p-8 shadow-card" role="status" aria-label="Loading report card">
      <Skeleton className="mx-auto h-7 w-64" />
      <Skeleton className="mx-auto h-4 w-48" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-4 w-40" />)}
      </div>
      <Skeleton className="mt-4 h-48 w-full" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * A one-page printable report card, shared by the staff, parent and student screens.
 * `path` overrides the API route (the student workspace reads /student/results/:examId).
 */
export function ReportCardView({ examId, studentId, path }: { examId: string; studentId?: string; path?: string }) {
  const card = useApi<ReportCard>(path ?? `/exams/${examId}/report-cards/${studentId}`);
  if (card.error) return <ErrorState title="Could not load this report card" message={card.error} onRetry={card.reload} />;
  const c = card.data;
  if (!c) return <ReportCardSkeleton />;

  const cell = "border border-slate-300 px-3 py-2 print:border-slate-500";
  const head = `${cell} bg-slate-100 text-left text-xs font-semibold uppercase tracking-[0.04em] text-slate-600`;
  const num = "text-right tabular-nums";
  // Phones only have room for the marks and the result, so Total and Pass fold into the Obtained cell.
  const hideSmall = "hidden sm:table-cell print:table-cell";
  const showSmall = "sm:hidden print:hidden";
  const notPassed = notPassedReason(c.subjects);
  const days = c.attendance.present + c.attendance.absent + c.attendance.leave;

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-3xl justify-end print:hidden">
        <Button type="button" variant="secondary" icon={<Printer />} onClick={() => window.print()}>
          Print report card
        </Button>
      </div>
      <article
        className="mx-auto w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-900 shadow-card [print-color-adjust:exact] sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        aria-label={`Report card for ${c.student.name}`}
      >
        <header className="mb-6 flex flex-col items-center gap-2 border-b-2 border-slate-900 pb-4 text-center">
          {c.school.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.school.logoUrl} alt="" className="h-14 w-auto object-contain" />
          )}
          <h1 className="font-display text-2xl font-semibold text-slate-900">{c.school.name}</h1>
          <p className="text-base font-medium text-slate-700">Report card, {c.exam.name}</p>
          <p className="text-[13px] text-slate-500">Academic year {c.exam.academicYear}</p>
        </header>

        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2">
          {[
            ["Student", c.student.name, true],
            ["Class", c.student.class, true],
            ["Admission no.", c.student.admissionNo, false],
            ["Roll no.", c.student.rollNo ?? "Not set", false],
          ].map(([label, value, strong]) => (
            <div key={String(label)} className="flex gap-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className={cn("tabular-nums", strong ? "font-semibold text-slate-900" : "text-slate-800")}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mb-6 overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className={head}>Subject</th>
                <th scope="col" className={cn(head, num, hideSmall)}>Total</th>
                <th scope="col" className={cn(head, num, hideSmall)}>Pass</th>
                <th scope="col" className={cn(head, "text-right")}>Obtained</th>
                <th scope="col" className={head}>Result</th>
              </tr>
            </thead>
            <tbody>
              {c.subjects.map((s) => (
                <tr key={s.subject} className={s.passed ? undefined : "bg-rose-50"}>
                  <th scope="row" className={cn(cell, "font-medium")}>{s.subject}</th>
                  <td className={cn(cell, num, hideSmall)}>{s.max}</td>
                  <td className={cn(cell, num, hideSmall, "text-slate-600")}>{s.pass}</td>
                  <td className={cn(cell, num, "font-semibold")}>
                    {s.absent ? "Absent" : s.marks}
                    {!s.absent && <span className={cn("font-normal text-slate-500", showSmall)}> / {s.max}</span>}
                  </td>
                  <td className={cell}>{s.passed ? "Pass" : <span className="font-semibold text-rose-700">{s.absent ? "Absent" : "Fail"}</span>}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <th scope="row" className={cell}>Total</th>
                <td className={cn(cell, num, hideSmall)}>{c.maxTotal}</td>
                <td className={cn(cell, hideSmall)} />
                <td className={cn(cell, num)}>
                  {c.obtained}
                  <span className={cn("font-normal text-slate-500", showSmall)}> / {c.maxTotal}</span>
                </td>
                <td className={cell}>{c.passed ? "Pass" : <span className="text-rose-700">Fail</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-5 print:grid-cols-5">
          <div
            className={cn(
              "rounded-lg border p-3 [print-color-adjust:exact]",
              c.passed ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50",
            )}
          >
            <div className={cn("font-display text-lg font-semibold", c.passed ? "text-emerald-800" : "text-rose-800")}>
              {c.passed ? "Pass" : "Fail"}
            </div>
            <div className="text-xs text-slate-500">Result</div>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <div className="font-display text-lg font-semibold tabular-nums">{c.percent}%</div>
            <div className="text-xs text-slate-500">Percentage</div>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-slate-300 p-3">
            <PaperGrade grade={c.grade} />
            <div className="text-xs text-slate-500">Grade</div>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <div className="font-display text-lg font-semibold tabular-nums">{c.position} of {c.outOf}</div>
            <div className="text-xs text-slate-500">Position</div>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <div className="font-display text-lg font-semibold tabular-nums">{c.attendance.present} of {days}</div>
            <div className="text-xs text-slate-500">Days present</div>
          </div>
        </div>

        {!c.passed && (
          <p className="mb-6 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-800 [print-color-adjust:exact]">
            Overall result: not passed{notPassed ? `, ${notPassed}` : ""}.
          </p>
        )}

        <section className="mb-8 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Class teacher&apos;s remarks</h2>
            <p className="min-h-7 border-b border-slate-300 pb-1 text-slate-800">{c.teacherRemark}</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Principal&apos;s remarks</h2>
            <p className="min-h-7 border-b border-slate-300 pb-1 text-slate-800">{c.principalRemark}</p>
          </div>
        </section>

        <footer className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>Grades:</span>
              {c.gradeScale.map((g) => (
                <span key={g.grade} className="inline-flex items-center gap-1">
                  <PaperGrade grade={g.grade} />
                  <span className="tabular-nums">{g.minPercent}%+</span>
                </span>
              ))}
            </div>
            {c.exam.publishedAt && <span>Issued {day(c.exam.publishedAt)}</span>}
          </div>
          <div className="flex gap-10 text-center text-xs text-slate-600">
            <div className="w-32 border-t border-slate-500 pt-1">Class teacher</div>
            <div className="w-32 border-t border-slate-500 pt-1">Principal</div>
          </div>
        </footer>
      </article>
    </div>
  );
}
