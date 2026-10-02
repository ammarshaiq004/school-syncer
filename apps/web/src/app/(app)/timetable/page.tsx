"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/select";
import { Button, Card, ErrorText, Notice, PageTitle } from "@/components/ui";
import { DAYS, SlotText, visibleDays, WeekGrid, type Period, type Slot } from "@/components/week-grid";
import { api } from "@/lib/api";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, TEACHING, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Week { section: { id: string; name: string }; periods: Period[]; slots: Slot[] }
interface SectionSubject { subject: { id: string; name: string }; teacher: { name: string } | null }

export default function TimetablePage() {
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const isTeacher = hasRole(user, TEACHING) && !isAdmin;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Timetable</PageTitle>
      {isTeacher && <MyWeek />}
      <SectionTimetable editable={isAdmin} />
      {isAdmin && <BellSchedule />}
    </div>
  );
}

function MyWeek() {
  const mine = useApi<(Slot & { startTime: string; endTime: string; period: string })[]>("/timetable/me");
  const slots = mine.data ?? [];
  // Rebuild the periods this teacher teaches in, ordered by time.
  const periods: Period[] = [...new Map(slots.map((s) => [s.periodId, { id: s.periodId, name: s.period, startTime: s.startTime, endTime: s.endTime, isBreak: false }])).values()].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  return (
    <Card>
      <h2 className="mb-3 font-semibold">My week</h2>
      <ErrorText>{mine.error}</ErrorText>
      {mine.data && !slots.length && <p className="text-sm opacity-70">No classes are timetabled for you yet.</p>}
      {!!slots.length && (
        <WeekGrid
          periods={periods}
          days={visibleDays(slots)}
          cell={(day, p) => <SlotText slot={slots.find((s) => s.dayOfWeek === day && s.periodId === p.id)} show="section" />}
        />
      )}
    </Card>
  );
}

function SectionTimetable({ editable }: { editable: boolean }) {
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  const [week, setWeek] = useState<Week | null>(null);
  const [subjects, setSubjects] = useState<SectionSubject[]>([]);
  // "day|periodId" -> subjectId
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saturday, setSaturday] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    Promise.all([
      api<Week>(`/timetable/sections/${sectionId}`),
      editable ? api<SectionSubject[]>(`/classes/sections/${sectionId}/subjects`) : Promise.resolve([]),
    ])
      .then(([w, subs]) => {
        if (cancelled) return;
        setWeek(w);
        setSubjects(subs);
        setDraft(Object.fromEntries(w.slots.map((s) => [`${s.dayOfWeek}|${s.periodId}`, s.subjectId])));
        setError("");
        setNotice("");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sectionId, editable]);

  async function save() {
    try {
      const w = await api<Week>(`/timetable/sections/${sectionId}`, {
        method: "PUT",
        body: {
          slots: Object.entries(draft)
            .filter(([, subjectId]) => subjectId)
            .map(([key, subjectId]) => {
              const [day, periodId] = key.split("|");
              return { dayOfWeek: Number(day), periodId, subjectId };
            }),
        },
      });
      setWeek(w);
      setError("");
      setNotice("Timetable saved.");
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    }
  }

  const days = week ? visibleDays(week.slots, saturday) : [];
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <Select
            label="Section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            options={[{ value: "", label: "Choose..." }, ...sections.options]}
          />
        </div>
        {editable && week && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saturday} onChange={(e) => setSaturday(e.target.checked)} /> Saturday
            </label>
            <Button onClick={save}>Save timetable</Button>
          </div>
        )}
      </div>
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>
      {week && !week.periods.length && (
        <p className="text-sm opacity-70">This campus has no bell schedule yet.{editable ? " Add periods below first." : ""}</p>
      )}
      {week && !!week.periods.length && (
        <WeekGrid
          periods={week.periods}
          days={days}
          cell={(day, p) => {
            const slot = week.slots.find((s) => s.dayOfWeek === day && s.periodId === p.id);
            if (!editable) return <SlotText slot={slot} show="teacher" />;
            const key = `${day}|${p.id}`;
            const chosen = subjects.find((s) => s.subject.id === draft[key]);
            return (
              <div>
                <select
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  aria-label={`${DAYS[day]} ${p.name}`}
                  className="w-full rounded border border-black/15 bg-transparent px-1 py-1 text-sm dark:border-white/20"
                >
                  <option value="">–</option>
                  {subjects.map((s) => <option key={s.subject.id} value={s.subject.id}>{s.subject.name}</option>)}
                </select>
                {chosen && <div className="mt-0.5 truncate text-xs opacity-60">{chosen.teacher?.name ?? "no teacher"}</div>}
              </div>
            );
          }}
        />
      )}
      {editable && week && !subjects.length && (
        <p className="mt-3 text-sm opacity-70">Set this section&apos;s subjects and teachers on the Classes screen first.</p>
      )}
    </Card>
  );
}

