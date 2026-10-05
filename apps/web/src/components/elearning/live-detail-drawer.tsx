"use client";

import { useState, type FormEvent } from "react";
import { Ban, CalendarCheck, Copy, ExternalLink, Pencil, Play, Square, Trash2 } from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  buttonClass,
  ConfirmDialog,
  DescriptionList,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  ProgressBar,
  SkeletonRows,
  StatusPill,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { LiveStatusPill, useNow } from "./live-status";
import { liveDay, liveTime, PROVIDER_LABEL, sectionLabel, type LiveAttendance, type LiveClass } from "./live-types";

type Confirm = "end" | "cancel" | "delete" | null;

/** Live class details, start/end/cancel, recording link and who joined. */
export function LiveDetailDrawer({
  liveClassId,
  canManage,
  onClose,
  onChanged,
  onEdit,
}: {
  liveClassId: string | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (c: LiveClass) => void;
}) {
  const { data, error, reload } = useApi<LiveAttendance>(liveClassId ? `/elearning/live/${liveClassId}/attendance` : null);
  const shown = data && data.liveClass.id === liveClassId ? data : null;
  const c = shown?.liveClass;
  return (
    <Drawer
      open={!!liveClassId}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={c?.title ?? "Live class"}
      description={c ? `${sectionLabel(c)}${c.subject ? ` · ${c.subject.name}` : ""} · ${liveDay(c.startsAt)}, ${liveTime(c.startsAt)} to ${liveTime(c.endsAt)}` : undefined}
      headerExtra={c && <LiveStatusPill status={c.status} />}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && !shown ? (
        <ErrorState message={error} onRetry={reload} compact />
      ) : !shown ? (
        <SkeletonRows rows={6} />
      ) : (
        <DetailBody
          key={shown.liveClass.id}
          data={shown}
          canManage={canManage}
          onChanged={async () => {
            await reload();
            onChanged();
          }}
          onDeleted={() => {
            onClose();
            onChanged();
          }}
          onEdit={onEdit}
        />
      )}
    </Drawer>
  );
}

