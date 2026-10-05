"use client";

import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ClipboardCheck, Table2 } from "lucide-react";
import { ClassTimetable } from "@/components/attendance/class-timetable";
import { DayRegister } from "@/components/attendance/day-register";
import { MonthlyMatrix } from "@/components/attendance/monthly-matrix";
import { PageHeader, TabPanel, Tabs } from "@/components/ui";
import { todayIso } from "@/lib/format";
import { usePersistedState } from "@/lib/persisted";
import { can, useSession } from "@/lib/session";

type Tab = "take" | "matrix" | "timetable";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export default function AttendancePage() {
  return (
    <Suspense>
      <Attendance />
    </Suspense>
  );
}

function Attendance() {
  const user = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The section and day live in the URL, so a dashboard link can open a
  // register straight away and a reload keeps the same one.
  const sectionId = params.get("section") ?? "";
  const dateParam = params.get("date");
  const date = dateParam && isoDate.test(dateParam) ? dateParam : todayIso();
  const features = user.plan?.features;
  const showTimetable = (!features || features.includes("timetable")) && can(user, "timetable");
  const [saved, setTab] = usePersistedState<Tab>("schoolsyncer.attendance.tab", "take");
  const tab: Tab = saved === "timetable" && !showTimetable ? "take" : saved;

  const setQuery = useCallback(
    (patch: Partial<Record<"section" | "date", string>>) => {
      const q = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) q.set(key, value);
        else q.delete(key);
      }
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const setSectionId = useCallback((id: string) => setQuery({ section: id }), [setQuery]);

  const tabs = [
    { value: "take", label: "Take attendance", icon: <ClipboardCheck /> },
    { value: "matrix", label: "Monthly matrix", icon: <Table2 /> },
    ...(showTimetable ? [{ value: "timetable", label: "Class timetable", icon: <CalendarClock /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description="Take the daily register, review a whole month at a glance and check the class timetable."
        breadcrumbs={[{ label: "Academics" }, { label: "Attendance" }]}
      />
      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)} aria-label="Attendance views">
        <TabPanel value="take">
          <DayRegister sectionId={sectionId} onSectionChange={setSectionId} date={date} onDateChange={(d) => setQuery({ date: d })} />
        </TabPanel>
        <TabPanel value="matrix">
          <MonthlyMatrix sectionId={sectionId} onSectionChange={setSectionId} />
        </TabPanel>
        {showTimetable && (
          <TabPanel value="timetable">
            <ClassTimetable sectionId={sectionId} onSectionChange={setSectionId} />
          </TabPanel>
        )}
      </Tabs>
    </div>
  );
}