interface Campus { id: string; name: string }
type PeriodDraft = { id?: string; name: string; startTime: string; endTime: string; isBreak: boolean };

function BellSchedule() {
  const campuses = useApi<Campus[]>("/campuses");
  const [campusId, setCampusId] = useState("");
  const current = campusId || campuses.data?.[0]?.id || "";
  const periods = useApi<Period[]>(current ? `/timetable/periods?campusId=${current}` : null);
  const [draft, setDraft] = useState<PeriodDraft[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const rows: PeriodDraft[] = draft ?? periods.data ?? [];

  const update = (i: number, patch: Partial<PeriodDraft>) => setDraft(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  function addRow() {
    const last = rows.at(-1);
    const start = last?.endTime ?? "08:00";
    const [h, m] = start.split(":").map(Number);
    const end = new Date(0, 0, 0, h, m + 40).toTimeString().slice(0, 5);
    const n = rows.filter((r) => !r.isBreak).length + 1;
    setDraft([...rows, { name: `Period ${n}`, startTime: start, endTime: end, isBreak: false }]);
  }

  async function save() {
    try {
      await api("/timetable/periods", {
        method: "PUT",
        body: { campusId: current, periods: rows.map(({ id, name, startTime, endTime, isBreak }) => ({ id, name, startTime, endTime, isBreak })) },
      });
      setDraft(null);
      setError("");
      setNotice("Bell schedule saved.");
      await periods.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const input = "rounded-lg border border-black/15 bg-transparent px-2 py-1 dark:border-white/20";
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Bell schedule</h2>
          <p className="text-sm opacity-70">The periods of a school day for each campus.</p>
        </div>
        {(campuses.data?.length ?? 0) > 1 && (
          <div className="w-56">
            <Select
              label="Campus"
              value={current}
              onChange={(e) => {
                setCampusId(e.target.value);
                setDraft(null);
              }}
              options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
            <input className={`${input} w-32`} value={r.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Period name" />
            <input className={input} type="time" value={r.startTime} onChange={(e) => update(i, { startTime: e.target.value })} aria-label="Starts" />
            <span className="opacity-60">to</span>
            <input className={input} type="time" value={r.endTime} onChange={(e) => update(i, { endTime: e.target.value })} aria-label="Ends" />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={r.isBreak} onChange={(e) => update(i, { isBreak: e.target.checked })} /> Break
            </label>
            <button className="text-red-600" onClick={() => setDraft(rows.filter((_, k) => k !== i))}>Remove</button>
          </div>
        ))}
        {!rows.length && <p className="text-sm opacity-70">No periods yet.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" onClick={addRow}>Add period</Button>
        <Button onClick={save} disabled={!draft}>Save bell schedule</Button>
      </div>
      <Notice>{notice}</Notice>
      <ErrorText>{error || periods.error}</ErrorText>
    </Card>
  );
}
