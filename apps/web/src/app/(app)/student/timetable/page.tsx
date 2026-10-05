"use client";

import { CalendarDays } from "lucide-react";
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/ui";
import { SlotText, visibleDays, WeekGrid, type Period, type Slot } from "@/components/week-grid";
import { useApi } from "@/lib/use-api";

interface StudentWeek {
  section: { id: string; name: string } | null;
  periods: Period[];
  slots: Slot[];
}

/** The student's own week: their section's periods and subjects, with each subject's teacher. */
export default function StudentTimetablePage() {
  const week = useApi<StudentWeek>("/student/timetable");
  const data = week.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Timetable"
        description={`Your class timetable for the whole week, so you know what is coming tomorrow.${data?.section ? ` Section ${data.section.name}.` : ""}`}
        breadcrumbs={[{ label: "Student Workspace", href: "/student" }, { label: "Timetable" }]}
      />
      <Card>
        {week.error ? (
          <ErrorState message={week.error} onRetry={week.reload} compact />
        ) : !data ? (
          <SkeletonRows rows={6} columns={6} />
        ) : data.slots.length ? (
          <WeekGrid
            periods={data.periods}
            days={visibleDays(data.slots)}
            cell={(day, p) => <SlotText slot={data.slots.find((s) => s.dayOfWeek === day && s.periodId === p.id)} show="teacher" />}
          />
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="No timetable yet"
            description={
              data.section
                ? "Your school has not published a timetable for your class yet. It shows up here once it does."
                : "You are not in a class section yet, so there is no timetable to show."
            }
            compact
          />
        )}
      </Card>
    </div>
  );
}