function DetailBody({
  data,
  canManage,
  onChanged,
  onDeleted,
  onEdit,
}: {
  data: LiveAttendance;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onEdit: (c: LiveClass) => void;
}) {
  const toast = useToast();
  const c = data.liveClass;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [recording, setRecording] = useState(c.recordingUrl ?? "");
  const now = useNow();

  async function act(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      await onChanged();
      return true;
    } catch (e) {
      toast.error("Could not update the class", (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmAction() {
    if (confirm === "delete") {
      setBusy("delete");
      try {
        await api(`/elearning/live/${c.id}`, { method: "DELETE" });
        toast.success("Live class deleted", c.title);
        setConfirm(null);
        onDeleted();
      } catch (e) {
        toast.error("Could not delete", (e as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (confirm === "end") await act("end", () => api(`/elearning/live/${c.id}/end`, { method: "POST", body: recording.trim() ? { recordingUrl: recording.trim() } : {} }), "Class ended");
    if (confirm === "cancel") await act("cancel", () => api(`/elearning/live/${c.id}/cancel`, { method: "POST" }), "Class cancelled");
    setConfirm(null);
  }

  async function saveRecording(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = recording.trim();
    if (url && !url.startsWith("https://")) return toast.error("Recording link must start with https://");
    await act("recording", () => api(`/elearning/live/${c.id}`, { method: "PATCH", body: { recordingUrl: url || null } }), url ? "Recording link saved" : "Recording link removed");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(c.joinUrl);
      toast.success("Meeting link copied");
    } catch {
      toast.error("Could not copy", c.joinUrl);
    }
  }

  const open = c.status === "SCHEDULED" || c.status === "LIVE";
  // A scheduled class that was held without pressing Start can be closed once its start time has passed.
  const startedTime = c.status === "SCHEDULED" && new Date(c.startsAt).getTime() <= now;
  const pct = data.studentCount ? (data.joinedCount / data.studentCount) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {c.status === "SCHEDULED" && (
            <Button icon={<Play />} loading={busy === "start"} onClick={() => act("start", () => api(`/elearning/live/${c.id}/start`, { method: "POST" }), "Class is live. Students can join now.")}>
              Start class
            </Button>
          )}
          {open && (
            <a href={c.joinUrl} target="_blank" rel="noopener noreferrer" className={buttonClass(c.status === "LIVE" ? "primary" : "secondary", "md")}>
              <ExternalLink className="size-4" aria-hidden />
              Open meeting
            </a>
          )}
          {open && (
            <Button variant="secondary" icon={<Copy />} onClick={copyLink}>
              Copy link
            </Button>
          )}
          {(c.status === "LIVE" || startedTime) && (
            <Button variant="secondary" icon={<Square />} onClick={() => setConfirm("end")}>
              {c.status === "LIVE" ? "End class" : "Mark as held"}
            </Button>
          )}
          {c.status === "SCHEDULED" && (
            <>
              <Button variant="ghost" icon={<Pencil />} onClick={() => onEdit(c)}>
                Edit
              </Button>
              <Button variant="ghost" icon={<Ban />} onClick={() => setConfirm("cancel")}>
                Cancel class
              </Button>
            </>
          )}
          {c.status !== "LIVE" && data.joinedCount === 0 && (
            <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirm("delete")}>
              Delete
            </Button>
          )}
        </div>
      )}

      <DescriptionList
        items={[
          { label: "Teacher", value: c.teacher?.name ?? "Not assigned" },
          { label: "Meeting app", value: PROVIDER_LABEL[c.provider] },
          { label: "Starts", value: `${liveDay(c.startsAt)}, ${liveTime(c.startsAt)}` },
          { label: "Duration", value: `${c.durationMin} min` },
          ...(c.startedAt ? [{ label: "Started", value: liveTime(c.startedAt) }] : []),
          ...(c.endedAt ? [{ label: "Ended", value: liveTime(c.endedAt) }] : []),
          {
            label: "Join link",
            full: true,
            value: (
              <a href={c.joinUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">
                {c.joinUrl}
              </a>
            ),
          },
        ]}
      />

      {c.status !== "CANCELLED" && (
        <section aria-labelledby="recording-heading" className="flex flex-col gap-2">
          <h3 id="recording-heading" className="text-sm font-semibold text-fg">
            Recording
          </h3>
          {canManage ? (
            <form onSubmit={saveRecording} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="url"
                aria-label="Recording link"
                placeholder="https://www.youtube.com/watch?v=... or a Google Drive link"
                value={recording}
                onChange={(e) => setRecording(e.target.value)}
                className="sm:flex-1"
              />
              <Button type="submit" variant="secondary" loading={busy === "recording"} disabled={recording.trim() === (c.recordingUrl ?? "")}>
                Save link
              </Button>
            </form>
          ) : c.recordingUrl ? (
            <a href={c.recordingUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand hover:underline">
              {c.recordingUrl}
            </a>
          ) : (
            <p className="text-sm text-fg-muted">No recording shared.</p>
          )}
          <p className="text-[13px] text-fg-muted">Students see the recording under Recent classes once the class has ended.</p>
        </section>
      )}

      <section aria-labelledby="attendance-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="attendance-heading" className="text-sm font-semibold text-fg">
            Attendance
          </h3>
          {canManage && data.canMarkAttendance && (
            <Button
              size="sm"
              icon={<CalendarCheck />}
              loading={busy === "mark"}
              onClick={() =>
                act(
                  "mark",
                  () => api<{ present: number; absent: number }>(`/elearning/live/${c.id}/mark-attendance`, { method: "POST" }),
                  `Attendance for ${liveDay(c.startsAt)} saved from this class`,
                )
              }
            >
              Save as daily attendance
            </Button>
          )}
        </div>
        <ProgressBar value={pct} label="Students who joined" valueText={`${data.joinedCount} of ${data.studentCount}`} tone={pct >= 75 ? "success" : pct >= 50 ? "warning" : "danger"} />
        {data.sheetTaken && <Alert tone="info">Daily attendance for {liveDay(c.startsAt)} has already been taken for this section, so it is not changed from here.</Alert>}
        {!data.sheetTaken && c.status !== "ENDED" && c.status !== "CANCELLED" && canManage && (
          <p className="text-[13px] text-fg-muted">After you end the class you can save who joined as the section&apos;s daily attendance (joined is present, the rest absent).</p>
        )}
        {data.students.length === 0 ? (
          <EmptyState title="No students in this section" compact />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.students.map((s) => {
              const name = fullName(s);
              return (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={name} src={s.photoUrl ?? undefined} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{name}</p>
                    <p className="text-xs text-fg-muted">
                      {s.rollNo != null ? `Roll ${s.rollNo} · ` : ""}
                      {s.admissionNo}
                    </p>
                  </div>
                  {s.joined ? (
                    <span className="text-right">
                      <StatusPill status="PRESENT" label="Joined" />
                      {s.joinedAt && <span className="mt-0.5 block text-xs tabular-nums text-fg-muted">{liveTime(s.joinedAt)}{s.leftAt ? ` to ${liveTime(s.leftAt)}` : ""}</span>}
                    </span>
                  ) : (
                    <StatusPill status={c.status === "ENDED" ? "ABSENT" : "PENDING"} label={c.status === "ENDED" ? "Did not join" : "Not joined yet"} tone={c.status === "ENDED" ? "danger" : "neutral"} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm !== "end"}
        loading={busy === confirm}
        title={confirm === "end" ? (c.status === "LIVE" ? "End this class?" : "Mark this class as held?") : confirm === "cancel" ? "Cancel this class?" : "Delete this class?"}
        description={
          confirm === "end"
            ? "Students can no longer join. You can still add the recording link and save attendance afterwards."
            : confirm === "cancel"
              ? "Students see it as cancelled on their schedule."
              : "It is removed from the schedule for everyone."
        }
        confirmLabel={confirm === "end" ? (c.status === "LIVE" ? "End class" : "Mark as held") : confirm === "cancel" ? "Cancel class" : "Delete"}
        cancelLabel="Keep"
        onConfirm={confirmAction}
      />
    </div>
  );
}
