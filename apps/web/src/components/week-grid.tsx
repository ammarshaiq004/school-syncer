import type { ReactNode } from "react";

export interface Period { id: string; name: string; startTime: string; endTime: string; isBreak: boolean }
export interface Slot {
  id: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  subject: string;
  teacherId: string | null;
  teacher: string | null;
  section: string;
  room: string | null;
}

export const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Days to show: Monday to Friday, plus any weekend day that has classes. */
export function visibleDays(slots: { dayOfWeek: number }[], withSaturday = false) {
  const days = [1, 2, 3, 4, 5];
  if (withSaturday || slots.some((s) => s.dayOfWeek === 6)) days.push(6);
  if (slots.some((s) => s.dayOfWeek === 7)) days.push(7);
  return days;
}

/** Periods down the side, days across the top; breaks span the row. */
export function WeekGrid({
  periods,
  days,
  cell,
}: {
  periods: Period[];
  days: number[];
  cell: (day: number, period: Period) => ReactNode;
}) {
  const border = "border border-black/10 dark:border-white/10";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${border} w-28 p-2 text-left font-medium opacity-70`}>Period</th>
            {days.map((d) => <th key={d} className={`${border} p-2 font-medium`}>{DAYS[d]}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              <td className={`${border} p-2 align-top`}>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs opacity-60">{p.startTime}–{p.endTime}</div>
              </td>
              {p.isBreak ? (
                <td colSpan={days.length} className={`${border} bg-black/5 p-2 text-center text-xs uppercase tracking-wide opacity-60 dark:bg-white/5`}>
                  {p.name}
                </td>
              ) : (
                days.map((d) => <td key={d} className={`${border} p-1 align-top`}>{cell(d, p)}</td>)
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A read-only cell: subject, then teacher or section. */
export function SlotText({ slot, show }: { slot?: Slot; show: "teacher" | "section" }) {
  if (!slot) return <span className="block p-1 opacity-30">–</span>;
  const second = show === "teacher" ? slot.teacher : slot.section;
  return (
    <div className="rounded-md bg-brand/10 p-1.5">
      <div className="font-medium text-brand">{slot.subject}</div>
      {second && <div className="text-xs opacity-70">{second}</div>}
      {slot.room && <div className="text-xs opacity-60">Room {slot.room}</div>}
    </div>
  );
}
