"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CircleCheck, Clock, ClipboardList, Save, UserX, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  SearchInput,
  SelectField,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day, todayIso } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import type { AttendanceStatus } from "./status";

type Status = AttendanceStatus;
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

/** P / A / L / E toggles. "Excused" is the LEAVE status in the API. */
const OPTIONS: { status: Status; short: string; label: string; on: string; hover: string }[] = [
  { status: "PRESENT", short: "P", label: "Present", on: "border-success bg-success text-white", hover: "hover:border-success/50 hover:text-success-text" },
  { status: "ABSENT", short: "A", label: "Absent", on: "border-danger bg-danger text-white", hover: "hover:border-danger/50 hover:text-danger-text" },
  { status: "LATE", short: "L", label: "Late", on: "border-warning bg-warning text-white", hover: "hover:border-warning/50 hover:text-warning-text" },
  { status: "LEAVE", short: "E", label: "Excused", on: "border-info bg-info text-white", hover: "hover:border-info/50 hover:text-info-text" },
];

const name = (s: SheetStudent) => [s.firstName, s.lastName].filter(Boolean).join(" ");

interface MySection {
  id: string;
  name: string;
  students: number;
  isClassTeacher: boolean;
}

interface DayRegisterProps {
  sectionId: string;
  onSectionChange: (id: string) => void;
  date: string;
  onDateChange: (date: string) => void;
}

