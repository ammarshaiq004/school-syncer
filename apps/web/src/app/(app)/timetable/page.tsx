"use client";

import { useEffect, useState } from "react";
import { BellRing, CalendarDays, CalendarRange, Plus, Save, Trash2, UserRound } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  NativeSelect,
  PageHeader,
  SelectField,
  Skeleton,
  SkeletonRows,
  StatusPill,
  Switch,
  TabPanel,
  Tabs,
  useToast,
} from "@/components/ui";
import { DAYS, SlotText, subjectBlockStyle, visibleDays, WeekGrid, type Period, type Slot } from "@/components/week-grid";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, TEACHING, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Week { section: { id: string; name: string }; periods: Period[]; slots: Slot[] }
interface SectionSubject { subject: { id: string; name: string }; teacher: { name: string } | null }

export default function TimetablePage() {
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const isTeacher = hasRole(user, TEACHING) && !isAdmin;
  // Kept here so switching tabs does not lose the chosen section.
  const [sectionId, setSectionId] = useState("");
  const section = <SectionTimetable editable={isAdmin} sectionId={sectionId} onSectionChange={setSectionId} />;

  const tabs = [
    ...(isTeacher ? [{ value: "mine", label: "My week", icon: <UserRound /> }] : []),
    { value: "section", label: "Class timetables", icon: <CalendarRange /> },
    ...(isAdmin ? [{ value: "bells", label: "Bell schedule", icon: <BellRing /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Timetable"
        description={isAdmin ? "Plan each section's week and set the bell schedule for every campus." : "Weekly class schedules, by period and day."}
        breadcrumbs={[{ label: "Academics" }, { label: "Timetable" }]}
      />
      {tabs.length > 1 ? (
        <Tabs tabs={tabs} aria-label="Timetable views">
          {isTeacher && (
            <TabPanel value="mine">
              <MyWeek />
            </TabPanel>
          )}
          <TabPanel value="section">{section}</TabPanel>
          {isAdmin && (
            <TabPanel value="bells">
              <BellSchedule />
            </TabPanel>
          )}
        </Tabs>
      ) : (
        section
      )}
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
      <CardHeader
        icon={<UserRound />}
        title="My week"
        description={mine.data ? `${slots.length} lesson${slots.length === 1 ? "" : "s"} across ${periods.length} period${periods.length === 1 ? "" : "s"}` : "Classes you teach, by period."}
      />
      {mine.error ? (
        <ErrorState compact message={mine.error} onRetry={mine.reload} />
      ) : !mine.data ? (
        <GridSkeleton />
      ) : !slots.length ? (
        <EmptyState compact icon={<CalendarDays />} title="No classes timetabled for you yet" description="Once the timetable is set, your lessons show up here." />
      ) : (
        <WeekGrid
          periods={periods}
          days={visibleDays(slots)}
          cell={(day, p) => <SlotText slot={slots.find((s) => s.dayOfWeek === day && s.periodId === p.id)} show="section" />}
        />
      )}
    </Card>
  );
}

function GridSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }, (_, k) => (
            <Skeleton key={k} className="h-12" />
          ))}
        </div>
      ))}
    </div>
  );
}

