"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Exam {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "DRAFT" | "PUBLISHED";
  academicYear: { name: string };
  _count: { papers: number; results: number };
}
interface AcademicYear { id: string; name: string; isCurrent: boolean }
interface Band { grade: string; minPercent: number; remark: string | null }

export default function ExamsPage() {
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const exams = useApi<Exam[]>("/exams");
  const years = useApi<AcademicYear[]>(isAdmin ? "/academic-years" : null);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      await api("/exams", {
        method: "POST",
        body: {
          name: f.get("name"),
          academicYearId: f.get("academicYearId"),
          startsOn: f.get("startsOn") || undefined,
          endsOn: f.get("endsOn") || undefined,
        },
      });
      form.reset();
      setError("");
      await exams.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const sortedYears = [...(years.data ?? [])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Exams and results</PageTitle>
      <div className={`grid gap-6 ${isAdmin ? "lg:grid-cols-[2fr_1fr]" : ""}`}>
        <Card>
          <ErrorText>{exams.error}</ErrorText>
          {exams.data?.length === 0 && <p className="text-sm opacity-70">No exams yet.</p>}
          {!!exams.data?.length && (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="opacity-60">
                  <tr><th className="py-2">Exam</th><th>Year</th><th>Dates</th><th>Papers</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {exams.data.map((e) => (
                    <tr key={e.id} className={rowClass}>
                      <td className="py-2"><Link href={`/exams/${e.id}`} className="font-medium text-brand hover:underline">{e.name}</Link></td>
                      <td>{e.academicYear.name}</td>
                      <td>{e.startsOn ? day(e.startsOn) : "–"}{e.endsOn ? ` to ${day(e.endsOn)}` : ""}</td>
                      <td>{e._count.papers}</td>
                      <td>{e.status === "PUBLISHED" ? <Badge tone="green">published</Badge> : <Badge tone="amber">draft</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {isAdmin && (
          <Card>
            <h2 className="mb-4 font-semibold">New exam</h2>
            <form className="flex flex-col gap-3" onSubmit={create}>
              <Field label="Name" name="name" placeholder="Mid-term 2026" required />
              <Select label="Academic year" name="academicYearId" required options={sortedYears.map((y) => ({ value: y.id, label: y.name }))} />
              <Field label="Starts" name="startsOn" type="date" />
              <Field label="Ends" name="endsOn" type="date" />
              <Button type="submit">Create exam</Button>
              <ErrorText>{error}</ErrorText>
            </form>
          </Card>
        )}
      </div>
      {isAdmin && <GradeScale />}
    </div>
  );
}

/** The school's grading scale, edited as a small table. */
function GradeScale() {
  const bands = useApi<Band[]>("/exams/grade-bands");
  const [draft, setDraft] = useState<Band[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const rows = draft ?? bands.data ?? [];

  const update = (i: number, patch: Partial<Band>) =>
    setDraft(rows.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  async function save() {
    try {
      await api("/exams/grade-bands", {
        method: "PUT",
        body: { bands: rows.map((b) => ({ grade: b.grade, minPercent: Number(b.minPercent), remark: b.remark || undefined })) },
      });
      setDraft(null);
      setError("");
      setNotice("Grading scale saved. It applies the next time results are published.");
      await bands.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const input = "w-full rounded-lg border border-black/15 bg-transparent px-2 py-1 dark:border-white/20";
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Grading scale</h2>
      <p className="mb-4 text-sm opacity-70">A student gets the highest grade whose minimum percentage they reach.</p>
      <table className={`${tableClass} max-w-xl`}>
        <thead className="opacity-60"><tr><th className="py-2">Grade</th><th>From %</th><th>Remark</th><th /></tr></thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i} className={rowClass}>
              <td className="w-20 py-1"><input className={input} value={b.grade} onChange={(e) => update(i, { grade: e.target.value })} aria-label="Grade" /></td>
              <td className="w-24"><input className={input} type="number" min={0} max={100} value={b.minPercent} onChange={(e) => update(i, { minPercent: Number(e.target.value) })} aria-label="Minimum percent" /></td>
              <td><input className={input} value={b.remark ?? ""} onChange={(e) => update(i, { remark: e.target.value })} aria-label="Remark" /></td>
              <td><button className="text-sm text-red-600" onClick={() => setDraft(rows.filter((_, k) => k !== i))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" onClick={() => setDraft([...rows, { grade: "", minPercent: 0, remark: "" }])}>Add grade</Button>
        <Button onClick={save} disabled={!draft}>Save scale</Button>
      </div>
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