/** "Take attendance" tab: the daily register for one section, plus the all-sections summary for admins. */
export function DayRegister({ sectionId, onSectionChange: setSectionId, date, onDateChange: setDate }: DayRegisterProps) {
  const user = useSession();
  const toast = useToast();
  const isAdmin = hasRole(user, SETUP);
  // Teachers pick from the sections they teach (the rest answer 403); admins
  // pick any section in the school.
  const allSections = useSectionOptions({ enabled: isAdmin });
  const mySections = useApi<MySection[]>(isAdmin ? null : "/attendance/sections");
  // The loaded sheet remembers which section and date it belongs to, so a switch shows a skeleton.
  const [loaded, setLoaded] = useState<{ key: string; sheet: Sheet } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const summary = useApi<SummaryRow[]>(isAdmin ? `/attendance/summary?date=${date}` : null);
  const sectionOptions = isAdmin ? allSections.options : (mySections.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  const sectionsError = isAdmin ? allSections.error : mySections.error;

  // Open a teacher's own class first, so the usual register is one tap away.
  useEffect(() => {
    if (sectionId || isAdmin) return;
    const list = mySections.data;
    if (!list?.length) return;
    setSectionId((list.find((s) => s.isClassTeacher) ?? list[0]).id);
  }, [sectionId, isAdmin, mySections.data, setSectionId]);

  const key = `${sectionId}|${date}`;
  const sheet = loaded?.key === key ? loaded.sheet : null;
  const sheetError = loadError?.key === key ? loadError.message : "";

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    const k = `${sectionId}|${date}`;
    api<Sheet>(`/attendance/sheet?sectionId=${sectionId}&date=${date}`)
      .then((s) => {
        if (cancelled) return;
        setLoaded({ key: k, sheet: s });
        setLoadError(null);
        // Unmarked students default to present so a teacher only taps the absentees.
        setMarks(Object.fromEntries(s.students.map((st) => [st.id, st.status ?? "PRESENT"])));
        setError("");
        setNotice("");
      })
      .catch((e: Error) => !cancelled && setLoadError({ key: k, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [sectionId, date, attempt]);

  async function save() {
    if (!sheet) return;
    setSaving(true);
    try {
      const res = await api<{ saved: number; counts: Record<Status, number>; alertsSent: number }>("/attendance/sheet", {
        method: "PUT",
        body: { sectionId, date, records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })) },
      });
      const message =
        `Saved ${res.saved} students: ${res.counts.PRESENT} present, ${res.counts.ABSENT} absent, ${res.counts.LATE} late, ${res.counts.LEAVE} excused.` +
        (res.alertsSent ? ` ${res.alertsSent} parent alert(s) sent on WhatsApp.` : "");
      setNotice(message);
      toast.success("Register saved", message);
      setError("");
      // Reflect the saved marks so the unsaved-changes count resets.
      setLoaded({
        key,
        sheet: { ...sheet, taken: true, takenBy: sheet.takenBy ?? user.name, students: sheet.students.map((s) => ({ ...s, status: marks[s.id] ?? s.status })) },
      });
      if (isAdmin) await summary.reload();
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    } finally {
      setSaving(false);
    }
  }

  const markAll = (status: Status) => sheet && setMarks(Object.fromEntries(sheet.students.map((s) => [s.id, status])));

  const counts = useMemo(() => {
    const c: Record<Status, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
    for (const s of sheet?.students ?? []) c[marks[s.id] ?? "PRESENT"]++;
    return c;
  }, [sheet, marks]);
  const total = sheet?.students.length ?? 0;
  const presentPct = total ? ((counts.PRESENT + counts.LATE) / total) * 100 : 0;
  const changes = sheet ? sheet.students.filter((s) => s.status !== marks[s.id]).length : 0;

  const q = query.trim().toLowerCase();
  const visible = (sheet?.students ?? []).filter((s) => !q || `${name(s)} ${s.admissionNo} ${s.rollNo ?? ""}`.toLowerCase().includes(q));

  const summaryColumns: Column<SummaryRow>[] = [
    { id: "name", header: "Section", sortValue: (r) => r.name, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    { id: "campus", header: "Campus", sortValue: (r) => r.campus, cell: (r) => r.campus, hideBelow: "md" },
    { id: "enrolled", header: "Enrolled", align: "right", sortValue: (r) => r.enrolled, cell: (r) => r.enrolled },
    { id: "present", header: "Present", align: "right", sortValue: (r) => (r.taken ? r.present : -1), cell: (r) => (r.taken ? r.present : <span className="text-fg-disabled">-</span>) },
    { id: "absent", header: "Absent", align: "right", sortValue: (r) => (r.taken ? r.absent : -1), cell: (r) => (r.taken ? <span className={r.absent ? "text-danger-text" : undefined}>{r.absent}</span> : <span className="text-fg-disabled">-</span>) },
    { id: "leave", header: "Excused", align: "right", sortValue: (r) => (r.taken ? r.leave : -1), cell: (r) => (r.taken ? r.leave : <span className="text-fg-disabled">-</span>), hideBelow: "sm" },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => (r.taken ? 1 : 0),
      cell: (r) => (r.taken ? <StatusPill status="TAKEN" tone="success" label="Taken" /> : <StatusPill status="PENDING" label="Not taken" />),
    },
  ];
  const takenCount = summary.data?.filter((r) => r.taken).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Card padding="sm">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Class and section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            placeholder="Choose a section"
            options={sectionOptions}
            wrapperClassName="w-full sm:w-64"
          />
          <TextField
            label="Date"
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            wrapperClassName="w-full sm:w-44"
          />
          {sheet?.taken && (
            <div className="pb-2">
              <StatusPill status="TAKEN" tone="success" label={`Taken${sheet.takenBy ? ` by ${sheet.takenBy}` : ""}`} />
            </div>
          )}
        </div>
        {sectionsError && <p className="mt-2 text-[13px] text-danger-text">{sectionsError}</p>}
      </Card>

      {!sectionId ? (
        <Card padding="none">
          <EmptyState
            icon={<ClipboardList />}
            title={!isAdmin && mySections.data?.length === 0 ? "No sections assigned" : "Choose a class to take attendance"}
            description={
              isAdmin
                ? "Pick a section above, or click a row in the summary below."
                : mySections.data?.length === 0
                  ? "Ask the school office to make you a class teacher or assign you a subject."
                  : "Pick one of your sections above to open its register."
            }
          />
        </Card>
      ) : sheetError ? (
        <Card padding="none">
          <ErrorState message={sheetError} onRetry={() => setAttempt((n) => n + 1)} />
        </Card>
      ) : !sheet ? (
        <>
          <StatGrid>
            {["Students", "Present", "Late", "Absent"].map((l) => <KpiCard key={l} label={l} value="0" loading />)}
          </StatGrid>
          <Card padding="none">
            <SkeletonRows rows={8} columns={3} className="p-4" />
          </Card>
        </>
      ) : (
        <>
          <StatGrid>
            <KpiCard label="Students" value={total} icon={<Users />} hint={`${sheet.section.className} ${sheet.section.name}`} />
            <KpiCard label="Present" value={`${presentPct.toFixed(1)}%`} icon={<CircleCheck />} tone="success" hint={`${counts.PRESENT + counts.LATE} of ${total}, late included`} />
            <KpiCard label="Late" value={counts.LATE} icon={<Clock />} tone="warning" hint={counts.LEAVE ? `${counts.LEAVE} excused` : undefined} />
            <KpiCard label="Absent" value={counts.ABSENT} icon={<UserX />} tone="danger" hint={counts.ABSENT ? "Parents can be alerted" : "No absences"} />
          </StatGrid>

          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-fg">
                  {sheet.section.className} {sheet.section.name}
                </h2>
                <p className="text-[13px] text-fg-muted">Register for {day(date)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery("")}
                  placeholder="Find a student"
                  wrapperClassName="w-full sm:w-52"
                />
                <div className="flex items-center gap-1" role="group" aria-label="Mark everyone">
                  <span className="me-1 text-xs font-medium text-fg-muted">Mark all</span>
                  {OPTIONS.map((o) => (
                    <button
                      key={o.status}
                      type="button"
                      onClick={() => markAll(o.status)}
                      disabled={!total}
                      aria-label={`Mark all ${o.label.toLowerCase()}`}
                      title={`Mark all ${o.label.toLowerCase()}`}
                      className={cn(
                        "grid size-8 place-items-center rounded-full border border-border bg-surface text-xs font-semibold text-fg-secondary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50",
                        o.hover,
                      )}
                    >
                      {o.short}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {!total ? (
              <EmptyState compact icon={<Users />} title="No students in this section yet" description="Students enrolled in this section will appear here." />
            ) : !visible.length ? (
              <EmptyState compact title="No students match" description={`Nobody in this register matches "${query}".`} action={<Button variant="secondary" size="sm" type="button" onClick={() => setQuery("")}>Clear search</Button>} />
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((s) => {
                  const current = marks[s.id];
                  const full = name(s);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 even:bg-surface-2/60 sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-fg-muted">{s.rollNo ?? ""}</span>
                        <Avatar name={full} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-fg">{full}</div>
                          <div className="text-xs text-fg-muted">{s.admissionNo}</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5" role="group" aria-label={`Attendance for ${full}`}>
                        {OPTIONS.map((o) => {
                          const on = current === o.status;
                          return (
                            <button
                              key={o.status}
                              type="button"
                              onClick={() => setMarks((m) => ({ ...m, [s.id]: o.status }))}
                              aria-pressed={on}
                              aria-label={`${o.label} ${full}`}
                              title={o.label}
                              className={cn(
                                "inline-flex h-8 min-w-9 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring active:scale-[0.97]",
                                on ? o.on : cn("border-border bg-surface text-fg-muted", o.hover),
                              )}
                            >
                              {o.short}
                              <span className="hidden lg:inline">{o.label.slice(1)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}
          {error && <Alert tone="danger" title="Could not save the register" onDismiss={() => setError("")}>{error}</Alert>}

          {total > 0 && (
            <div className="sticky bottom-4 z-20 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-overlay animate-rise">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-secondary">
                  <span className="font-medium text-fg tabular-nums">
                    {counts.PRESENT} P · {counts.ABSENT} A · {counts.LATE} L · {counts.LEAVE} E
                  </span>
                  {changes > 0 ? (
                    <StatusPill status="PENDING" label={sheet.taken ? `${changes} unsaved change${changes === 1 ? "" : "s"}` : "Not saved yet"} />
                  ) : (
                    <StatusPill status="SAVED" tone="success" label="All changes saved" />
                  )}
                </div>
                <Button type="button" onClick={save} loading={saving} disabled={saving || !total} icon={<Save />}>
                  {saving ? "Saving" : "Save register"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {isAdmin && (
        <Card padding="none" className="overflow-hidden">
          <div className="px-4 pt-4 sm:px-5">
            <CardHeader
              icon={<CalendarCheck />}
              title={`All sections on ${day(date)}`}
              description={summary.data ? `${takenCount} of ${summary.data.length} registers taken. Click a row to open it.` : "Registers taken across the school."}
            />
          </div>
          <DataTable
            bare
            label="Attendance by section"
            columns={summaryColumns}
            data={summary.data}
            error={summary.error}
            onRetry={summary.reload}
            getRowId={(r) => r.sectionId}
            onRowClick={(r) => {
              setSectionId(r.sectionId);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            getRowLabel={(r) => `Open register for ${r.name}`}
            rowClassName={(r) => (r.sectionId === sectionId ? "bg-primary-tint/60" : undefined)}
            getSearchText={(r) => `${r.name} ${r.campus}`}
            searchPlaceholder="Search sections"
            empty={{ title: "No sections yet", description: "Create classes and sections to start taking attendance." }}
            pageSize={0}
          />
        </Card>
      )}
    </div>
  );
}
