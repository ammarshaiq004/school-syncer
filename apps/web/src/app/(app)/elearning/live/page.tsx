"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Ellipsis, ExternalLink, List, Play, Plus, Users, Video } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  DataTable,
  DropdownItem,
  DropdownMenu,
  ErrorState,
  IconButton,
  NativeSelect,
  PageHeader,
  SegmentedControl,
  SkeletonRows,
  Toolbar,
  ToolbarSpacer,
  useToast,
  type Column,
} from "@/components/ui";
import { subjectBlockStyle } from "@/components/week-grid";
import { LiveDetailDrawer } from "@/components/elearning/live-detail-drawer";
import { FromTimetableDialog, ScheduleLiveDialog } from "@/components/elearning/live-schedule-dialog";
import { LiveStatusPill, useNow } from "@/components/elearning/live-status";
import { addDays, countdown, liveDate, liveDay, liveTime, mondayOf, PROVIDER_LABEL, sectionLabel, type LiveClass, type LiveStatus } from "@/components/elearning/live-types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/format";
import { usePersistedState } from "@/lib/persisted";
import { useSectionOptions } from "@/lib/sections";
import { useCan } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type View = "week" | "list";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function LiveClassesPage() {
  const toast = useToast();
  const can = useCan();
  const canManage = can("elearning", "manage");
  const now = useNow();
  const sections = useSectionOptions();
  const [view, setView] = usePersistedState<View>("schoolsyncer.live.view", "week");
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState<"" | LiveStatus>("");
  const [week, setWeek] = useState(() => mondayOf(todayIso()));
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ editing?: LiveClass; date?: string } | null>(null);
  const [fromTimetable, setFromTimetable] = useState(false);

  const params = new URLSearchParams();
  if (sectionId) params.set("sectionId", sectionId);
  if (view === "week") {
    params.set("from", week);
    params.set("to", addDays(week, 6));
  } else if (status) params.set("status", status);
  const { data, error, reload } = useApi<LiveClass[]>(`/elearning/live?${params}`);
  const openRow = data?.find((c) => c.id === openId);
  const liveNow = (data ?? []).filter((c) => c.status === "LIVE");

  async function start(c: LiveClass) {
    try {
      await api(`/elearning/live/${c.id}/start`, { method: "POST" });
      toast.success("Class is live", `${c.title}. Students can join now.`);
      await reload();
    } catch (e) {
      toast.error("Could not start the class", (e as Error).message);
    }
  }

  const columns: Column<LiveClass>[] = [
    {
      id: "when",
      header: "When",
      sortValue: (c) => c.startsAt,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium tabular-nums text-fg">
            {liveDay(c.startsAt)}, {liveTime(c.startsAt)}
          </span>
          <span className="text-xs text-fg-muted">
            {c.status === "SCHEDULED" && new Date(c.startsAt).getTime() > now ? countdown(c.startsAt, now) : `${c.durationMin} min`}
          </span>
        </span>
      ),
    },
    {
      id: "title",
      header: "Class",
      sortValue: (c) => c.title,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{c.title}</span>
          <span className="text-xs text-fg-muted">
            {sectionLabel(c)}
            {c.subject && c.subject.name !== c.title ? ` · ${c.subject.name}` : ""}
          </span>
        </span>
      ),
    },
    { id: "teacher", header: "Teacher", hideBelow: "lg", sortValue: (c) => c.teacher?.name ?? "", cell: (c) => c.teacher?.name ?? <span className="text-fg-muted">Not assigned</span> },
    { id: "provider", header: "App", hideBelow: "md", cell: (c) => PROVIDER_LABEL[c.provider] },
    { id: "joined", header: "Joined", align: "right", hideBelow: "sm", sortValue: (c) => c.attendanceCount, cell: (c) => c.attendanceCount },
    { id: "status", header: "Status", sortValue: (c) => c.status, cell: (c) => <LiveStatusPill status={c.status} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "48px",
      cell: (c) => (
        <DropdownMenu trigger={<IconButton size="sm" aria-label={`Actions for ${c.title}, ${liveDay(c.startsAt)}`}><Ellipsis /></IconButton>}>
          <DropdownItem icon={<Users />} onSelect={() => setOpenId(c.id)}>
            Details and attendance
          </DropdownItem>
          {c.canManage && c.status === "SCHEDULED" && (
            <DropdownItem icon={<Play />} onSelect={() => void start(c)}>
              Start class
            </DropdownItem>
          )}
          {(c.status === "SCHEDULED" || c.status === "LIVE") && (
            <DropdownItem icon={<ExternalLink />} onSelect={() => window.open(c.joinUrl, "_blank", "noopener,noreferrer")}>
              Open meeting
            </DropdownItem>
          )}
          {c.recordingUrl && (
            <DropdownItem icon={<Video />} onSelect={() => window.open(c.recordingUrl!, "_blank", "noopener,noreferrer")}>
              Watch recording
            </DropdownItem>
          )}
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live classes"
        description="Online lessons on Jitsi, Zoom or Google Meet. Students join from their workspace and attendance is recorded automatically."
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Live classes" }]}
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<CalendarRange />} onClick={() => setFromTimetable(true)}>
                Schedule from timetable
              </Button>
              <Button icon={<Plus />} onClick={() => setScheduling({})}>
                Schedule class
              </Button>
            </>
          )
        }
      />

      {liveNow.length > 0 && (
        <Alert
          tone="danger"
          icon={<Video />}
          title={liveNow.length === 1 ? `${liveNow[0].title} is live now` : `${liveNow.length} classes are live now`}
          action={
            <Button size="sm" variant="secondary" onClick={() => setOpenId(liveNow[0].id)}>
              View attendance
            </Button>
          }
        >
          {liveNow.map((c) => `${sectionLabel(c)} with ${c.teacher?.name ?? "no teacher"}`).join(", ")}
        </Alert>
      )}

      <Toolbar>
        <SegmentedControl<View>
          aria-label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "week", label: "Week", icon: <CalendarDays /> },
            { value: "list", label: "List", icon: <List /> },
          ]}
        />
        <NativeSelect aria-label="Section" placeholder="All sections" options={sections.options} value={sectionId} onChange={(e) => setSectionId(e.target.value)} wrapperClassName="w-44" />
        {view === "list" && (
          <NativeSelect
            aria-label="Status"
            placeholder="All statuses"
            options={[
              { value: "SCHEDULED", label: "Scheduled" },
              { value: "LIVE", label: "Live now" },
              { value: "ENDED", label: "Ended" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | LiveStatus)}
            wrapperClassName="w-40"
          />
        )}
        <ToolbarSpacer />
        {view === "week" && (
          <div className="flex items-center gap-1">
            <IconButton variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
              <ChevronLeft />
            </IconButton>
            <Button size="sm" variant="secondary" onClick={() => setWeek(mondayOf(todayIso()))} disabled={week === mondayOf(todayIso())}>
              This week
            </Button>
            <IconButton variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
              <ChevronRight />
            </IconButton>
            <span className="ms-2 text-sm font-medium tabular-nums text-fg" aria-live="polite">
              {liveDay(`${week}T12:00:00+05:00`)} to {liveDay(`${addDays(week, 6)}T12:00:00+05:00`)}
            </span>
          </div>
        )}
      </Toolbar>

      {view === "list" ? (
        <DataTable
          label="Live classes"
          columns={columns}
          data={data}
          error={error}
          onRetry={reload}
          getRowId={(c) => c.id}
          getSearchText={(c) => `${c.title} ${sectionLabel(c)} ${c.subject?.name ?? ""} ${c.teacher?.name ?? ""}`}
          searchPlaceholder="Search class, section or teacher"
          filtered={!!(sectionId || status)}
          onRowClick={(c) => setOpenId(c.id)}
          getRowLabel={(c) => `${c.title}, ${liveDay(c.startsAt)}`}
          rowClassName={(c) => cn(c.status === "CANCELLED" && "text-fg-muted")}
          empty={{
            title: "No live classes",
            description: "Classes from the last 30 days onward appear here. Schedule one, or create a week of classes from the timetable.",
            action: canManage ? (
              <Button icon={<Plus />} onClick={() => setScheduling({})}>
                Schedule class
              </Button>
            ) : undefined,
          }}
        />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <SkeletonRows rows={6} />
      ) : (
        <WeekCalendar
          week={week}
          classes={data}
          canManage={canManage}
          onOpen={setOpenId}
          onAdd={(date) => setScheduling({ date })}
          onFromTimetable={() => setFromTimetable(true)}
        />
      )}

      <LiveDetailDrawer
        liveClassId={openId}
        canManage={openRow?.canManage ?? canManage}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        onEdit={(c) => {
          setOpenId(null);
          setScheduling({ editing: c });
        }}
      />
      <ScheduleLiveDialog
        open={!!scheduling}
        onOpenChange={(o) => !o && setScheduling(null)}
        editing={scheduling?.editing}
        defaultSectionId={sectionId || undefined}
        defaultDate={scheduling?.date}
        onSaved={(c) => {
          if (view === "week") setWeek(mondayOf(liveDate(c.startsAt)));
          void reload();
        }}
      />
      <FromTimetableDialog
        open={fromTimetable}
        onOpenChange={setFromTimetable}
        defaultSectionId={sectionId || undefined}
        defaultWeek={week}
        onDone={(weekStart) => {
          setView("week");
          setWeek(weekStart);
          void reload();
        }}
      />
    </div>
  );
}

