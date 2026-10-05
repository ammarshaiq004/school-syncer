"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Clock, Download, ShieldCheck, Table2, UserX, Users } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  KpiCard,
  NativeSelect,
  SearchInput,
  SelectField,
  Skeleton,
  StatGrid,
  TextField,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { downloadCsv } from "@/lib/csv";
import { thisMonth, todayIso } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import {
  attendanceRate,
  emptyCounts,
  longDay,
  META_BY_STATUS,
  monthLabel,
  nextStatus,
  shiftMonth,
  shortDay,
  STATUS_META,
  weekdayShort,
  type AttendanceStatus,
  type StatusCounts,
} from "./status";

/** A section the signed-in user can mark (GET /attendance/sections). */
export interface MarkableSection {
  id: string;
  name: string;
  students: number;
  isClassTeacher: boolean;
}

interface MatrixDay {
  date: string;
  isSchoolDay: boolean;
  sessionId: string | null;
}
interface MatrixStudent {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  photoUrl: string | null;
  statuses: Record<string, AttendanceStatus>;
}
interface Matrix {
  section: { id: string; name: string; className: string };
  month: string;
  days: MatrixDay[];
  students: MatrixStudent[];
}

/** Wait this long after the last click on a cell before saving, so cycling P to E sends one request (and no stray absence alert). */
const SAVE_DELAY = 650;

type Statuses = Record<string, Record<string, AttendanceStatus>>;
interface Loaded {
  key: string;
  matrix: Matrix;
  /** studentId -> date -> status, edited in place by optimistic updates. */
  statuses: Statuses;
}
interface PendingSave {
  timer: ReturnType<typeof setTimeout>;
  /** Status before the first click of this burst, for rollback. */
  original: AttendanceStatus | undefined;
  run: () => void;
}

const countFor = (statuses: Record<string, AttendanceStatus> | undefined, dates?: string[]) => {
  const c = emptyCounts();
  for (const [date, s] of Object.entries(statuses ?? {})) if (!dates || dates.includes(date)) c[s]++;
  return c;
};

