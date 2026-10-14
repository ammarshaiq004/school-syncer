"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, CalendarRange, CircleCheck, Layers, Plus, School, Trash2, Users } from "lucide-react";
import { Select } from "@/components/select";
import { DeleteDialog, EditDialog, RowActions } from "@/components/setup/row-actions";
import { SectionLogins } from "@/components/student/section-logins";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Dialog,
  Drawer,
  DropdownItem,
  EmptyState,
  ErrorState,
  Input,
  NativeSelect,
  PageHeader,
  SkeletonRows,
  TextField,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface SchoolSection { id: string; name: string; capacity: number | null; classTeacher: { id: string; name: string } | null }
interface SchoolClass {
  id: string;
  name: string;
  sortOrder: number;
  campus: { id: string; name: string };
  sections: SchoolSection[];
}
interface Campus { id: string; name: string }
interface AcademicYear { id: string; name: string; isCurrent: boolean; startsOn: string; endsOn: string }
interface Subject { id: string; name: string; code: string | null }
type DeleteTarget = { name: string; path: string; detail?: string };
interface StaffUser { id: string; name: string; isActive: boolean; roles: { role: string }[] }
interface SectionSubject { subjectId: string; teacher: { id: string } | null }

type DialogKind = "class" | "subject" | "year";

