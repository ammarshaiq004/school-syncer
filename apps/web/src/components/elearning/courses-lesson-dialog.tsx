"use client";

import { useState, type FormEvent } from "react";
import { FileText, Link2, CirclePlay, ScrollText, type LucideIcon } from "lucide-react";
import { Alert, Button, Dialog, SegmentedControl, SelectField, Switch, TextareaField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { LESSON_KIND_LABEL, type CourseUnit, type Lesson, type LessonKind } from "./courses-types";

export const LESSON_KIND_ICON: Record<LessonKind, LucideIcon> = {
  VIDEO: CirclePlay,
  TEXT: ScrollText,
  LINK: Link2,
  DOCUMENT: FileText,
};

const URL_HINT: Record<Exclude<LessonKind, "TEXT">, string> = {
  VIDEO: "YouTube and Vimeo links play inside the lesson. Other video links open in a new tab.",
  LINK: "Any https page, for example a Khan Academy exercise or a simulation.",
  DOCUMENT: "A shared Google Drive, OneDrive or Dropbox link to a PDF, slides or worksheet.",
};

const FORM_ID = "lesson-editor-form";

export interface LessonDialogTarget {
  /** Unit the lesson is added to (new lesson) or currently lives in. */
  unitId: string;
  lesson?: Lesson;
}

/** Add or edit a lesson. Reading lessons need text; the other kinds need an https link. */
export function LessonDialog({
  target,
  units,
  onClose,
  onSaved,
}: {
  target: LessonDialogTarget | null;
  units: CourseUnit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target?.lesson ? "Edit lesson" : "Add lesson"}
      description={target?.lesson ? target.lesson.title : `To ${units.find((u) => u.id === target?.unitId)?.title ?? "this unit"}`}
      size="lg"
    >
      {target && <LessonForm key={target.lesson?.id ?? `new-${target.unitId}`} target={target} units={units} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function LessonForm({ target, units, onClose, onSaved }: { target: LessonDialogTarget; units: CourseUnit[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const lesson = target.lesson;
  const [kind, setKind] = useState<LessonKind>(lesson?.kind ?? "VIDEO");
  const [published, setPublished] = useState(lesson?.isPublished ?? false);
  const [unitId, setUnitId] = useState(target.unitId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const title = String(f.get("title") ?? "").trim();
    const url = String(f.get("url") ?? "").trim();
    const body = String(f.get("body") ?? "").trim();
    const duration = String(f.get("durationMin") ?? "").trim();
    if (kind === "TEXT" && !body) return setError("Write the lesson text before saving.");
    if (kind !== "TEXT" && !url.startsWith("https://")) return setError("Paste a link that starts with https://");
    const payload = {
      title,
      kind,
      url: kind === "TEXT" ? (url || null) : url,
      body: body || null,
      durationMin: duration ? Number(duration) : null,
      isPublished: published,
    };
    setSaving(true);
    setError("");
    try {
      if (lesson) {
        await api(`/elearning/lessons/${lesson.id}`, { method: "PATCH", body: { ...payload, ...(unitId !== lesson.unitId ? { unitId } : {}) } });
        toast.success("Lesson saved", title);
      } else {
        await api(`/elearning/units/${target.unitId}/lessons`, {
          method: "POST",
          body: { ...payload, url: payload.url ?? undefined, body: payload.body ?? undefined, durationMin: payload.durationMin ?? undefined },
        });
        toast.success("Lesson added", title);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id={FORM_ID} onSubmit={submit} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField name="title" label="Lesson title" required minLength={2} maxLength={160} defaultValue={lesson?.title} placeholder="Adding fractions with unlike denominators" />
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-fg">Lesson type</span>
        <SegmentedControl<LessonKind>
          aria-label="Lesson type"
          value={kind}
          onChange={setKind}
          options={(Object.keys(LESSON_KIND_LABEL) as LessonKind[]).map((k) => {
            const Icon = LESSON_KIND_ICON[k];
            return { value: k, label: LESSON_KIND_LABEL[k], icon: <Icon /> };
          })}
        />
      </div>
      {kind !== "TEXT" && (
        <TextField
          name="url"
          type="url"
          label={kind === "VIDEO" ? "Video link" : kind === "DOCUMENT" ? "Document link" : "Web link"}
          required
          defaultValue={lesson?.url ?? ""}
          placeholder={kind === "VIDEO" ? "https://www.youtube.com/watch?v=..." : "https://"}
          hint={URL_HINT[kind]}
        />
      )}
      <TextareaField
        name="body"
        label={kind === "TEXT" ? "Lesson text" : "Notes for students (optional)"}
        required={kind === "TEXT"}
        rows={kind === "TEXT" ? 10 : 4}
        defaultValue={lesson?.body ?? ""}
        placeholder={kind === "TEXT" ? "Write the lesson. Blank lines start a new paragraph." : "What to watch for, questions to answer in your notebook"}
        hint="Plain text. Line breaks are kept."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="durationMin" type="number" min={1} max={600} label="Duration in minutes (optional)" defaultValue={lesson?.durationMin ?? ""} placeholder="15" />
        {lesson && units.length > 1 && (
          <SelectField label="Unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} options={units.map((u) => ({ value: u.id, label: u.title }))} />
        )}
      </div>
      <Switch checked={published} onCheckedChange={setPublished} label="Published (students can see this lesson)" />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {lesson ? "Save lesson" : "Add lesson"}
        </Button>
      </div>
    </form>
  );
}
