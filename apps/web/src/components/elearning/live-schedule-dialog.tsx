"use client";

import { useState, type FormEvent } from "react";
import { CalendarClock, Link2, Video } from "lucide-react";
import { Alert, Button, Dialog, SelectField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";
import { addDays, liveDate, liveDay, liveTime, mondayOf, PROVIDER_LABEL, schoolInstant, type LiveClass, type LiveProvider } from "./live-types";

interface SectionSubject {
  subject: { id: string; name: string };
  teacher: { id: string; name: string } | null;
}

const PROVIDER_HINT: Record<LiveProvider, string> = {
  JITSI: "Free. A private room link is created for you.",
  ZOOM: "Paste the Zoom meeting link.",
  GOOGLE_MEET: "Paste the Meet link from Google Calendar.",
  OTHER: "Teams, Webex or any https meeting link.",
};

/** Schedule a new live class, or change one that has not started. */
export function ScheduleLiveDialog({
  open,
  onOpenChange,
  editing,
  defaultSectionId,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: LiveClass | null;
  defaultSectionId?: string;
  defaultDate?: string;
  onSaved: (c: LiveClass) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit live class" : "Schedule a live class"}
      description={editing ? editing.title : "Students see it on their Today screen and can join from 15 minutes before the start."}
      size="lg"
    >
      {open && (
        <ScheduleForm
          key={editing?.id ?? "new"}
          editing={editing ?? null}
          defaultSectionId={defaultSectionId}
          defaultDate={defaultDate}
          onCancel={() => onOpenChange(false)}
          onSaved={(c) => {
            onOpenChange(false);
            onSaved(c);
          }}
        />
      )}
    </Dialog>
  );
}

function ScheduleForm({
  editing,
  defaultSectionId,
  defaultDate,
  onCancel,
  onSaved,
}: {
  editing: LiveClass | null;
  defaultSectionId?: string;
  defaultDate?: string;
  onCancel: () => void;
  onSaved: (c: LiveClass) => void;
}) {
  const toast = useToast();
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState(editing?.sectionId ?? defaultSectionId ?? "");
  const subjects = useApi<SectionSubject[]>(sectionId ? `/classes/sections/${sectionId}/subjects` : null);
  const [subjectId, setSubjectId] = useState(editing?.subjectId ?? "");
  const [provider, setProvider] = useState<LiveProvider>(editing?.provider ?? "JITSI");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const subjectName = subjects.data?.find((s) => s.subject.id === subjectId)?.subject.name;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const date = String(f.get("date"));
    const time = String(f.get("time"));
    const joinUrl = String(f.get("joinUrl") ?? "").trim();
    const title = String(f.get("title") ?? "").trim();
    if (provider !== "JITSI" && !joinUrl.startsWith("https://")) return setError("Paste the meeting link for this class. It must start with https://");
    const body = {
      subjectId: subjectId || null,
      title: title || undefined,
      startsAt: schoolInstant(date, time),
      durationMin: Number(f.get("durationMin")),
      provider,
      // Jitsi rooms are created (and kept) by the server; other apps need the pasted link.
      ...(provider !== "JITSI" ? { joinUrl } : {}),
    };
    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await api<LiveClass>(`/elearning/live/${editing.id}`, { method: "PATCH", body })
        : await api<LiveClass>("/elearning/live", { method: "POST", body: { ...body, sectionId } });
      toast.success(editing ? "Live class updated" : "Live class scheduled", `${saved.title}, ${liveDate(saved.startsAt) === todayIso() ? "today" : liveDate(saved.startsAt)} at ${liveTime(saved.startsAt)}`);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const defaultDay = editing ? liveDate(editing.startsAt) : (defaultDate ?? todayIso());
  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Section"
          required
          disabled={!!editing}
          value={sectionId}
          onChange={(e) => {
            setSectionId(e.target.value);
            setSubjectId("");
          }}
          placeholder="Choose a section"
          options={sections.options}
        />
        <SelectField
          label="Subject"
          disabled={!sectionId}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          placeholder="No subject (class meeting)"
          options={(subjects.data ?? []).map((s) => ({ value: s.subject.id, label: s.subject.name }))}
          hint="Teachers must pick a subject they teach in this section."
        />
      </div>
      <TextField name="title" label="Title" maxLength={160} defaultValue={editing?.title} placeholder={subjectName ? `${subjectName}: revision of chapter 4` : "Defaults to the subject name"} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="date" type="date" label="Date" required defaultValue={defaultDay} />
        <TextField name="time" type="time" label="Start time" required defaultValue={editing ? liveTime(editing.startsAt) : "09:00"} />
        <TextField name="durationMin" type="number" label="Duration (minutes)" required min={5} max={300} defaultValue={editing?.durationMin ?? 40} />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium text-fg">Meeting app</legend>
        <div role="radiogroup" aria-label="Meeting app" className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(PROVIDER_LABEL) as LiveProvider[]).map((p) => {
            const selected = provider === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setProvider(p)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                  selected ? "border-brand bg-primary-tint" : "border-border hover:bg-surface-2",
                )}
              >
                <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", selected ? "bg-primary text-primary-fg" : "bg-surface-3 text-fg-muted")}>
                  {p === "JITSI" ? <Video className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
                </span>
                <span>
                  <span className="block text-sm font-medium text-fg">
                    {PROVIDER_LABEL[p]}
                    {p === "JITSI" && <span className="ms-1.5 text-xs font-normal text-brand">Automatic</span>}
                  </span>
                  <span className="block text-[13px] text-fg-muted">{PROVIDER_HINT[p]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {provider !== "JITSI" && (
        <TextField
          name="joinUrl"
          type="url"
          label="Meeting link"
          required
          defaultValue={editing && editing.provider === provider ? editing.joinUrl : ""}
          placeholder={provider === "ZOOM" ? "https://us05web.zoom.us/j/..." : provider === "GOOGLE_MEET" ? "https://meet.google.com/abc-defg-hij" : "https://"}
        />
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" icon={<CalendarClock />} loading={saving} disabled={!sectionId}>
          {editing ? "Save changes" : "Schedule class"}
        </Button>
      </div>
    </form>
  );
}

interface FromTimetableResult {
  weekStart: string;
  created: number;
  skippedExisting: number;
  skippedPast: number;
}

/** Creates a Jitsi class for every timetable period of a section in one week. */
export function FromTimetableDialog({
  open,
  onOpenChange,
  defaultSectionId,
  defaultWeek,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultSectionId?: string;
  defaultWeek?: string;
  onDone: (weekStart: string) => void;
}) {
  const toast = useToast();
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState(defaultSectionId ?? "");
  const [week, setWeek] = useState(defaultWeek ?? mondayOf(todayIso()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSectionId(defaultSectionId ?? "");
      setWeek(defaultWeek ?? mondayOf(todayIso()));
      setError("");
    }
  }

  async function run() {
    setSaving(true);
    setError("");
    try {
      const res = await api<FromTimetableResult>("/elearning/live/from-timetable", { method: "POST", body: { sectionId, weekStart: week } });
      const skipped = [res.skippedExisting && `${res.skippedExisting} already scheduled`, res.skippedPast && `${res.skippedPast} already past`].filter(Boolean).join(", ");
      if (res.created) toast.success(`${res.created} live ${res.created === 1 ? "class" : "classes"} scheduled`, skipped ? `Skipped ${skipped}.` : undefined);
      else toast.info("No new classes", skipped ? `Skipped ${skipped}.` : "This section has no timetable periods for you that week.");
      onOpenChange(false);
      onDone(res.weekStart);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const monday = week ? mondayOf(week) : "";
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule from timetable"
      description="Creates a Jitsi live class for each timetable period of the section that week. Periods already scheduled or already over are skipped."
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" icon={<CalendarClock />} loading={saving} disabled={!sectionId || !week} onClick={run}>
            Schedule week
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <SelectField label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Choose a section" options={sections.options} />
        <TextField
          type="date"
          label="Week"
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          hint={week ? `${liveDay(`${monday}T12:00:00+05:00`)} to ${liveDay(`${addDays(monday, 6)}T12:00:00+05:00`)}` : undefined}
        />
      </div>
    </Dialog>
  );
}
