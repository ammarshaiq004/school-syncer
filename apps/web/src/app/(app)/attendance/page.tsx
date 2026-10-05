"use client";

import { useState } from "react";
import { CalendarClock, ClipboardCheck, Table2 } from "lucide-react";
import { ClassTimetable } from "@/components/attendance/class-timetable";
import { DayRegister } from "@/components/attendance/day-register";
import { MonthlyMatrix } from "@/components/attendance/monthly-matrix";
import { PageHeader, TabPanel, Tabs } from "@/components/ui";
import { usePersistedState } from "@/lib/persisted";
import { can, useSession } from "@/lib/session";

type Tab = "take" | "matrix" | "timetable";

export default function AttendancePage() {
  const user = useSession();
  // One section across the tabs, so switching from the register to the month keeps the class.
  const [sectionId, setSectionId] = useState("");
  const features = user.plan?.features;
  const showTimetable = (!features || features.includes("timetable")) && can(user, "timetable");
  const [saved, setTab] = usePersistedState<Tab>("schoolsyncer.attendance.tab", "take");
  const tab: Tab = saved === "timetable" && !showTimetable ? "take" : saved;

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
          <DayRegister sectionId={sectionId} onSectionChange={setSectionId} />
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
