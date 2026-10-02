"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, ErrorText, PageTitle } from "@/components/ui";
import { SlotText, visibleDays, WeekGrid, type Period, type Slot } from "@/components/week-grid";
import { useApi } from "@/lib/use-api";

export default function ParentTimetablePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const week = useApi<{ section: { name: string }; periods: Period[]; slots: Slot[] }>(`/timetable/students/${studentId}`);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/parent" className="text-sm text-brand">Back to my children</Link>
      <PageTitle>Timetable{week.data ? `: ${week.data.section.name}` : ""}</PageTitle>
      <ErrorText>{week.error}</ErrorText>
      {week.data && (
        <Card>
          {week.data.periods.length ? (
            <WeekGrid
              periods={week.data.periods}
              days={visibleDays(week.data.slots)}
              cell={(day, p) => <SlotText slot={week.data!.slots.find((s) => s.dayOfWeek === day && s.periodId === p.id)} show="teacher" />}
            />
          ) : (
            <p className="text-sm opacity-70">The school hasn&apos;t published a timetable yet.</p>
          )}
        </Card>
      )}
    </div>
  );
}
