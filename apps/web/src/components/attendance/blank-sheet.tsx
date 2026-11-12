"use client";

import { Printer } from "lucide-react";
import { Button, Card, ErrorState, SkeletonRows } from "@/components/ui";
import { useApi } from "@/lib/use-api";

interface Matrix {
  section: { name: string; className: string };
  days: { date: string; isSchoolDay: boolean }[];
  students: { id: string; name: string; admissionNo: string; rollNo: number | null }[];
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** A paper register for one section and month: names down the side, every school day across, boxes left empty. */
export function BlankSheet({ sectionId, month }: { sectionId: string; month: string }) {
  const m = useApi<Matrix>(`/attendance/matrix?${new URLSearchParams({ sectionId, month })}`);
  if (m.error) return <ErrorState message={m.error} onRetry={m.reload} />;
  if (!m.data) return <SkeletonRows rows={6} columns={4} />;
  const days = m.data.days.filter((d) => d.isSchoolDay);
  return (
    <Card padding="sm" className="print:border-0 print:p-0 print:shadow-none">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-fg">
          {m.data.section.className} {m.data.section.name} · {monthLabel(month)}
        </h2>
        <Button variant="secondary" size="sm" icon={<Printer />} onClick={() => window.print()} className="print:hidden">
          Print sheet
        </Button>
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-xs" aria-label="Blank attendance sheet">
          <thead>
            <tr>
              <th className="border border-border px-1 py-1 text-left">Roll</th>
              <th className="border border-border px-1 py-1 text-left">Student</th>
              {days.map((d) => (
                <th key={d.date} className="w-6 border border-border px-0.5 py-1 text-center font-normal">
                  {Number(d.date.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.data.students.map((s) => (
              <tr key={s.id}>
                <td className="border border-border px-1 py-1.5 tabular-nums">{s.rollNo ?? ""}</td>
                <td className="whitespace-nowrap border border-border px-1 py-1.5">{s.name}</td>
                {days.map((d) => (
                  <td key={d.date} className="border border-border" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
