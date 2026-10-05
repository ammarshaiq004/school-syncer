"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChartColumn, ChevronDown, ChevronUp, Ellipsis, ExternalLink, Layers, ListTree, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Switch,
  TabPanel,
  Tabs,
  TextareaField,
  TextField,
  Tooltip,
  useToast,
} from "@/components/ui";
import { ColorPicker } from "@/components/elearning/courses-create-dialog";
import { LESSON_KIND_ICON, LessonDialog, type LessonDialogTarget } from "@/components/elearning/courses-lesson-dialog";
import { CourseProgressPanel } from "@/components/elearning/courses-progress";
import { courseColor, LESSON_KIND_LABEL, moveId, sectionName, type CourseDetail, type CourseUnit, type Lesson } from "@/components/elearning/courses-types";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

type Removing = { kind: "course" } | { kind: "unit"; unit: CourseUnit } | { kind: "lesson"; lesson: Lesson };

export default function CourseBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data: course, error, errorStatus, reload } = useApi<CourseDetail>(`/elearning/courses/${id}`);
  const [tab, setTab] = useState("content");
  const [lessonTarget, setLessonTarget] = useState<LessonDialogTarget | null>(null);
  const [editingCourse, setEditingCourse] = useState(false);
  const [renaming, setRenaming] = useState<CourseUnit | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await reload();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course" breadcrumbs={[{ label: "Courses", href: "/elearning/courses" }, { label: "Course" }]} />
        <ErrorState title={errorStatus === 404 ? "Course not found" : undefined} message={errorStatus === 404 ? "It may have been deleted, or it belongs to a section you do not teach." : error} onRetry={errorStatus === 404 ? undefined : reload} />
      </div>
    );
  }
  if (!course) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Loading course" breadcrumbs={[{ label: "Courses", href: "/elearning/courses" }, { label: "Course" }]} />
        <SkeletonRows rows={8} />
      </div>
    );
  }

  const manage = course.canManage;
  const lessons = course.units.flatMap((u) => u.lessons);
  const published = lessons.filter((l) => l.isPublished).length;

  const moveUnit = (index: number, dir: -1 | 1) => {
    const ids = moveId(
      course.units.map((u) => u.id),
      index,
      dir,
    );
    if (ids) void run(`unit-move-${course.units[index].id}`, () => api(`/elearning/courses/${course.id}/units/order`, { method: "PUT", body: { ids } }));
  };
  const moveLesson = (unit: CourseUnit, index: number, dir: -1 | 1) => {
    const ids = moveId(
      unit.lessons.map((l) => l.id),
      index,
      dir,
    );
    if (ids) void run(`lesson-move-${unit.lessons[index].id}`, () => api(`/elearning/units/${unit.id}/lessons/order`, { method: "PUT", body: { ids } }));
  };
  const togglePublishLesson = (l: Lesson, on: boolean) =>
    run(`lesson-pub-${l.id}`, () => api(`/elearning/lessons/${l.id}/publish`, { method: "PUT", body: { isPublished: on } }), on ? "Lesson published" : "Lesson hidden from students");

  async function confirmRemove() {
    if (!removing || !course) return;
    if (removing.kind === "course") {
      setBusy("remove");
      try {
        await api(`/elearning/courses/${course.id}`, { method: "DELETE" });
        toast.success("Course deleted", course.title);
        router.push("/elearning/courses");
      } catch (e) {
        toast.error("Could not delete course", (e as Error).message);
        setBusy(null);
      }
      return;
    }
    const path = removing.kind === "unit" ? `/elearning/units/${removing.unit.id}` : `/elearning/lessons/${removing.lesson.id}`;
    await run("remove", () => api(path, { method: "DELETE" }), removing.kind === "unit" ? "Unit deleted" : "Lesson deleted");
    setRemoving(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={course.title}
        description={`${sectionName(course.section)} · ${course.subject.name}${course.teacher ? ` · ${course.teacher.name}` : ""}`}
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Courses", href: "/elearning/courses" }, { label: course.title }]}
        leading={<span aria-hidden className="block size-10 rounded-xl" style={{ backgroundColor: courseColor(course) }} />}
        meta={<StatusPill status={course.isPublished ? "PUBLISHED" : "DRAFT"} />}
        actions={
          manage && (
            <>
              <Switch
                checked={course.isPublished}
                disabled={busy === "course-pub"}
                onCheckedChange={(on) => run("course-pub", () => api(`/elearning/courses/${course.id}`, { method: "PATCH", body: { isPublished: on } }), on ? "Course published" : "Course moved to draft")}
                label="Visible to students"
              />
              <Button variant="secondary" icon={<Pencil />} onClick={() => setEditingCourse(true)}>
                Edit details
              </Button>
              <DropdownMenu trigger={<IconButton variant="secondary" aria-label="More course actions"><Ellipsis /></IconButton>}>
                <DropdownItem icon={<Trash2 />} danger onSelect={() => setRemoving({ kind: "course" })}>
                  Delete course
                </DropdownItem>
              </DropdownMenu>
            </>
          )
        }
      />

      {!course.isPublished && manage && (
        <Alert tone="info" title="This course is a draft">
          Students cannot see it yet. Publish the lessons that are ready, then turn on Visible to students.
        </Alert>
      )}

      <Tabs
        aria-label="Course sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "content", label: "Content", icon: <ListTree />, count: lessons.length },
          { value: "progress", label: "Progress", icon: <ChartColumn /> },
        ]}
      >
        <TabPanel value="content">
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-fg-muted">
              {course.units.length} {course.units.length === 1 ? "unit" : "units"} · {published} of {lessons.length} lessons published · {course.studentCount} students
            </p>
            {course.units.length === 0 && (
              <Card padding="none">
                <EmptyState icon={<Layers />} title="No units yet" description="Group lessons into units, for example Unit 1: Fractions. Add the first unit below." />
              </Card>
            )}
            {course.units.map((unit, ui) => (
              <Card key={unit.id} padding="none" className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted tabular-nums">Unit {ui + 1}</span>
                  <h2 className="min-w-0 flex-1 basis-40 truncate text-base font-semibold text-fg">{unit.title}</h2>
                  {manage && (
                    <div className="flex items-center gap-1">
                      <IconButton size="sm" aria-label={`Move ${unit.title} up`} disabled={ui === 0 || !!busy} onClick={() => moveUnit(ui, -1)}>
                        <ChevronUp />
                      </IconButton>
                      <IconButton size="sm" aria-label={`Move ${unit.title} down`} disabled={ui === course.units.length - 1 || !!busy} onClick={() => moveUnit(ui, 1)}>
                        <ChevronDown />
                      </IconButton>
                      <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setLessonTarget({ unitId: unit.id })}>
                        Add lesson
                      </Button>
                      <DropdownMenu trigger={<IconButton size="sm" aria-label={`Actions for ${unit.title}`}><Ellipsis /></IconButton>}>
                        <DropdownItem icon={<Pencil />} onSelect={() => setRenaming(unit)}>
                          Rename unit
                        </DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem icon={<Trash2 />} danger onSelect={() => setRemoving({ kind: "unit", unit })}>
                          Delete unit
                        </DropdownItem>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
                {unit.lessons.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-fg-muted">No lessons in this unit yet.</p>
                ) : (
                  <ol className="divide-y divide-border">
                    {unit.lessons.map((l, li) => (
                      <LessonRow
                        key={l.id}
                        lesson={l}
                        index={li}
                        count={unit.lessons.length}
                        manage={manage}
                        busy={busy}
                        onMove={(dir) => moveLesson(unit, li, dir)}
                        onPublish={(on) => togglePublishLesson(l, on)}
                        onEdit={() => setLessonTarget({ unitId: unit.id, lesson: l })}
                        onDelete={() => setRemoving({ kind: "lesson", lesson: l })}
                      />
                    ))}
                  </ol>
                )}
              </Card>
            ))}
            {manage && <AddUnitForm courseId={course.id} nextNumber={course.units.length + 1} onAdded={reload} />}
          </div>
        </TabPanel>
        <TabPanel value="progress">{tab === "progress" && <CourseProgressPanel courseId={course.id} />}</TabPanel>
      </Tabs>

      <LessonDialog target={lessonTarget} units={course.units} onClose={() => setLessonTarget(null)} onSaved={reload} />
      <EditCourseDialog course={course} open={editingCourse} onOpenChange={setEditingCourse} onSaved={reload} />
      <RenameUnitDialog unit={renaming} onClose={() => setRenaming(null)} onSaved={reload} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        loading={busy === "remove"}
        title={removing?.kind === "course" ? "Delete this course?" : removing?.kind === "unit" ? `Delete ${removing.unit.title}?` : `Delete ${removing?.kind === "lesson" ? removing.lesson.title : "lesson"}?`}
        description={
          removing?.kind === "course"
            ? "All units, lessons and student progress for this course are removed. Assignments and quizzes stay."
            : removing?.kind === "unit"
              ? `Its ${removing.unit.lessons.length} lessons and their student progress are removed.`
              : "Student progress on this lesson is removed too."
        }
        confirmLabel="Delete"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function LessonRow({
  lesson: l,
  index,
  count,
  manage,
  busy,
  onMove,
  onPublish,
  onEdit,
  onDelete,
}: {
  lesson: Lesson;
  index: number;
  count: number;
  manage: boolean;
  busy: string | null;
  onMove: (dir: -1 | 1) => void;
  onPublish: (on: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = LESSON_KIND_ICON[l.kind];
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        {manage ? (
          <button type="button" onClick={onEdit} className="block max-w-full truncate rounded text-left text-sm font-medium text-fg hover:text-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            {l.title}
          </button>
        ) : (
          <p className="truncate text-sm font-medium text-fg">{l.title}</p>
        )}
        <p className="text-[13px] text-fg-muted">
          {LESSON_KIND_LABEL[l.kind]}
          {l.durationMin ? ` · ${l.durationMin} min` : ""}
          {l.kind === "VIDEO" && !l.embedUrl ? " · opens in a new tab" : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {l.url && (
          <Tooltip content="Open link">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${l.title} in a new tab`}
              className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Tooltip>
        )}
        {manage ? (
          <>
            <Switch checked={l.isPublished} disabled={busy === `lesson-pub-${l.id}`} onCheckedChange={onPublish} aria-label={`Publish ${l.title}`} className="mx-2" />
            <IconButton size="sm" aria-label={`Move ${l.title} up`} disabled={index === 0 || !!busy} onClick={() => onMove(-1)}>
              <ChevronUp />
            </IconButton>
            <IconButton size="sm" aria-label={`Move ${l.title} down`} disabled={index === count - 1 || !!busy} onClick={() => onMove(1)}>
              <ChevronDown />
            </IconButton>
            <IconButton size="sm" aria-label={`Edit ${l.title}`} onClick={onEdit}>
              <Pencil />
            </IconButton>
            <IconButton size="sm" aria-label={`Delete ${l.title}`} onClick={onDelete}>
              <Trash2 />
            </IconButton>
          </>
        ) : (
          <StatusPill status={l.isPublished ? "PUBLISHED" : "DRAFT"} />
        )}
      </div>
    </li>
  );
}

function AddUnitForm({ courseId, nextNumber, onAdded }: { courseId: string; nextNumber: number; onAdded: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api(`/elearning/courses/${courseId}/units`, { method: "POST", body: { title: title.trim() } });
      toast.success("Unit added", title.trim());
      setTitle("");
      onAdded();
    } catch (e) {
      toast.error("Could not add unit", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-dashed border-border-strong p-4 sm:flex-row sm:items-center">
      <Input aria-label="New unit title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Unit ${nextNumber}: topic name`} maxLength={120} className="sm:flex-1" />
      <Button type="submit" variant="secondary" icon={<Plus />} loading={saving} disabled={!title.trim()}>
        Add unit
      </Button>
    </form>
  );
}

function RenameUnitDialog({ unit, onClose, onSaved }: { unit: CourseUnit | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unit) return;
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim();
    setSaving(true);
    try {
      await api(`/elearning/units/${unit.id}`, { method: "PATCH", body: { title } });
      toast.success("Unit renamed", title);
      onSaved();
      onClose();
    } catch (e) {
      toast.error("Could not rename unit", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!unit} onOpenChange={(o) => !o && onClose()} title="Rename unit" size="sm">
      {unit && (
        <form onSubmit={submit} className="grid gap-4">
          <TextField name="title" label="Unit title" required minLength={1} maxLength={120} defaultValue={unit.title} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EditCourseDialog({ course, open, onOpenChange, onSaved }: { course: CourseDetail; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Course details" description={`${sectionName(course.section)} · ${course.subject.name}`}>
      {open && <EditCourseForm course={course} onClose={() => onOpenChange(false)} onSaved={onSaved} />}
    </Dialog>
  );
}

function EditCourseForm({ course, onClose, onSaved }: { course: CourseDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [color, setColor] = useState<string | null>(course.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await api(`/elearning/courses/${course.id}`, {
        method: "PATCH",
        body: { title: String(f.get("title") ?? "").trim(), description: String(f.get("description") ?? "").trim() || null, color },
      });
      toast.success("Course saved");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField name="title" label="Course title" required minLength={2} maxLength={120} defaultValue={course.title} />
      <TextareaField name="description" label="Description" rows={3} defaultValue={course.description ?? ""} placeholder="What students will learn this term" />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save details
        </Button>
      </div>
    </form>
  );
}