function WeekCalendar({
  week,
  classes,
  canManage,
  onOpen,
  onAdd,
  onFromTimetable,
}: {
  week: string;
  classes: LiveClass[];
  canManage: boolean;
  onOpen: (id: string) => void;
  onAdd: (date: string) => void;
  onFromTimetable: () => void;
}) {
  const today = todayIso();
  const byDay = useMemo(() => {
    const map = new Map<string, LiveClass[]>();
    for (const c of classes) {
      const d = liveDate(c.startsAt);
      map.set(d, [...(map.get(d) ?? []), c]);
    }
    return map;
  }, [classes]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d, i) => i < 6 || byDay.has(d));

  return (
    <div className="flex flex-col gap-3">
      {classes.length === 0 && (
        <Alert tone="info" title="Nothing scheduled this week">
          <p>Create a week of classes from the timetable in one go, or add single classes with the plus button on a day.</p>
          {canManage && (
            <Button size="sm" variant="secondary" icon={<CalendarRange />} onClick={onFromTimetable} className="mt-3">
              Schedule from timetable
            </Button>
          )}
        </Alert>
      )}
      <div className={cn("grid gap-3 sm:grid-cols-2", days.length === 7 ? "lg:grid-cols-7" : "lg:grid-cols-6")}>
        {days.map((d, i) => {
          const items = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <Card key={d} padding="none" className={cn("flex min-h-40 flex-col", isToday && "border-brand")}>
              <div className={cn("flex items-center justify-between gap-2 border-b border-border px-3 py-2", isToday ? "bg-primary-tint" : "bg-surface-2")}>
                <h2 className={cn("text-sm font-semibold", isToday ? "text-brand" : "text-fg")}>
                  {DAY_NAMES[i]} <span className="font-normal tabular-nums text-fg-muted">{Number(d.slice(8, 10))}</span>
                  {isToday && <span className="sr-only"> (today)</span>}
                </h2>
                {canManage && d >= today && (
                  <IconButton size="sm" aria-label={`Schedule a class on ${liveDay(`${d}T12:00:00+05:00`)}`} onClick={() => onAdd(d)}>
                    <Plus />
                  </IconButton>
                )}
              </div>
              {items.length === 0 ? (
                <p className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[13px] text-fg-muted">No classes</p>
              ) : (
                <ul className="flex flex-col gap-2 p-2">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        style={subjectBlockStyle(c.subject?.name ?? c.title)}
                        className={cn(
                          "w-full rounded-lg border-s-[3px] px-2.5 py-2 text-left transition hover:shadow-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                          c.status === "CANCELLED" && "line-through decoration-fg-muted",
                        )}
                        aria-label={`${c.title}, ${sectionLabel(c)}, ${liveTime(c.startsAt)}, ${c.status.toLowerCase()}`}
                      >
                        <span className="block text-xs tabular-nums text-fg-secondary">
                          {liveTime(c.startsAt)} to {liveTime(c.endsAt)}
                        </span>
                        <span className="block truncate text-sm font-medium text-fg">{c.title}</span>
                        <span className="block truncate text-xs text-fg-muted">{sectionLabel(c)}</span>
                        {c.status !== "SCHEDULED" && (
                          <span className="mt-1.5 block">
                            <LiveStatusPill status={c.status} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