function SectionTimetable({ editable, sectionId, onSectionChange }: { editable: boolean; sectionId: string; onSectionChange: (id: string) => void }) {
  const toast = useToast();
  const sections = useSectionOptions();
  const [loaded, setLoaded] = useState<{ sectionId: string; week: Week } | null>(null);
  const [loadError, setLoadError] = useState<{ sectionId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [subjects, setSubjects] = useState<SectionSubject[]>([]);
  // "day|periodId" -> subjectId
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saturday, setSaturday] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const week = loaded?.sectionId === sectionId ? loaded.week : null;
  const sectionError = loadError?.sectionId === sectionId ? loadError.message : "";

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    Promise.all([
      api<Week>(`/timetable/sections/${sectionId}`),
      editable ? api<SectionSubject[]>(`/classes/sections/${sectionId}/subjects`) : Promise.resolve([]),
    ])
      .then(([w, subs]) => {
        if (cancelled) return;
        setLoaded({ sectionId, week: w });
        setLoadError(null);
        setSubjects(subs);
        setDraft(Object.fromEntries(w.slots.map((s) => [`${s.dayOfWeek}|${s.periodId}`, s.subjectId])));
        setDirty(false);
        setError("");
      })
      .catch((e: Error) => !cancelled && setLoadError({ sectionId, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [sectionId, editable, attempt]);

  async function save() {
    setSaving(true);
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
      setLoaded({ sectionId, week: w });
      setError("");
      setDirty(false);
      toast.success("Timetable saved");
    } catch (e) {
      setError((e as Error).message);
      toast.error("Could not save the timetable", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const days = week ? visibleDays(week.slots, saturday) : [];
  const sectionLabel = sections.options.find((o) => o.value === sectionId)?.label;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <SelectField
          label="Section"
          value={sectionId}
          onChange={(e) => onSectionChange(e.target.value)}
          placeholder="Choose a section"
          options={sections.options}
          wrapperClassName="w-full sm:w-64"
        />
        {editable && week && (
          <div className="flex flex-wrap items-center gap-3">
            {dirty && <StatusPill status="PENDING" label="Unsaved changes" />}
            <Switch checked={saturday} onCheckedChange={setSaturday} label="Saturday" />
            <Button type="button" onClick={save} loading={saving} icon={<Save />}>
              Save timetable
            </Button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-danger-text">{error}</p>}
      {!sectionId ? (
        <EmptyState compact icon={<CalendarRange />} title="Choose a section" description="Pick a class and section to see its weekly timetable." />
      ) : sectionError ? (
        <ErrorState compact message={sectionError} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !week ? (
        <GridSkeleton />
      ) : !week.periods.length ? (
        <EmptyState
          compact
          icon={<BellRing />}
          title="No bell schedule yet"
          description={`This campus has no periods set.${editable ? " Add periods on the Bell schedule tab first." : ""}`}
        />
      ) : (
        <>
          {sectionLabel && <h2 className="sr-only">{sectionLabel} timetable</h2>}
          <WeekGrid
            periods={week.periods}
            days={days}
            cell={(day, p) => {
              const slot = week.slots.find((s) => s.dayOfWeek === day && s.periodId === p.id);
              if (!editable) return <SlotText slot={slot} show="teacher" />;
              const key = `${day}|${p.id}`;
              const chosen = subjects.find((s) => s.subject.id === draft[key]);
              return (
                <div
                  className={cn("rounded-md border-s-[3px] p-1", chosen ? "" : "border-transparent")}
                  style={chosen ? subjectBlockStyle(chosen.subject.name) : undefined}
                >
                  <NativeSelect
                    value={draft[key] ?? ""}
                    onChange={(e) => {
                      setDraft((d) => ({ ...d, [key]: e.target.value }));
                      setDirty(true);
                    }}
                    aria-label={`${DAYS[day]} ${p.name}`}
                    placeholder="Free"
                    options={subjects.map((s) => ({ value: s.subject.id, label: s.subject.name }))}
                    wrapperClassName="w-full"
                    className="h-8 bg-surface/80 px-2 text-[13px] shadow-none"
                  />
                  {chosen && <div className="mt-1 truncate px-1 text-xs text-fg-secondary">{chosen.teacher?.name ?? "No teacher"}</div>}
                </div>
              );
            }}
          />
        </>
      )}
      {editable && week && !subjects.length && (
        <p className="mt-3 text-[13px] text-fg-muted">Set this section&apos;s subjects and teachers on the Classes screen first.</p>
      )}
    </Card>
  );
}

interface Campus { id: string; name: string }
type PeriodDraft = { id?: string; name: string; startTime: string; endTime: string; isBreak: boolean };

function BellSchedule() {
  const toast = useToast();
  const campuses = useApi<Campus[]>("/campuses");
  const [campusId, setCampusId] = useState("");
  const current = campusId || campuses.data?.[0]?.id || "";
  const periods = useApi<Period[]>(current ? `/timetable/periods?campusId=${current}` : null);
  const [draft, setDraft] = useState<PeriodDraft[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
    try {
      await api("/timetable/periods", {
        method: "PUT",
        body: { campusId: current, periods: rows.map(({ id, name, startTime, endTime, isBreak }) => ({ id, name, startTime, endTime, isBreak })) },
      });
      setDraft(null);
      setError("");
      toast.success("Bell schedule saved");
      await periods.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const loading = !campuses.error && (!campuses.data || (!!current && !periods.data && !periods.error));
  return (
    <Card>
      <CardHeader
        icon={<BellRing />}
        title="Bell schedule"
        description="The periods of a school day for each campus. Mark breaks so they show as shaded rows."
        action={
          (campuses.data?.length ?? 0) > 1 ? (
            <NativeSelect
              aria-label="Campus"
              value={current}
              onChange={(e) => {
                setCampusId(e.target.value);
                setDraft(null);
              }}
              options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              wrapperClassName="w-48"
            />
          ) : undefined
        }
      />
      {campuses.error ? (
        <ErrorState compact message={campuses.error} onRetry={campuses.reload} />
      ) : periods.error && !draft ? (
        <ErrorState compact message={periods.error} onRetry={periods.reload} />
      ) : loading ? (
        <SkeletonRows rows={5} columns={4} />
      ) : !current ? (
        <EmptyState compact icon={<BellRing />} title="No campus yet" description="Add a campus in settings before setting its bell schedule." />
      ) : !rows.length ? (
        <EmptyState
          compact
          icon={<BellRing />}
          title="No periods yet"
          description="Add the first period of the day. Each new one starts when the last one ends."
          action={<Button type="button" variant="secondary" icon={<Plus />} onClick={addRow}>Add period</Button>}
        />
      ) : (
        <div className="overflow-x-auto">
          <ol className="flex min-w-[520px] flex-col divide-y divide-border rounded-lg border border-border">
            <li className="grid grid-cols-[minmax(8rem,1fr)_7rem_7rem_6rem_2.5rem] items-center gap-3 bg-surface-2 px-3 py-2 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted" aria-hidden>
              <span>Name</span>
              <span>Starts</span>
              <span>Ends</span>
              <span>Break</span>
              <span />
            </li>
            {rows.map((r, i) => (
              <li
                key={r.id ?? `new-${i}`}
                className={cn("grid grid-cols-[minmax(8rem,1fr)_7rem_7rem_6rem_2.5rem] items-center gap-3 px-3 py-2 text-sm", r.isBreak && "bg-surface-2")}
              >
                <Input className="h-8" value={r.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`Name of period ${i + 1}`} />
                <Input className="h-8 tabular-nums" type="time" value={r.startTime} onChange={(e) => update(i, { startTime: e.target.value })} aria-label={`${r.name} starts`} />
                <Input className="h-8 tabular-nums" type="time" value={r.endTime} onChange={(e) => update(i, { endTime: e.target.value })} aria-label={`${r.name} ends`} />
                <Switch checked={r.isBreak} onCheckedChange={(v) => update(i, { isBreak: v })} aria-label={`${r.name} is a break`} />
                <IconButton size="sm" aria-label={`Remove ${r.name}`} onClick={() => setDraft(rows.filter((_, k) => k !== i))}>
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger-text">{error}</p>}
      {!!current && !loading && !campuses.error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <span className="text-[13px] text-fg-muted">{draft ? "You have unsaved changes." : `${rows.filter((r) => !r.isBreak).length} teaching periods, ${rows.filter((r) => r.isBreak).length} breaks`}</span>
          <div className="flex gap-2">
            {rows.length > 0 && (
              <Button type="button" variant="secondary" icon={<Plus />} onClick={addRow}>
                Add period
              </Button>
            )}
            <Button type="button" onClick={save} disabled={!draft} loading={saving} icon={<Save />}>
              Save bell schedule
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
