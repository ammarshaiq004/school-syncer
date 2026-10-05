"use client";

import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Alert, Button, Dialog, SelectField, TextareaField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";

/** Course accent colours (the chart palette as hex, since the API stores #RRGGBB). */
export const COURSE_COLORS = [
  { value: "#4F46E5", label: "Indigo" },
  { value: "#0284C7", label: "Sky" },
  { value: "#059669", label: "Emerald" },
  { value: "#D97706", label: "Amber" },
  { value: "#E11D48", label: "Rose" },
  { value: "#475569", label: "Slate" },
];

interface SectionSubject {
  subject: { id: string; name: string };
  teacher: { id: string; name: string } | null;
}

/** Colour swatches as a radio group. */
export function ColorPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-fg">Colour</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Course colour">
        {COURSE_COLORS.map((c) => {
          const selected = value?.toUpperCase() === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={c.label}
              onClick={() => onChange(c.value)}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full text-primary-fg ring-offset-2 ring-offset-surface transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                selected && "ring-2 ring-fg",
              )}
              style={{ backgroundColor: c.value }}
            >
              {selected && <Check className="size-4" aria-hidden />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** New course for one subject of a section. */
export function CreateCourseDialog({
  open,
  onOpenChange,
  defaultSectionId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultSectionId?: string;
  onCreated: (course: { id: string; title: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New course" description="One course per subject in a section. Lessons stay hidden from students until you publish them." size="md">
      {open && <CreateCourseForm defaultSectionId={defaultSectionId} onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
    </Dialog>
  );
}

function CreateCourseForm({ defaultSectionId, onCancel, onCreated }: { defaultSectionId?: string; onCancel: () => void; onCreated: (c: { id: string; title: string }) => void }) {
  const toast = useToast();
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState(defaultSectionId ?? "");
  const subjects = useApi<SectionSubject[]>(sectionId ? `/classes/sections/${sectionId}/subjects` : null);
  const [subjectId, setSubjectId] = useState("");
  const [color, setColor] = useState<string>(COURSE_COLORS[0].value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const subject = subjects.data?.find((s) => s.subject.id === subjectId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const course = await api<{ id: string; title: string }>("/elearning/courses", {
        method: "POST",
        body: {
          sectionId,
          subjectId,
          title: String(f.get("title") ?? "").trim() || undefined,
          description: String(f.get("description") ?? "").trim() || undefined,
          color,
        },
      });
      toast.success("Course created", course.title);
      onCreated(course);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Section"
          required
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
          required
          disabled={!sectionId}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          placeholder={sectionId && subjects.data?.length === 0 ? "No subjects in this section" : "Choose a subject"}
          options={(subjects.data ?? []).map((s) => ({ value: s.subject.id, label: s.subject.name }))}
          hint={subject?.teacher ? `Taught by ${subject.teacher.name}` : undefined}
        />
      </div>
      <TextField name="title" label="Course title" maxLength={120} placeholder={subject ? subject.subject.name : "Defaults to the subject name"} />
      <TextareaField name="description" label="Description (optional)" rows={3} placeholder="What students will learn this term" />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!sectionId || !subjectId}>
          Create course
        </Button>
      </div>
    </form>
  );
}

/** Creates a course for every subject of a section that has none yet. */
export function GenerateCoursesDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const toast = useToast();
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setSaving(true);
    setError("");
    try {
      const res = await api<{ created: number }>("/elearning/courses/generate", { method: "POST", body: { sectionId } });
      if (res.created) toast.success(`${res.created} ${res.created === 1 ? "course" : "courses"} created`);
      else toast.info("Nothing to create", "Every subject you teach in this section already has a course.");
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create courses for a section"
      description="Adds an empty draft course for each subject of the section that does not have one yet."
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" loading={saving} disabled={!sectionId} onClick={run}>
            Create courses
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <SelectField label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Choose a section" options={sections.options} />
      </div>
    </Dialog>
  );
}
