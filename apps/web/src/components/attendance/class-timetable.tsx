"use client";

import { useEffect, useState } from "react";
import { BellRing, CalendarRange, ExternalLink } from "lucide-react";
import Link from "next/link";
import { buttonClass, Card, CardHeader, EmptyState, ErrorState, SelectField, Skeleton } from "@/components/ui";
import { SlotText, visibleDays, WeekGrid, type Period, type Slot } from "@/components/week-grid";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { MarkableSection } from "./monthly-matrix";

interface Week {
  section: { id: string; name: string };
  periods: Period[];
  slots: Slot[];
}

/** "Class timetable" tab: the chosen section's week, read only. Editing stays on the Timetable page. */
export function ClassTimetable({ sectionId, onSectionChange }: { sectionId: string; onSectionChange: (id: string) => void }) {
  const sections = useApi<MarkableSection[]>("/attendance/sections");
  const [loaded, setLoaded] = useState<{ sectionId: string; week: Week } | null>(null);
  const [loadError, setLoadError] = useState<{ sectionId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const week = loaded?.sectionId === sectionId ? loaded.week : null;
  const error = loadError?.sectionId === sectionId ? loadError.message : "";

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    api<Week>(`/timetable/sections/${encodeURIComponent(sectionId)}`)
      .then((w) => {
        if (cancelled) return;
        setLoaded({ sectionId, week: w });
        setLoadError(null);
      })
      .catch((e: Error) => !cancelled && setLoadError({ sectionId, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [sectionId, attempt]);

  const options = (sections.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  const label = options.find((o) => o.value === sectionId)?.label;
  const lessons = week?.slots.length ?? 0;

  return (
    <Card>
      <CardHeader
        icon={<CalendarRange />}
        title={label ? `${label} timetable` : "Class timetable"}
        description={week ? `${lessons} lesson${lessons === 1 ? "" : "s"} a week. Today's column is highlighted.` : "The weekly schedule for the section you are taking attendance for."}
        action={
          <Link href="/timetable" className={buttonClass("ghost", "sm")}>
            Full timetable
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        }
      />
      <div className="mb-4">
        <SelectField
          label="Class and section"
          value={sectionId}
          onChange={(e) => onSectionChange(e.target.value)}
          placeholder={sections.data ? "Choose a section" : "Loading sections"}
          options={options}
          wrapperClassName="w-full sm:w-64"
        />
      </div>
      {!sectionId ? (
        <EmptyState compact icon={<CalendarRange />} title="Choose a section" description="Pick a class and section to see its weekly timetable." />
      ) : error ? (
        <ErrorState compact message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !week ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !week.periods.length ? (
        <EmptyState compact icon={<BellRing />} title="No bell schedule yet" description="This campus has no periods set. An admin can add them on the Timetable page." />
      ) : !lessons ? (
        <EmptyState compact icon={<CalendarRange />} title="Nothing timetabled for this section yet" description="Once lessons are placed on the Timetable page, they show up here." />
      ) : (
        <WeekGrid
          periods={week.periods}
          days={visibleDays(week.slots)}
          cell={(day, p) => <SlotText slot={week.slots.find((s) => s.dayOfWeek === day && s.periodId === p.id)} show="teacher" />}
        />
      )}
    </Card>
  );
}
