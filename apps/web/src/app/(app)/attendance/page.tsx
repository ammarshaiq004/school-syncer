"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Status = "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
interface SheetStudent {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
  rollNo: number | null;
  status: Status | null;
}
interface Sheet {
  section: { name: string; className: string };
  taken: boolean;
  takenBy: string | null;
  students: SheetStudent[];
}
interface SummaryRow {
  sectionId: string;
  name: string;
  campus: string;
  enrolled: number;
  taken: boolean;
  present: number;
  absent: number;
  leave: number;
}

const BUTTONS: { status: Status; short: string; on: string }[] = [
  { status: "PRESENT", short: "P", on: "bg-green-600 text-white" },
  { status: "ABSENT", short: "A", on: "bg-red-600 text-white" },
  { status: "LATE", short: "L", on: "bg-amber-500 text-white" },
  { status: "LEAVE", short: "Lv", on: "bg-slate-500 text-white" },
];

export default function AttendancePage() {
  const user = useSession();
  const sections = useSectionOptions();
  const [date, setDate] = useState(todayIso());
  const [sectionId, setSectionId] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const isAdmin = hasRole(user, SETUP);
  const summary = useApi<SummaryRow[]>(isAdmin ? `/attendance/summary?date=${date}` : null);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    api<Sheet>(`/attendance/sheet?sectionId=${sectionId}&date=${date}`)
      .then((s) => {
        if (cancelled) return;
        setSheet(s);
        // Unmarked students default to present so a teacher only taps the absentees.
        setMarks(Object.fromEntries(s.students.map((st) => [st.id, st.status ?? "PRESENT"])));
        setError("");
        setNotice("");
      })
      .catch((e: Error) => !cancelled && (setSheet(null), setError(e.message)));
    return () => {
      cancelled = true;
    };
  }, [sectionId, date]);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ saved: number; counts: Record<Status, number>; alertsSent: number }>("/attendance/sheet", {
        method: "PUT",
        body: { sectionId, date, records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })) },
      });
      setNotice(
        `Saved ${res.saved} students: ${res.counts.PRESENT} present, ${res.counts.ABSENT} absent, ${res.counts.LATE} late, ${res.counts.LEAVE} on leave.` +
          (res.alertsSent ? ` ${res.alertsSent} parent alert(s) sent on WhatsApp.` : ""),
      );
      setError("");
      if (isAdmin) await summary.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const absent = Object.values(marks).filter((m) => m === "ABSENT").length;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Attendance</PageTitle>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Class and section</span>
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
            >
              <option value="">Choose...</option>
              {sections.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Date</span>
            <input
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
            />
          </label>
          {sheet?.taken && <Badge tone="green">taken{sheet.takenBy ? ` by ${sheet.takenBy}` : ""}</Badge>}
        </div>
      </Card>

      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>

      {sheet && sectionId && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{sheet.section.className} {sheet.section.name} · {sheet.students.length} students · {absent} absent</h2>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setMarks(Object.fromEntries(sheet.students.map((s) => [s.id, "PRESENT"])))}>
                All present
              </Button>
              <Button onClick={save} disabled={saving || !sheet.students.length}>{saving ? "Saving..." : "Save register"}</Button>
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
            {sheet.students.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="mr-2 inline-block w-6 text-right text-xs opacity-50">{s.rollNo}</span>
                  <span className="font-medium">{[s.firstName, s.lastName].filter(Boolean).join(" ")}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {BUTTONS.map((b) => (
                    <button
                      key={b.status}
                      onClick={() => setMarks((m) => ({ ...m, [s.id]: b.status }))}
                      aria-pressed={marks[s.id] === b.status}
                      aria-label={`${b.status.toLowerCase()} ${s.firstName}`}
                      className={`h-9 w-10 rounded-lg text-sm font-semibold ${
                        marks[s.id] === b.status ? b.on : "bg-black/5 dark:bg-white/10"
                      }`}
                    >
                      {b.short}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {!sheet.students.length && <p className="text-sm opacity-60">No students in this section yet.</p>}
        </Card>
      )}

      {isAdmin && summary.data && (
        <Card>
          <h2 className="mb-3 font-semibold">All sections on {date}</h2>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Section</th><th>Campus</th><th>Enrolled</th><th>Present</th><th>Absent</th><th>Leave</th><th>Status</th></tr>
              </thead>
              <tbody>
                {summary.data.map((r) => (
                  <tr key={r.sectionId} className={`${rowClass} cursor-pointer hover:bg-black/5 dark:hover:bg-white/5`} onClick={() => setSectionId(r.sectionId)}>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td>{r.campus}</td>
                    <td>{r.enrolled}</td>
                    <td>{r.taken ? r.present : "–"}</td>
                    <td>{r.taken ? r.absent : "–"}</td>
                    <td>{r.taken ? r.leave : "–"}</td>
                    <td>{r.taken ? <Badge tone="green">taken</Badge> : <Badge tone="amber">not taken</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