/** "Monthly matrix" tab: students down the side, days across, one status pill per cell. */
export function MonthlyMatrix({ sectionId, onSectionChange }: { sectionId: string; onSectionChange: (id: string) => void }) {
  const user = useSession();
  const toast = useToast();
  const sections = useApi<MarkableSection[]>("/attendance/sections");
  const [month, setMonth] = useState(thisMonth);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<{ key: string; date: string } | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [announce, setAnnounce] = useState("");
  const pending = useRef(new Map<string, PendingSave>());
  const seq = useRef(new Map<string, number>());
  const gridRef = useRef<HTMLTableElement>(null);

  const today = todayIso();
  const currentMonth = thisMonth();
  const key = `${sectionId}|${month}`;
  const data = loaded?.key === key ? loaded : null;
  const error = loadError?.key === key ? loadError.message : "";
  const canEdit = can(user, "attendance", "manage") && user.plan?.access !== "read_only";

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    const k = `${sectionId}|${month}`;
    api<Matrix>(`/attendance/matrix?sectionId=${encodeURIComponent(sectionId)}&month=${month}`)
      .then((m) => {
        if (cancelled) return;
        setLoaded({ key: k, matrix: m, statuses: Object.fromEntries(m.students.map((s) => [s.id, { ...s.statuses }])) });
        setLoadError(null);
      })
      .catch((e: Error) => !cancelled && setLoadError({ key: k, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [sectionId, month, attempt]);

  // Leaving the tab mid-burst still saves what the teacher clicked.
  useEffect(() => {
    const saves = pending.current;
    return () => {
      for (const p of saves.values()) {
        clearTimeout(p.timer);
        p.run();
      }
      saves.clear();
    };
  }, []);

  const setCell = useCallback((k: string, studentId: string, date: string, status: AttendanceStatus | undefined) => {
    setLoaded((l) => {
      if (!l || l.key !== k) return l;
      const row = { ...l.statuses[studentId] };
      if (status) row[date] = status;
      else delete row[date];
      return { ...l, statuses: { ...l.statuses, [studentId]: row } };
    });
  }, []);

  const matrix = data?.matrix ?? null;
  const statuses = data?.statuses;
  const q = query.trim().toLowerCase();
  const students = useMemo(
    () => (matrix?.students ?? []).filter((s) => !q || `${s.name} ${s.admissionNo} ${s.rollNo ?? ""}`.toLowerCase().includes(q)),
    [matrix, q],
  );
  const days = useMemo(() => matrix?.days ?? [], [matrix]);

  // Summary day: the one picked, else today, else the last register taken this month, else the first school day.
  const selectedDate = useMemo(() => {
    if (picked?.key === key && days.some((d) => d.date === picked.date)) return picked.date;
    if (days.some((d) => d.date === today)) return today;
    const taken = days.filter((d) => d.sessionId || Object.values(statuses ?? {}).some((r) => r[d.date]));
    return taken.at(-1)?.date ?? days.find((d) => d.isSchoolDay)?.date ?? days[0]?.date ?? "";
  }, [picked, key, days, today, statuses]);
  const selectDay = (date: string) => setPicked({ key, date });

  const dayCounts = useMemo(() => {
    const c = emptyCounts();
    for (const s of matrix?.students ?? []) {
      const st = statuses?.[s.id]?.[selectedDate];
      if (st) c[st]++;
    }
    return c;
  }, [matrix, statuses, selectedDate]);
  const total = matrix?.students.length ?? 0;
  const marked = dayCounts.PRESENT + dayCounts.ABSENT + dayCounts.LATE + dayCounts.LEAVE;
  const dayRate = attendanceRate(dayCounts);

  const monthCounts = useMemo(() => {
    const c = emptyCounts();
    for (const s of matrix?.students ?? []) {
      const sc = countFor(statuses?.[s.id]);
      for (const m of STATUS_META) c[m.status] += sc[m.status];
    }
    return c;
  }, [matrix, statuses]);
  const monthRate = attendanceRate(monthCounts);
  const registers = days.filter((d) => d.sessionId || (matrix?.students ?? []).some((s) => statuses?.[s.id]?.[d.date])).length;

  function commit(k: string, cellId: string, student: MatrixStudent, date: string, status: AttendanceStatus, original: AttendanceStatus | undefined) {
    pending.current.delete(cellId);
    const n = (seq.current.get(cellId) ?? 0) + 1;
    seq.current.set(cellId, n);
    api<{ saved: number; alertsSent: number }>("/attendance/sheet", {
      method: "PUT",
      body: { sectionId: k.split("|")[0], date, records: [{ studentId: student.id, status }] },
    })
      .then((res) => {
        if (res.alertsSent) toast.info("Parent alerted", `${student.name}'s parent was told about the absence on ${shortDay(date)}.`);
      })
      .catch((e: Error) => {
        // Only roll back if nothing newer was clicked on this cell meanwhile.
        if (seq.current.get(cellId) !== n || pending.current.has(cellId)) return;
        setCell(k, student.id, date, original);
        const was = original ? META_BY_STATUS[original].label.toLowerCase() : "not marked";
        toast.error(`Could not save ${student.name} on ${shortDay(date)}`, `${e.message} Changed back to ${was}.`);
        setAnnounce(`Could not save. ${student.name}, ${shortDay(date)} changed back to ${was}.`);
      })
      .finally(() => {
        if (seq.current.get(cellId) === n && !pending.current.has(cellId)) setBusy((b) => ({ ...b, [cellId]: false }));
      });
  }

  function cycle(student: MatrixStudent, date: string) {
    if (!data) return;
    const k = data.key;
    const cellId = `${k}|${student.id}|${date}`;
    const current = data.statuses[student.id]?.[date];
    const next = nextStatus(current);
    setCell(k, student.id, date, next);
    selectDay(date);
    setAnnounce(`${student.name}, ${shortDay(date)}: ${META_BY_STATUS[next].label}`);
    const prev = pending.current.get(cellId);
    if (prev) clearTimeout(prev.timer);
    const original = prev ? prev.original : current;
    const run = () => commit(k, cellId, student, date, next, original);
    pending.current.set(cellId, { timer: setTimeout(run, SAVE_DELAY), original, run });
    setBusy((b) => ({ ...b, [cellId]: true }));
  }

  // Roving focus: one tab stop for the grid, arrow keys move between cells.
  const [fr, fc] = [Math.min(focus[0], Math.max(students.length - 1, 0)), Math.min(focus[1], Math.max(days.length - 1, 0))];
  function onCellKey(e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) {
    let [nr, nc] = [r, c];
    if (e.key === "ArrowRight") nc++;
    else if (e.key === "ArrowLeft") nc--;
    else if (e.key === "ArrowDown") nr++;
    else if (e.key === "ArrowUp") nr--;
    else if (e.key === "Home") {
      nc = 0;
      if (e.ctrlKey) nr = 0;
    } else if (e.key === "End") {
      nc = days.length - 1;
      if (e.ctrlKey) nr = students.length - 1;
    } else return;
    e.preventDefault();
    nr = Math.max(0, Math.min(students.length - 1, nr));
    nc = Math.max(0, Math.min(days.length - 1, nc));
    setFocus([nr, nc]);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${nr}-${nc}"]`)?.focus();
  }

  function exportCsv() {
    if (!matrix || !statuses) return;
    const header = ["Roll no", "Admission no", "Student", ...days.map((d) => d.date), "Present", "Absent", "Late", "Excused", "Attendance %"];
    const rows = matrix.students.map((s) => {
      const c = countFor(statuses[s.id]);
      const rate = attendanceRate(c);
      return [s.rollNo, s.admissionNo, s.name, ...days.map((d) => (statuses[s.id]?.[d.date] ? META_BY_STATUS[statuses[s.id][d.date]].short : "")), c.PRESENT, c.ABSENT, c.LATE, c.LEAVE, rate ?? ""];
    });
    downloadCsv(`attendance-${matrix.section.className}-${matrix.section.name}-${matrix.month}.csv`.replace(/\s+/g, "-").toLowerCase(), header, rows);
  }

  const sectionOptions = (sections.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  const sectionLabel = matrix ? `${matrix.section.className} ${matrix.section.name}` : sectionOptions.find((o) => o.value === sectionId)?.label;

  return (
    <div className="flex flex-col gap-6">
      <Card padding="sm">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Class and section"
            value={sectionId}
            onChange={(e) => onSectionChange(e.target.value)}
            placeholder={sections.data ? "Choose a section" : "Loading sections"}
            options={sectionOptions}
            wrapperClassName="w-full sm:w-64"
          />
          <div className="flex items-end gap-1.5">
            <IconButton variant="secondary" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft />
            </IconButton>
            <TextField
              label="Month"
              type="month"
              value={month}
              max={currentMonth}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              wrapperClassName="w-44"
            />
            <IconButton variant="secondary" aria-label="Next month" disabled={month >= currentMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight />
            </IconButton>
          </div>
          {month !== currentMonth && (
            <Button type="button" variant="ghost" size="sm" className="mb-0.5" onClick={() => setMonth(currentMonth)}>
              This month
            </Button>
          )}
        </div>
        {sections.error && <p className="mt-2 text-[13px] text-danger-text">{sections.error}</p>}
        {sections.data && !sections.data.length && (
          <p className="mt-2 text-[13px] text-fg-muted">You are not a class teacher or subject teacher of any section this year.</p>
        )}
      </Card>

      {!sectionId ? (
        <Card padding="none">
          <EmptyState icon={<Table2 />} title="Choose a class to see its month" description="Pick a section above to see every register for the month in one grid." />
        </Card>
      ) : error ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
        </Card>
      ) : !matrix || !statuses ? (
        <>
          <StatGrid cols={5}>
            {["Total students", "Present", "Late", "Absent", "Excused"].map((l) => (
              <KpiCard key={l} label={l} value="0" loading />
            ))}
          </StatGrid>
          <Card padding="none" className="p-4">
            <div className="flex flex-col gap-2" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </Card>
        </>
      ) : (
        <>
          <section aria-label={`Summary for ${longDay(selectedDate)}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-fg">{longDay(selectedDate)}</h2>
                <p className="text-[13px] text-fg-muted">
                  {marked ? `${marked} of ${total} students marked.` : "No register taken for this day."} Click a day or a cell to change the summary.
                </p>
              </div>
              <NativeSelect
                aria-label="Summary day"
                value={selectedDate}
                onChange={(e) => selectDay(e.target.value)}
                options={days.map((d) => ({ value: d.date, label: `${weekdayShort(d.date)} ${shortDay(d.date)}${d.date === today ? " (today)" : ""}` }))}
                wrapperClassName="w-full sm:w-48"
              />
            </div>
            <StatGrid cols={5}>
              <KpiCard label="Total students" value={total} icon={<Users />} hint={sectionLabel} />
              <KpiCard
                label="Present"
                value={dayRate == null ? "No data" : `${dayRate.toFixed(1)}%`}
                icon={<CircleCheck />}
                tone="success"
                hint={marked ? `${dayCounts.PRESENT + dayCounts.LATE} of ${marked} marked, late included` : "Register not taken"}
              />
              <KpiCard label="Late" value={dayCounts.LATE} icon={<Clock />} tone="warning" />
              <KpiCard label="Absent" value={dayCounts.ABSENT} icon={<UserX />} tone="danger" />
              <KpiCard label="Excused" value={dayCounts.LEAVE} icon={<ShieldCheck />} tone="info" hint={total - marked > 0 && marked ? `${total - marked} not marked` : undefined} />
            </StatGrid>
          </section>

          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-fg">
                  {sectionLabel}, {monthLabel(matrix.month)}
                </h2>
                <p className="text-[13px] text-fg-muted">
                  {registers} register{registers === 1 ? "" : "s"} taken. Month average {monthRate == null ? "not available yet" : `${monthRate.toFixed(1)}%`}.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} placeholder="Find a student" wrapperClassName="w-full sm:w-52" />
                <Button type="button" variant="secondary" size="sm" icon={<Download />} onClick={exportCsv} disabled={!total}>
                  Export CSV
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface-2 px-4 py-2 text-xs text-fg-secondary sm:px-5">
              {STATUS_META.map((m) => (
                <span key={m.status} className="inline-flex items-center gap-1.5">
                  <span className={cn("grid size-5 place-items-center rounded-full border text-[11px] font-semibold", m.pill)} aria-hidden>
                    {m.short}
                  </span>
                  {m.label}
                </span>
              ))}
              <span className="text-fg-muted">
                {canEdit ? "Click a cell to cycle P, A, L, E. Arrow keys move between cells. Changes save automatically." : "View only. Arrow keys move between cells."}
              </span>
            </div>

            {!total ? (
              <EmptyState compact icon={<Users />} title="No students in this section yet" description="Students enrolled in this section will appear here." />
            ) : !students.length ? (
              <EmptyState
                compact
                title="No students match"
                description={`Nobody in this section matches "${query}".`}
                action={
                  <Button variant="secondary" size="sm" type="button" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table ref={gridRef} className="border-separate border-spacing-0 text-sm" aria-label={`Attendance for ${sectionLabel}, ${monthLabel(matrix.month)}`}>
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 top-0 z-30 min-w-36 border-b border-e border-border bg-surface-2 px-3 py-2 sm:min-w-56 sm:px-4 text-left text-xs font-medium uppercase tracking-[0.04em] text-fg-muted"
                      >
                        Student
                      </th>
                      {days.map((d) => {
                        const selected = d.date === selectedDate;
                        const isToday = d.date === today;
                        return (
                          <th
                            key={d.date}
                            scope="col"
                            aria-label={longDay(d.date)}
                            className={cn(
                              "sticky top-0 z-20 border-b border-border p-0 text-center font-normal",
                              selected ? "bg-primary-tint" : d.isSchoolDay ? "bg-surface-2" : "bg-surface-3",
                            )}
                          >
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => selectDay(d.date)}
                              title={`Show the summary for ${longDay(d.date)}`}
                              className={cn(
                                "flex w-10 flex-col items-center gap-0.5 py-1.5 text-[11px] leading-none",
                                selected || isToday ? "text-brand" : "text-fg-muted",
                              )}
                            >
                              <span className="font-medium">{weekdayShort(d.date).slice(0, 2)}</span>
                              <span className={cn("grid size-5 place-items-center rounded-full text-xs font-semibold tabular-nums", isToday && "bg-primary text-primary-fg")}>
                                {Number(d.date.slice(8))}
                              </span>
                            </button>
                          </th>
                        );
                      })}
                      <th
                        scope="col"
                        className="sticky top-0 z-30 min-w-28 sm:right-0 border-b border-s border-border bg-surface-2 px-3 py-2 text-right text-xs font-medium uppercase tracking-[0.04em] text-fg-muted"
                      >
                        Month
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, r) => {
                      const row = statuses[s.id] ?? {};
                      const counts = countFor(row);
                      const rate = attendanceRate(counts);
                      const zebra = r % 2 === 1;
                      const stickyBg = zebra ? "bg-surface-2" : "bg-surface";
                      return (
                        <tr key={s.id} className="group">
                          <th scope="row" className={cn("sticky left-0 z-10 border-b border-e border-border px-3 py-1.5 sm:px-4 text-left font-normal group-hover:bg-surface-3", stickyBg)}>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="hidden w-5 shrink-0 text-right text-xs tabular-nums text-fg-muted sm:inline">{s.rollNo ?? ""}</span>
                              <span className="hidden shrink-0 sm:inline-flex">
                                <Avatar name={s.name} src={s.photoUrl ?? undefined} size="xs" />
                              </span>
                              <div className="min-w-0">
                                <div className="max-w-28 truncate font-medium text-fg sm:max-w-40" title={s.name}>{s.name}</div>
                                <div className="text-[11px] text-fg-muted">{s.admissionNo}</div>
                              </div>
                            </div>
                          </th>
                          {days.map((d, c) => {
                            const st = row[d.date];
                            const meta = st ? META_BY_STATUS[st] : null;
                            const cellId = `${data.key}|${s.id}|${d.date}`;
                            const future = d.date > today;
                            const editable = canEdit && !future && (d.isSchoolDay || !!st);
                            const what = meta ? meta.label : future ? "Not marked yet" : d.isSchoolDay ? "Not marked" : "No school";
                            const action = editable ? (meta ? ". Change" : ". Mark present") : "";
                            return (
                              <td
                                key={d.date}
                                className={cn(
                                  "border-b border-border p-0 text-center",
                                  d.date === selectedDate ? "bg-primary-tint/50" : !d.isSchoolDay ? "bg-surface-3/60" : zebra && "bg-surface-2/60",
                                )}
                              >
                                <button
                                  type="button"
                                  data-cell={`${r}-${c}`}
                                  tabIndex={r === fr && c === fc ? 0 : -1}
                                  aria-label={`${s.name}, ${shortDay(d.date)}: ${what}${action}`}
                                  aria-disabled={!editable || undefined}
                                  aria-busy={busy[cellId] || undefined}
                                  onFocus={() => {
                                    setFocus([r, c]);
                                    selectDay(d.date);
                                  }}
                                  onClick={() => editable && cycle(s, d.date)}
                                  onKeyDown={(e) => onCellKey(e, r, c)}
                                  className={cn(
                                    "m-1 grid size-8 place-items-center rounded-full border text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                                    meta ? meta.pill : "border-transparent text-fg-disabled",
                                    editable ? "cursor-pointer active:scale-[0.94]" : "cursor-default",
                                    editable && !meta && "hover:border-border-strong hover:text-fg-muted",
                                    editable && meta && "hover:brightness-95",
                                    busy[cellId] && "ring-2 ring-primary/40",
                                  )}
                                >
                                  <span aria-hidden>{meta ? meta.short : d.isSchoolDay && !future ? "·" : ""}</span>
                                </button>
                              </td>
                            );
                          })}
                          <td className={cn("z-10 border-b border-s sm:sticky sm:right-0 border-border px-3 py-1.5 text-right group-hover:bg-surface-3", stickyBg)}>
                            <MonthRate rate={rate} counts={counts} name={s.name} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className="sticky bottom-0 left-0 z-30 border-e border-t border-border bg-surface-2 px-3 py-2 sm:px-4 text-left text-xs font-medium text-fg-secondary">
                        Present that day
                      </th>
                      {days.map((d) => {
                        const c = emptyCounts();
                        for (const s of matrix.students) {
                          const st = statuses[s.id]?.[d.date];
                          if (st) c[st]++;
                        }
                        const rate = attendanceRate(c);
                        return (
                          <td
                            key={d.date}
                            className={cn(
                              "sticky bottom-0 z-20 border-t border-border px-0.5 py-2 text-center text-[11px] tabular-nums",
                              d.date === selectedDate ? "bg-primary-tint text-brand" : "bg-surface-2 text-fg-secondary",
                            )}
                          >
                            {rate == null ? <span className="text-fg-disabled">-</span> : Math.round(rate)}
                          </td>
                        );
                      })}
                      <td className="sticky bottom-0 z-30 sm:right-0 border-s border-t border-border bg-surface-2 px-3 py-2 text-right text-xs font-semibold tabular-nums text-fg">
                        {monthRate == null ? "-" : `${monthRate.toFixed(1)}%`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
          <div className="sr-only" aria-live="polite">
            {announce}
          </div>
        </>
      )}
    </div>
  );
}

function MonthRate({ rate, counts, name }: { rate: number | null; counts: StatusCounts; name: string }) {
  if (rate == null) return <span className="text-xs text-fg-muted">No data</span>;
  const tone = rate >= 90 ? "bg-success" : rate >= 75 ? "bg-warning" : "bg-danger";
  const detail = `${counts.PRESENT} present, ${counts.LATE} late, ${counts.ABSENT} absent, ${counts.LEAVE} excused`;
  return (
    <span title={detail} className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, rate)}%` }} />
      </span>
      <span className={cn("w-12 text-sm font-medium tabular-nums", rate < 75 ? "text-danger-text" : "text-fg")} aria-hidden>
        {rate.toFixed(1)}%
      </span>
      <span className="sr-only">{`${name}: ${rate.toFixed(1)}% this month. ${detail}.`}</span>
    </span>
  );
}
