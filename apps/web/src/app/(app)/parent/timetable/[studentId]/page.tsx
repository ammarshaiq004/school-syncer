"use client";

import { useParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/ui";
import { SlotText, visibleDays, WeekGrid, type Period, type Slot } from "@/components/week-grid";
import { useApi } from "@/lib/use-api";

export default function ParentTimetablePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const week = useApi<{ section: { name: string }; periods: Period[]; slots: Slot[] }>(`/timetable/students/${studentId}`);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Timetable${week.data ? `: ${week.data.section.name}` : ""}`}
        description="The weekly class timetable, with each subject's teacher."
        breadcrumbs={[{ label: "My children", href: "/parent" }, { label: "Timetable" }]}
      />
      <Card>
        {week.error ? (
          <ErrorState message={week.error} onRetry={week.reload} compact />
        ) : !week.data ? (
          <SkeletonRows rows={6} columns={6} />
        ) : week.data.periods.length ? (
          <WeekGrid
            periods={week.data.periods}
            days={visibleDays(week.data.slots)}
            cell={(day, p) => <SlotText slot={week.data!.slots.find((s) => s.dayOfWeek === day && s.periodId === p.id)} show="teacher" />}
          />
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="No timetable yet"
            description="The school hasn't published a timetable yet. It shows up here once it does."
            compact
          />
        )}
      </Card>
    </div>
  );
}