export default function ClassesPage() {
  const classes = useApi<SchoolClass[]>("/classes");
  const campuses = useApi<Campus[]>("/campuses");
  const years = useApi<AcademicYear[]>("/academic-years");
  const subjects = useApi<Subject[]>("/subjects");
  const toast = useToast();
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [isCurrent, setIsCurrent] = useState(true);
  const [editing, setEditing] = useState<{ id: string; label: string; section: SchoolSection } | null>(null);
  const [editClass, setEditClass] = useState<SchoolClass | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const currentYear = years.data?.find((y) => y.isCurrent) ?? years.data?.[0];

  async function submit(event: FormEvent<HTMLFormElement>, send: (form: FormData) => Promise<unknown>, done: string) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setBusy(true);
    try {
      await send(new FormData(formEl));
      formEl.reset();
      setError("");
      setDialog(null);
      toast.success(done);
      await Promise.all([classes.reload(), years.reload(), subjects.reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openDialog(kind: DialogKind) {
    setError("");
    setIsCurrent(true);
    setDialog(kind);
  }

  const dialogFooter = (formId: string, label: string) => (
    <>
      <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={busy}>
        {label}
      </Button>
    </>
  );

  const sectionCount = classes.data?.reduce((n, c) => n + c.sections.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Classes and sections"
        description="Set up classes per campus, their sections for this year, and which subjects each section studies."
        breadcrumbs={[{ label: "Setup" }, { label: "Classes" }]}
        meta={
          years.data ? (
            currentYear ? (
              <Badge tone="primary" icon={<CalendarRange />}>Academic year {currentYear.name}</Badge>
            ) : (
              <Badge tone="warning" icon={<CalendarRange />}>No academic year yet, add one first</Badge>
            )
          ) : null
        }
        actions={
          <>
            <Button type="button" variant="secondary" icon={<CalendarRange />} onClick={() => openDialog("year")}>
              Add year
            </Button>
            <Button type="button" variant="secondary" icon={<BookOpen />} onClick={() => openDialog("subject")}>
              Add subject
            </Button>
            <Button type="button" icon={<Plus />} onClick={() => openDialog("class")}>
              Add class
            </Button>
          </>
        }
      />

      {error && !dialog && (
        <Alert tone="danger" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      <Card padding="none">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">All classes</h2>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              {classes.data ? `${classes.data.length} classes, ${sectionCount} sections. ` : ""}
              Click a section to set its subjects and teachers or create student logins.
            </p>
          </div>
        </div>
        {classes.error ? (
          <ErrorState message={classes.error} onRetry={classes.reload} compact />
        ) : !classes.data ? (
          <div className="p-5">
            <SkeletonRows rows={4} columns={3} />
          </div>
        ) : classes.data.length === 0 ? (
          <EmptyState
            icon={<School />}
            title="No classes yet"
            description="Add classes such as Playgroup, Grade 1 or Grade 10, then give each one its sections."
            action={
              <Button type="button" icon={<Plus />} onClick={() => openDialog("class")}>
                Add class
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {classes.data.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 items-center gap-3 lg:w-56">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
                    <Layers className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{c.name}</div>
                    <div className="truncate text-xs text-fg-muted">{c.campus.name}</div>
                  </div>
                  <RowActions
                    label={c.name}
                    onEdit={() => setEditClass(c)}
                    onDelete={() =>
                      setDeleting({
                        name: c.name,
                        path: `/classes/${c.id}`,
                        detail: "Only a class with no sections (in any year), fee amounts, applications or exam papers can be deleted.",
                      })
                    }
                  />
                </div>
                <div className="flex flex-1 flex-wrap gap-2">
                  {c.sections.length === 0 && <span className="text-[13px] text-fg-muted">No sections yet</span>}
                  {c.sections.map((s) => {
                    const active = editing?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setEditing({ id: s.id, label: `${c.name} ${s.name}`, section: s })}
                        aria-label={`Subjects and teachers for ${c.name} ${s.name}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary text-primary-fg"
                            : "border-border bg-primary-tint text-brand hover:border-primary/40",
                        )}
                      >
                        {s.name}
                        {s.capacity ? (
                          <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", active ? "opacity-90" : "text-fg-muted")}>
                            <Users className="size-3" aria-hidden />
                            {s.capacity}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {currentYear && (
                  <form
                    className="flex items-center gap-2"
                    aria-label={`Add a section to ${c.name}`}
                    onSubmit={(e) =>
                      submit(
                        e,
                        (f) =>
                          api(`/classes/${c.id}/sections`, {
                            method: "POST",
                            body: {
                              academicYearId: currentYear.id,
                              name: f.get("name"),
                              capacity: f.get("capacity") ? Number(f.get("capacity")) : undefined,
                            },
                          }),
                        `Section added to ${c.name}`,
                      )
                    }
                  >
                    <Input name="name" placeholder="Section" required aria-label={`New section name for ${c.name}`} className="h-8 w-24" />
                    <Input name="capacity" type="number" min={1} placeholder="Seats" aria-label={`Seats in the new ${c.name} section`} className="h-8 w-20" />
                    <Button type="submit" size="sm" variant="secondary" icon={<Plus />}>
                      Add
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <SubjectsCard subjects={subjects} onDelete={setDeleting} />
        <YearsCard years={years} onDelete={setDeleting} />
      </div>

      <EditDialog
        open={editClass !== null}
        title={editClass ? `Edit ${editClass.name}` : "Edit class"}
        onClose={() => setEditClass(null)}
        save={(f) =>
          api(`/classes/${editClass!.id}`, {
            method: "PATCH",
            body: { name: f.get("name"), sortOrder: Number(f.get("sortOrder") || 0) },
          })
        }
        saved={{ message: "Class saved", reload: classes.reload }}
      >
        {editClass && (
          <>
            <TextField label="Class name" name="name" defaultValue={editClass.name} required />
            <TextField label="Order" name="sortOrder" type="number" min={0} defaultValue={editClass.sortOrder} hint="Lower numbers are listed first" />
          </>
        )}
      </EditDialog>

      <DeleteDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => Promise.all([classes.reload(), years.reload(), subjects.reload()])}
      />

      <Dialog
        open={dialog === "class"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add a class"
        description="Sections are added to the class afterwards."
        footer={dialogFooter("add-class-form", "Add class")}
      >
        <form
          id="add-class-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                api("/classes", {
                  method: "POST",
                  body: { campusId: f.get("campusId"), name: f.get("name"), sortOrder: Number(f.get("sortOrder") || 0) },
                }),
              "Class added",
            )
          }
        >
          <div className="sm:col-span-2">
            <Select
              label="Campus"
              name="campusId"
              required
              options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <TextField label="Class name" name="name" placeholder="Grade 5" required />
          <TextField label="Order" name="sortOrder" type="number" min={0} defaultValue={0} hint="Lower numbers are listed first" />
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        </form>
      </Dialog>

      <Dialog
        open={dialog === "subject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add a subject"
        description="Subjects can then be given to sections with a teacher."
        footer={dialogFooter("add-subject-form", "Add subject")}
      >
        <form
          id="add-subject-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) =>
            submit(e, (f) => api("/subjects", { method: "POST", body: { name: f.get("name"), code: f.get("code") || undefined } }), "Subject added")
          }
        >
          <TextField label="Subject" name="name" placeholder="Mathematics" required />
          <TextField label="Code (optional)" name="code" placeholder="MATH" />
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        </form>
      </Dialog>

      <Dialog
        open={dialog === "year"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add an academic year"
        description="New sections are created in the current year."
        footer={dialogFooter("add-year-form", "Add year")}
      >
        <form
          id="add-year-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) =>
            submit(
              e,
              (f) =>
                api("/academic-years", {
                  method: "POST",
                  body: {
                    name: f.get("name"),
                    startsOn: f.get("startsOn"),
                    endsOn: f.get("endsOn"),
                    isCurrent,
                  },
                }),
              "Academic year added",
            )
          }
        >
          <TextField label="Name" name="name" placeholder="2026-27" required wrapperClassName="sm:col-span-2" />
          <TextField label="Starts" name="startsOn" type="date" required />
          <TextField label="Ends" name="endsOn" type="date" required />
          <Checkbox checked={isCurrent} onCheckedChange={setIsCurrent} label="Current year" className="sm:col-span-2" />
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        </form>
      </Dialog>

      <Drawer
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `${editing.label}: subjects, teachers and logins` : "Subjects and teachers"}
        description="Teachers can enter marks for the subjects they are given here."
        size="lg"
      >
        {editing && (
          <div className="flex flex-col gap-6">
            <SectionSettings
              key={`settings-${editing.id}`}
              section={editing}
              onSaved={classes.reload}
              onDelete={() => {
                setDeleting({
                  name: editing.label,
                  path: `/classes/sections/${editing.id}`,
                  detail: "Only a section nobody has used yet (no students, attendance, exams, timetable or e-school work) can be deleted.",
                });
                setEditing(null);
              }}
            />
            <SectionSubjects key={editing.id} section={editing} onClose={() => setEditing(null)} />
            <SectionLogins key={`logins-${editing.id}`} section={editing} />
          </div>
        )}
      </Drawer>
    </div>
  );
}

const TEACHING_ROLES = ["TEACHER", "CLASS_TEACHER", "PRINCIPAL", "ADMIN", "OWNER"];

/** A section's name, seats and class teacher, which can change during the year. */
function SectionSettings({
  section,
  onSaved,
  onDelete,
}: {
  section: { id: string; label: string; section: SchoolSection };
  onSaved: () => void | Promise<unknown>;
  onDelete: () => void;
}) {
  const users = useApi<StaffUser[]>("/users");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const teachers = (users.data ?? []).filter((u) => u.isActive && u.roles.some((r) => TEACHING_ROLES.includes(r.role)));
  const current = section.section.classTeacher;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/classes/sections/${section.id}`, {
        method: "PATCH",
        body: {
          name: f.get("name"),
          capacity: f.get("capacity") ? Number(f.get("capacity")) : null,
          classTeacherId: f.get("classTeacherId") || null,
        },
      });
      setError("");
      toast.success("Section saved", section.label);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3" aria-label={`Settings for ${section.label}`}>
      <TextField label="Section name" name="name" defaultValue={section.section.name} required />
      <TextField label="Seats" name="capacity" type="number" min={1} defaultValue={section.section.capacity ?? ""} />
      <Select
        label="Class teacher"
        name="classTeacherId"
        defaultValue={current?.id ?? ""}
        options={[
          { value: "", label: "No class teacher" },
          // Keep the current teacher listed while the staff list loads, or after they leave.
          ...(current && !teachers.some((t) => t.id === current.id) ? [{ value: current.id, label: current.name }] : []),
          ...teachers.map((t) => ({ value: t.id, label: t.name })),
        ]}
      />
      {error && <Alert tone="danger" className="sm:col-span-3">{error}</Alert>}
      <div className="flex justify-between gap-2 sm:col-span-3">
        <Button type="button" variant="ghost" icon={<Trash2 />} onClick={onDelete}>
          Delete section
        </Button>
        <Button type="submit" variant="secondary" loading={busy}>
          Save section
        </Button>
      </div>
    </form>
  );
}

/** Every subject with edit and delete; subjects are shared by all campuses. */
function SubjectsCard({
  subjects,
  onDelete,
}: {
  subjects: { data: Subject[] | null; error: string; reload: () => Promise<unknown> };
  onDelete: (t: DeleteTarget) => void;
}) {
  const [editing, setEditing] = useState<Subject | null>(null);
  return (
    <Card>
      <CardHeader title="Subjects" description="Shared by every campus." icon={<BookOpen />} />
      {subjects.error ? (
        <ErrorState message={subjects.error} onRetry={subjects.reload} compact />
      ) : !subjects.data ? (
        <SkeletonRows rows={3} columns={2} />
      ) : subjects.data.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No subjects yet" description="Add subjects with the Add subject button." compact />
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {subjects.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-1 py-2 text-sm">
              <span className="min-w-0 truncate font-medium text-fg">
                {s.name}
                {s.code && <span className="ms-2 font-mono text-xs text-fg-muted">{s.code}</span>}
              </span>
              <RowActions
                label={s.name}
                onEdit={() => setEditing(s)}
                onDelete={() =>
                  onDelete({
                    name: s.name,
                    path: `/subjects/${s.id}`,
                    detail: "Only a subject no section, timetable, exam or e-school work uses can be deleted. Untick it in each section first.",
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
      <EditDialog
        open={editing !== null}
        title={editing ? `Edit ${editing.name}` : "Edit subject"}
        onClose={() => setEditing(null)}
        save={(f) => api(`/subjects/${editing!.id}`, { method: "PATCH", body: { name: f.get("name"), code: f.get("code") || null } })}
        saved={{ message: "Subject saved", reload: subjects.reload }}
      >
        {editing && (
          <>
            <TextField label="Subject" name="name" defaultValue={editing.name} required />
            <TextField label="Code (optional)" name="code" defaultValue={editing.code ?? ""} />
          </>
        )}
      </EditDialog>
    </Card>
  );
}

/** Academic years: rename, correct dates, make one current, delete one set up by mistake. */
function YearsCard({
  years,
  onDelete,
}: {
  years: { data: AcademicYear[] | null; error: string; reload: () => Promise<unknown> };
  onDelete: (t: DeleteTarget) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<AcademicYear | null>(null);

  async function makeCurrent(y: AcademicYear) {
    try {
      await api(`/academic-years/${y.id}`, { method: "PATCH", body: { isCurrent: true } });
      toast.success(`${y.name} is now the current year`);
      await years.reload();
    } catch (e) {
      toast.error("Could not change the current year", (e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader title="Academic years" description="New sections and fees use the current year." icon={<CalendarRange />} />
      {years.error ? (
        <ErrorState message={years.error} onRetry={years.reload} compact />
      ) : !years.data ? (
        <SkeletonRows rows={3} columns={2} />
      ) : years.data.length === 0 ? (
        <EmptyState icon={<CalendarRange />} title="No academic years yet" compact />
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {years.data.map((y) => (
            <li key={y.id} className="flex items-center justify-between gap-3 px-1 py-2 text-sm">
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium text-fg">
                  {y.name}
                  {y.isCurrent && <Badge tone="primary">Current</Badge>}
                </span>
                <span className="text-xs text-fg-muted">
                  {day(y.startsOn)} to {day(y.endsOn)}
                </span>
              </span>
              <RowActions
                label={y.name}
                onEdit={() => setEditing(y)}
                onDelete={
                  y.isCurrent
                    ? undefined
                    : () =>
                        onDelete({
                          name: y.name,
                          path: `/academic-years/${y.id}`,
                          detail: "Only a year with no sections, students, fees, exams or promotions can be deleted.",
                        })
                }
              >
                {!y.isCurrent && (
                  <DropdownItem icon={<CircleCheck />} onSelect={() => makeCurrent(y)}>
                    Make current
                  </DropdownItem>
                )}
              </RowActions>
            </li>
          ))}
        </ul>
      )}
      <EditDialog
        open={editing !== null}
        title={editing ? `Edit ${editing.name}` : "Edit year"}
        onClose={() => setEditing(null)}
        save={(f) =>
          api(`/academic-years/${editing!.id}`, {
            method: "PATCH",
            body: { name: f.get("name"), startsOn: f.get("startsOn"), endsOn: f.get("endsOn") },
          })
        }
        saved={{ message: "Academic year saved", reload: years.reload }}
      >
        {editing && (
          <>
            <TextField label="Name" name="name" defaultValue={editing.name} required wrapperClassName="sm:col-span-2" />
            <TextField label="Starts" name="startsOn" type="date" defaultValue={editing.startsOn.slice(0, 10)} required />
            <TextField label="Ends" name="endsOn" type="date" defaultValue={editing.endsOn.slice(0, 10)} required />
          </>
        )}
      </EditDialog>
    </Card>
  );
}

/** Which subjects a section studies and who teaches each; teachers can then enter marks for them. */
function SectionSubjects({ section, onClose }: { section: { id: string; label: string }; onClose: () => void }) {
  const subjects = useApi<Subject[]>("/subjects");
  const users = useApi<StaffUser[]>("/users");
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<SectionSubject[]>(`/classes/sections/${section.id}/subjects`)
      .then((list) => !cancelled && setRows(Object.fromEntries(list.map((r) => [r.subjectId, r.teacher?.id ?? null]))))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [section.id, attempt]);

  const teachers = (users.data ?? []).filter((u) => u.isActive && u.roles.some((r) => TEACHING_ROLES.includes(r.role)));

  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      await api(`/classes/sections/${section.id}/subjects`, {
        method: "PUT",
        body: { subjects: Object.entries(rows).map(([subjectId, teacherId]) => ({ subjectId, teacherId })) },
      });
      setError("");
      setSaved(true);
      toast.success("Subjects saved", section.label);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rows) {
    return error ? (
      <ErrorState
        message={error}
        onRetry={() => {
          setError("");
          setAttempt((n) => n + 1);
          subjects.reload();
          users.reload();
        }}
        compact
      />
    ) : (
      <SkeletonRows rows={5} columns={2} />
    );
  }
  if (subjects.error) return <ErrorState message={subjects.error} onRetry={subjects.reload} compact />;
  if (!subjects.data) return <SkeletonRows rows={5} columns={2} />;
  if (subjects.data.length === 0) {
    return <EmptyState icon={<BookOpen />} title="No subjects yet" description="Add subjects first with the Add subject button." compact />;
  }

  const chosen = Object.keys(rows).length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-muted">
        {chosen} of {subjects.data.length} subjects taught in this section.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {subjects.data.map((s) => {
          const on = s.id in rows;
          return (
            <li key={s.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
              <Checkbox
                className="sm:w-44"
                checked={on}
                label={s.name}
                onCheckedChange={(checked) => {
                  setSaved(false);
                  setRows((r) => {
                    const next = { ...r };
                    if (checked) next[s.id] = null;
                    else delete next[s.id];
                    return next;
                  });
                }}
              />
              <NativeSelect
                wrapperClassName="flex-1"
                disabled={!on}
                value={rows[s.id] ?? ""}
                onChange={(e) => {
                  setSaved(false);
                  setRows((r) => ({ ...r, [s.id]: e.target.value || null }));
                }}
                aria-label={`Teacher for ${s.name}`}
                options={[{ value: "", label: "No teacher yet" }, ...teachers.map((t) => ({ value: t.id, label: t.name }))]}
              />
            </li>
          );
        })}
      </ul>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={save} loading={busy}>
          {saved ? "Saved" : "Save subjects"}
        </Button>
      </div>
    </div>
  );
}
