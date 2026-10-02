"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface SchoolClass {
  id: string;
  name: string;
  campus: { id: string; name: string };
  sections: { id: string; name: string; capacity: number | null; classTeacher: { name: string } | null }[];
}
interface Campus { id: string; name: string }
interface AcademicYear { id: string; name: string; isCurrent: boolean }
interface Subject { id: string; name: string }
interface StaffUser { id: string; name: string; isActive: boolean; roles: { role: string }[] }
interface SectionSubject { subjectId: string; teacher: { id: string } | null }

export default function ClassesPage() {
  const classes = useApi<SchoolClass[]>("/classes");
  const campuses = useApi<Campus[]>("/campuses");
  const years = useApi<AcademicYear[]>("/academic-years");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const currentYear = years.data?.find((y) => y.isCurrent) ?? years.data?.[0];

  async function submit(event: FormEvent<HTMLFormElement>, send: (form: FormData) => Promise<unknown>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    try {
      await send(new FormData(formEl));
      formEl.reset();
      setError("");
      await Promise.all([classes.reload(), years.reload()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Classes and sections</h1>
        <p className="mb-4 text-sm opacity-70">
          Academic year: {currentYear ? currentYear.name : "none yet, add one first"}
        </p>
        <ErrorText>{classes.error}</ErrorText>
        <div className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
          {classes.data?.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="w-40">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs opacity-60">{c.campus.name}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setEditing({ id: s.id, label: `${c.name} ${s.name}` })}
                    title="Subjects and teachers"
                    className={`rounded-full px-3 py-1 text-sm ${editing?.id === s.id ? "bg-brand text-white" : "bg-brand/10 text-brand"}`}
                  >
                    {s.name}{s.capacity ? ` · ${s.capacity} seats` : ""}
                  </button>
                ))}
              </div>
              {currentYear && (
                <form
                  className="ml-auto flex gap-2"
                  onSubmit={(e) =>
                    submit(e, (f) =>
                      api(`/classes/${c.id}/sections`, {
                        method: "POST",
                        body: {
                          academicYearId: currentYear.id,
                          name: f.get("name"),
                          capacity: f.get("capacity") ? Number(f.get("capacity")) : undefined,
                        },
                      }),
                    )
                  }
                >
                  <input name="name" placeholder="Section" required className="w-20 rounded-lg border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20" />
                  <input name="capacity" type="number" min={1} placeholder="Seats" className="w-20 rounded-lg border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20" />
                  <button className="text-sm text-brand">Add</button>
                </form>
              )}
            </div>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        <p className="mt-2 text-xs opacity-60">Click a section to set its subjects and teachers.</p>
      </Card>

      <div className="flex flex-col gap-6">
        {editing && <SectionSubjects key={editing.id} section={editing} onClose={() => setEditing(null)} />}
        <Card>
          <h2 className="mb-4 font-semibold">Add a class</h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) =>
              submit(e, (f) =>
                api("/classes", {
                  method: "POST",
                  body: { campusId: f.get("campusId"), name: f.get("name"), sortOrder: Number(f.get("sortOrder") || 0) },
                }),
              )
            }
          >
            <Select
              label="Campus"
              name="campusId"
              required
              options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            <Field label="Class name" name="name" placeholder="Grade 5" required />
            <Field label="Order" name="sortOrder" type="number" min={0} defaultValue={0} />
            <Button type="submit">Add class</Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Add a subject</h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) =>
              submit(e, (f) => api("/subjects", { method: "POST", body: { name: f.get("name"), code: f.get("code") || undefined } }))
            }
          >
            <Field label="Subject" name="name" placeholder="Mathematics" required />
            <Field label="Code (optional)" name="code" placeholder="MATH" />
            <Button type="submit">Add subject</Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Add an academic year</h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) =>
              submit(e, (f) =>
                api("/academic-years", {
                  method: "POST",
                  body: {
                    name: f.get("name"),
                    startsOn: f.get("startsOn"),
                    endsOn: f.get("endsOn"),
                    isCurrent: f.get("isCurrent") === "on",
                  },
                }),
              )
            }
          >
            <Field label="Name" name="name" placeholder="2026-27" required />
            <Field label="Starts" name="startsOn" type="date" required />
            <Field label="Ends" name="endsOn" type="date" required />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isCurrent" defaultChecked /> Current year
            </label>
            <Button type="submit">Add year</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

const TEACHING_ROLES = ["TEACHER", "CLASS_TEACHER", "PRINCIPAL", "ADMIN", "OWNER"];

/** Which subjects a section studies and who teaches each; teachers can then enter marks for them. */
function SectionSubjects({ section, onClose }: { section: { id: string; label: string }; onClose: () => void }) {
  const subjects = useApi<Subject[]>("/subjects");
  const users = useApi<StaffUser[]>("/users");
  const [rows, setRows] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<SectionSubject[]>(`/classes/sections/${section.id}/subjects`)
      .then((list) => !cancelled && setRows(Object.fromEntries(list.map((r) => [r.subjectId, r.teacher?.id ?? null]))))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [section.id]);

  const teachers = (users.data ?? []).filter((u) => u.isActive && u.roles.some((r) => TEACHING_ROLES.includes(r.role)));

  async function save() {
    if (!rows) return;
    try {
      await api(`/classes/sections/${section.id}/subjects`, {
        method: "PUT",
        body: { subjects: Object.entries(rows).map(([subjectId, teacherId]) => ({ subjectId, teacherId })) },
      });
      setError("");
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{section.label}: subjects and teachers</h2>
        <button className="text-sm opacity-60" onClick={onClose}>Close</button>
      </div>
      {rows && (
        <div className="flex flex-col gap-2">
          {subjects.data?.map((s) => {
            const on = s.id in rows;
            return (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <label className="flex w-32 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      setSaved(false);
                      setRows((r) => {
                        const next = { ...r };
                        if (e.target.checked) next[s.id] = null;
                        else delete next[s.id];
                        return next;
                      });
                    }}
                  />
                  {s.name}
                </label>
                <select
                  disabled={!on}
                  value={rows[s.id] ?? ""}
                  onChange={(e) => {
                    setSaved(false);
                    setRows((r) => ({ ...r, [s.id]: e.target.value || null }));
                  }}
                  aria-label={`Teacher for ${s.name}`}
                  className="flex-1 rounded-lg border border-black/15 bg-transparent px-2 py-1 disabled:opacity-40 dark:border-white/20"
                >
                  <option value="">No teacher yet</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            );
          })}
          {subjects.data?.length === 0 && <p className="text-sm opacity-70">Add subjects first.</p>}
          <Button onClick={save} className="mt-2">{saved ? "Saved" : "Save subjects"}</Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
