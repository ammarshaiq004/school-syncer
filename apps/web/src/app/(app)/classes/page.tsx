"use client";

import { useState, type FormEvent } from "react";
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

export default function ClassesPage() {
  const classes = useApi<SchoolClass[]>("/classes");
  const campuses = useApi<Campus[]>("/campuses");
  const years = useApi<AcademicYear[]>("/academic-years");
  const [error, setError] = useState("");
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
                  <span key={s.id} className="rounded-full bg-brand/10 px-3 py-1 text-sm text-brand">
                    {s.name}{s.capacity ? ` · ${s.capacity} seats` : ""}
                  </span>
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
      </Card>

      <div className="flex flex-col gap-6">
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
