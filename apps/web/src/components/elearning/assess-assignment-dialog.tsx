"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, SelectField, Switch, TextareaField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import type { CourseSummary } from "./courses-types";
import { fromLocalInput, toLocalInput, type Assignment } from "./assess-types";

interface SectionSubject {
  subject: { id: string; name: string };
  teacher: { id: string; name: string } | null;
}

/** Section and subject pickers (plus an optional course link) shared by the assignment and quiz create forms. */
export function useSectionSubjectCourse(initial?: { sectionId?: string; subjectId?: string; courseId?: string | null }) {
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState(initial?.sectionId ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? "");
  const [courseId, setCourseId] = useState(initial?.courseId ?? "");
  const subjects = useApi<SectionSubject[]>(sectionId ? `/classes/sections/${sectionId}/subjects` : null);
  const courses = useApi<CourseSummary[]>(sectionId && subjectId ? `/elearning/courses?sectionId=${sectionId}&subjectId=${subjectId}` : null);
  return {
    sections,
    subjects,
    courses,
    sectionId,
    subjectId,
    courseId,
    setSectionId: (v: string) => {
      setSectionId(v);
      setSubjectId("");
      setCourseId("");
    },
    setSubjectId: (v: string) => {
      setSubjectId(v);
      setCourseId("");
    },
    setCourseId,
  };
}

export type SectionSubjectCourse = ReturnType<typeof useSectionSubjectCourse>;

/** Section, subject and course selects. Section and subject are fixed when `locked`. */
export function SectionSubjectFields({ state, locked }: { state: SectionSubjectCourse; locked?: boolean }) {
  const user = useSession();
  const { sections, subjects, courses } = state;
  const subject = subjects.data?.find((s) => s.subject.id === state.subjectId);
  // Admins can set work for any subject; teachers for the subjects they teach, or every subject of their own class.
  const classTeacher = sections.classes.some((c) => c.sections.some((s) => s.id === state.sectionId && s.classTeacher?.id === user.sub));
  const canUse = (s: SectionSubject) => hasRole(user, SETUP) || classTeacher || s.teacher?.id === user.sub;
  const courseOptions = (courses.data ?? []).filter((c) => c.subjectId === state.subjectId && c.sectionId === state.sectionId);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SelectField
        label="Section"
        required
        disabled={locked}
        value={state.sectionId}
        onChange={(e) => state.setSectionId(e.target.value)}
        placeholder="Choose a section"
        options={sections.options}
      />
      <SelectField
        label="Subject"
        required
        disabled={locked || !state.sectionId}
        value={state.subjectId}
        onChange={(e) => state.setSubjectId(e.target.value)}
        placeholder={state.sectionId && subjects.data?.length === 0 ? "No subjects in this section" : "Choose a subject"}
        options={(subjects.data ?? []).map((s) => ({
          value: s.subject.id,
          label: canUse(s) ? s.subject.name : `${s.subject.name} (not your subject)`,
          disabled: !canUse(s),
        }))}
        hint={subject?.teacher ? `Taught by ${subject.teacher.name}` : undefined}
      />
      <SelectField
        label="Course (optional)"
        disabled={!state.subjectId || courseOptions.length === 0}
        value={state.courseId}
        onChange={(e) => state.setCourseId(e.target.value)}
        placeholder={state.subjectId && courses.data && courseOptions.length === 0 ? "No course yet" : "Not linked"}
        options={courseOptions.map((c) => ({ value: c.id, label: c.title }))}
      />
    </div>
  );
}

/** Create or edit an assignment. Pass `assignment` to edit (section and subject stay fixed). */
export function AssignmentDialog({
  open,
  onOpenChange,
  assignment,
  defaultSectionId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignment?: Assignment | null;
  defaultSectionId?: string;
  onSaved: (a: Assignment) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={assignment ? "Edit assignment" : "New assignment"}
      description={assignment ? `${assignment.section.class.name} ${assignment.section.name} · ${assignment.subject.name}` : "Students in the section see it once it is published."}
      size="lg"
    >
      {open && <AssignmentForm key={assignment?.id ?? "new"} assignment={assignment ?? null} defaultSectionId={defaultSectionId} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
    </Dialog>
  );
}

/** Default due time for a new assignment: a week from today at 5:00 pm school time. */
function defaultDue() {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return `${toLocalInput(d.toISOString()).slice(0, 10)}T17:00`;
}

function AssignmentForm({
  assignment,
  defaultSectionId,
  onCancel,
  onSaved,
}: {
  assignment: Assignment | null;
  defaultSectionId?: string;
  onCancel: () => void;
  onSaved: (a: Assignment) => void;
}) {
  const toast = useToast();
  const picks = useSectionSubjectCourse({
    sectionId: assignment?.sectionId ?? defaultSectionId,
    subjectId: assignment?.subjectId,
    courseId: assignment?.courseId,
  });
  const [allowLate, setAllowLate] = useState(assignment?.allowLate ?? true);
  const [publish, setPublish] = useState(assignment?.isPublished ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const dueAt = fromLocalInput(text("dueAt"));
    const attachmentUrl = text("attachmentUrl");
    if (!dueAt) return setError("Choose a due date and time.");
    if (attachmentUrl && !attachmentUrl.startsWith("https://")) return setError("Links must start with https://");
    const body = {
      title: text("title"),
      instructions: text("instructions") || null,
      attachmentUrl: attachmentUrl || null,
      dueAt,
      maxPoints: Number(text("maxPoints")) || 100,
      allowLate,
      isPublished: publish,
      courseId: picks.courseId || null,
    };
    setSaving(true);
    setError("");
    try {
      const saved = assignment
        ? await api<Assignment>(`/elearning/assignments/${assignment.id}`, { method: "PATCH", body })
        : await api<Assignment>("/elearning/assignments", { method: "POST", body: { ...body, sectionId: picks.sectionId, subjectId: picks.subjectId } });
      toast.success(assignment ? "Assignment updated" : publish ? "Assignment published" : "Assignment saved as draft", saved.title);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <SectionSubjectFields state={picks} locked={!!assignment} />
      <TextField name="title" label="Title" required minLength={2} maxLength={160} defaultValue={assignment?.title} placeholder="Fractions worksheet: adding unlike denominators" />
      <TextareaField
        name="instructions"
        label="Instructions"
        rows={5}
        maxLength={20000}
        defaultValue={assignment?.instructions ?? ""}
        placeholder="Solve questions 1 to 10 on page 42. Show your working and upload a photo or type your answers."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="dueAt" type="datetime-local" label="Due" required defaultValue={assignment ? toLocalInput(assignment.dueAt) : defaultDue()} hint="Pakistan time" />
        <TextField name="maxPoints" type="number" inputMode="numeric" label="Points" min={1} max={1000} step={1} required defaultValue={assignment?.maxPoints ?? 100} />
      </div>
      <TextField
        name="attachmentUrl"
        type="url"
        label="Attachment link (optional)"
        placeholder="https://drive.google.com/..."
        pattern="https://.*"
        defaultValue={assignment?.attachmentUrl ?? ""}
        hint="A worksheet or reading on Google Drive, OneDrive or any https link"
      />
      <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
        <Switch checked={allowLate} onCheckedChange={setAllowLate} label="Accept late work (marked as late)" />
        <Switch checked={publish} onCheckedChange={setPublish} label="Published: visible to students" />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!assignment && (!picks.sectionId || !picks.subjectId)}>
          {assignment ? "Save changes" : "Create assignment"}
        </Button>
      </div>
    </form>
  );
}
