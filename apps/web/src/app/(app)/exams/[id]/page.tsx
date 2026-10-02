"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Paper {
  id: string;
  classId: string;
  subjectId: string;
  maxMarks: number;
  passMarks: number;
  date: string | null;
  class: { name: string };
  subject: { name: string };
}
interface Exam {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED";
  academicYearId: string;
  academicYear: { name: string };
  publishedAt: string | null;
  papers: Paper[];
}
interface ProgressRow {
  sectionId: string;
  section: string;
  subjectId: string;
  subject: string;
  enrolled: number;
  entered: number;
  missing: number;
  canEnter: boolean;
}

const TABS = ["Marks", "Results", "Papers"] as const;

export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const exam = useApi<Exam>(`/exams/${id}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Marks");
  const tabs = TABS.filter((t) => isAdmin || t !== "Papers");
  const published = exam.data?.status === "PUBLISHED";

  return (
    <div className="flex flex-col gap-6">
      <PageTitle action={<Link href="/exams" className="text-sm text-brand">All exams</Link>}>
        {exam.data?.name ?? "Exam"}{" "}
        {exam.data && (published ? <Badge tone="green">published</Badge> : <Badge tone="amber">draft</Badge>)}
      </PageTitle>
      <ErrorText>{exam.error}</ErrorText>
      <div className="flex gap-2 border-b border-black/10 dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {exam.data && tab === "Marks" && <MarksTab exam={exam.data} />}
      {exam.data && tab === "Results" && <ResultsTab exam={exam.data} isAdmin={isAdmin} onChange={exam.reload} />}
      {exam.data && tab === "Papers" && <PapersTab exam={exam.data} onChange={exam.reload} />}
    </div>
  );
}

// ---- Marks entry -----------------------------------------------------------

interface Sheet {
  paper: { subject: string; maxMarks: number; passMarks: number };
  section: { name: string };
  locked: boolean;
  students: { id: string; name: string; rollNo: number | null; marks: number | null; isAbsent: boolean }[];
}
type Entry = { marks: string; isAbsent: boolean };

function MarksTab({ exam }: { exam: Exam }) {
  const progress = useApi<ProgressRow[]>(`/exams/${exam.id}/progress`);
  const [open, setOpen] = useState<ProgressRow | null>(null);
  const rows = progress.data?.filter((r) => r.canEnter) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-1 font-semibold">Marks sheets</h2>
        <p className="mb-3 text-sm opacity-70">Pick a sheet to enter marks. You see the subjects you teach; administrators see every sheet.</p>
        <ErrorText>{progress.error}</ErrorText>
        {progress.data && !rows.length && <p className="text-sm opacity-70">No sheets for you in this exam.</p>}
        {!!rows.length && (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Section</th><th>Subject</th><th>Entered</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.sectionId}-${r.subjectId}`}
                    className={`${rowClass} cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 ${open?.sectionId === r.sectionId && open.subjectId === r.subjectId ? "bg-brand/5" : ""}`}
                    onClick={() => setOpen(r)}
                  >
                    <td className="py-2 font-medium">{r.section}</td>
                    <td>{r.subject}</td>
                    <td>{r.entered} of {r.enrolled}</td>
                    <td>{r.missing ? <Badge tone="amber">{r.missing} missing</Badge> : <Badge tone="green">complete</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <MarksSheet key={`${open.sectionId}-${open.subjectId}`} examId={exam.id} row={open} onSaved={progress.reload} />}
    </div>
  );
}

function MarksSheet({ examId, row, onSaved }: { examId: string; row: ProgressRow; onSaved: () => Promise<void> }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Sheet>(`/exams/${examId}/marks?sectionId=${row.sectionId}&subjectId=${row.subjectId}`)
      .then((s) => {
        if (cancelled) return;
        setSheet(s);
        setEntries(Object.fromEntries(s.students.map((st) => [st.id, { marks: st.marks?.toString() ?? "", isAbsent: st.isAbsent }])));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [examId, row.sectionId, row.subjectId]);

  async function save() {
    // Blank rows are skipped so a teacher can save part of a sheet.
    const filled = Object.entries(entries).filter(([, e]) => e.isAbsent || e.marks !== "");
    if (!filled.length) return setError("Enter at least one mark.");
    setSaving(true);
    try {
      const res = await api<{ saved: number }>(`/exams/${examId}/marks`, {
        method: "PUT",
        body: {
          sectionId: row.sectionId,
          subjectId: row.subjectId,
          entries: filled.map(([studentId, e]) => ({ studentId, isAbsent: e.isAbsent, marks: e.isAbsent ? null : Number(e.marks) })),
        },
      });
      setNotice(`Saved marks for ${res.saved} students.`);
      setError("");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!sheet) return <ErrorText>{error}</ErrorText>;
  const max = sheet.paper.maxMarks;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">
          {sheet.section.name} · {sheet.paper.subject} · out of {max} (pass {sheet.paper.passMarks})
        </h2>
        {!sheet.locked && <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save marks"}</Button>}
      </div>
      {sheet.locked && <p className="mb-3 text-sm text-amber-700">Results are published, so marks are locked. An administrator can unpublish to correct them.</p>}
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
        {sheet.students.map((s) => {
          const e = entries[s.id] ?? { marks: "", isAbsent: false };
          const over = e.marks !== "" && Number(e.marks) > max;
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <span className="mr-2 inline-block w-6 text-right text-xs opacity-50">{s.rollNo}</span>
                <span className="font-medium">{s.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={max}
                  step="0.5"
                  value={e.isAbsent ? "" : e.marks}
                  disabled={sheet.locked || e.isAbsent}
                  onChange={(ev) => setEntries((all) => ({ ...all, [s.id]: { ...e, marks: ev.target.value } }))}
                  aria-label={`Marks for ${s.name}`}
                  className={`w-20 rounded-lg border bg-transparent px-2 py-1 text-right ${over ? "border-red-500" : "border-black/15 dark:border-white/20"}`}
                />
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={e.isAbsent}
                    disabled={sheet.locked}
                    onChange={(ev) => setEntries((all) => ({ ...all, [s.id]: { ...e, isAbsent: ev.target.checked } }))}
                  />
                  Absent
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      {!sheet.students.length && <p className="text-sm opacity-60">No students in this section.</p>}
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

// ---- Results ---------------------------------------------------------------

interface ResultRow {
  studentId: string;
  name: string;
  admissionNo: string;
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  position: number;
  passed: boolean;
  teacherRemark: string | null;
  principalRemark: string | null;
}

function ResultsTab({ exam, isAdmin, onChange }: { exam: Exam; isAdmin: boolean; onChange: () => Promise<void> }) {
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  const results = useApi<{ results: ResultRow[] }>(sectionId ? `/exams/${exam.id}/results?sectionId=${sectionId}` : null);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const published = exam.status === "PUBLISHED";
  const classIds = new Set(exam.papers.map((p) => p.classId));
  const options = sections.options.filter((o) => classIds.has(o.classId));

  async function run(action: "publish" | "unpublish") {
    if (action === "unpublish" && !confirm("Take results down? Parents will no longer see them until you publish again.")) return;
    setBusy(true);
    try {
      if (action === "publish") {
        const res = await api<{ published: number; messagesSent: number }>(`/exams/${exam.id}/publish`, { method: "POST", body: { sendWhatsApp } });
        setNotice(`Published results for ${res.published} students.${res.messagesSent ? ` ${res.messagesSent} parent messages sent.` : ""}`);
      } else {
        await api(`/exams/${exam.id}/unpublish`, { method: "POST" });
        setNotice("Results taken down. Marks can be corrected now.");
      }
      setError("");
      await Promise.all([onChange(), results.reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isAdmin && (
        <Card>
          {published ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">Published{exam.publishedAt ? ` on ${day(exam.publishedAt)}` : ""}. Parents can see report cards in their portal.</p>
              <Button variant="ghost" onClick={() => run("unpublish")} disabled={busy}>Unpublish to correct marks</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">Publishing calculates totals, grades and class positions and shows report cards to parents. Every mark must be entered first.</p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} /> Tell parents on WhatsApp
                </label>
                <Button onClick={() => run("publish")} disabled={busy}>{busy ? "Publishing..." : "Publish results"}</Button>
              </div>
            </div>
          )}
          <Notice>{notice}</Notice>
          <ErrorText>{error}</ErrorText>
        </Card>
      )}

      <Card>
        <div className="mb-4 max-w-xs">
          <Select
            label="Section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            options={[{ value: "", label: "Choose..." }, ...options]}
          />
        </div>
        <ErrorText>{results.error}</ErrorText>
        {sectionId && results.data && !results.data.results.length && (
          <p className="text-sm opacity-70">No results yet. They appear here once the exam is published.</p>
        )}
        {!!results.data?.results.length && (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Pos.</th><th>Student</th><th>Marks</th><th>%</th><th>Grade</th><th>Result</th><th>Teacher remark</th><th /></tr>
              </thead>
              <tbody>
                {results.data.results.map((r) => (
                  <tr key={r.studentId} className={rowClass}>
                    <td className="py-2 font-semibold">{r.position}</td>
                    <td>{r.name}<div className="text-xs opacity-60">{r.admissionNo}</div></td>
                    <td>{r.obtained} / {r.maxTotal}</td>
                    <td>{r.percent}</td>
                    <td>{r.grade}</td>
                    <td>{r.passed ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}</td>
                    <td><RemarkInput examId={exam.id} row={r} /></td>
                    <td>
                      {published && (
                        <Link href={`/exams/${exam.id}/report-cards/${r.studentId}`} className="text-sm text-brand hover:underline">Report card</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Saves the teacher's remark when the field loses focus. */
function RemarkInput({ examId, row }: { examId: string; row: ResultRow }) {
  const [value, setValue] = useState(row.teacherRemark ?? "");
  const [savedValue, setSavedValue] = useState(row.teacherRemark ?? "");
  const [state, setState] = useState<"" | "saved" | "error">("");
  async function save() {
    if (value === savedValue) return;
    try {
      await api(`/exams/${examId}/results/${row.studentId}/remarks`, { method: "PUT", body: { teacherRemark: value } });
      setSavedValue(value);
      setState("saved");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        maxLength={300}
        placeholder="Add a remark"
        aria-label={`Remark for ${row.name}`}
        className="w-48 rounded-lg border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
      />
      {state === "saved" && <span className="text-xs text-green-700">saved</span>}
      {state === "error" && <span className="text-xs text-red-600">not saved</span>}
    </div>
  );
}

// ---- Papers ----------------------------------------------------------------

interface Subject { id: string; name: string }

function PapersTab({ exam, onChange }: { exam: Exam; onChange: () => Promise<void> }) {
  const sections = useSectionOptions();
  const subjects = useApi<Subject[]>("/subjects");
  const [classId, setClassId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const published = exam.status === "PUBLISHED";
  const classes = sections.classes;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (!classId || !chosen.length) return setError("Choose a class and at least one subject.");
    try {
      await api(`/exams/${exam.id}/papers`, {
        method: "PUT",
        body: {
          papers: chosen.map((subjectId) => ({
            classId,
            subjectId,
            maxMarks: Number(f.get("maxMarks")),
            passMarks: Number(f.get("passMarks")),
            date: f.get("date") || undefined,
          })),
        },
      });
      setChosen([]);
      setError("");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(paper: Paper) {
    try {
      await api(`/exams/${exam.id}/papers/${paper.id}`, { method: "DELETE" });
      setError("");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <h2 className="mb-3 font-semibold">Papers</h2>
        {!exam.papers.length && <p className="text-sm opacity-70">No papers yet. Add the subjects each class sits.</p>}
        {!!exam.papers.length && (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Class</th><th>Subject</th><th>Total</th><th>Pass</th><th>Date</th><th /></tr></thead>
              <tbody>
                {exam.papers.map((p) => (
                  <tr key={p.id} className={rowClass}>
                    <td className="py-2">{p.class.name}</td>
                    <td>{p.subject.name}</td>
                    <td>{p.maxMarks}</td>
                    <td>{p.passMarks}</td>
                    <td>{p.date ? day(p.date) : "–"}</td>
                    <td>{!published && <button className="text-sm text-red-600" onClick={() => remove(p)}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
      {!published && (
        <Card>
          <h2 className="mb-4 font-semibold">Add papers</h2>
          <form className="flex flex-col gap-3" onSubmit={add}>
            <Select
              label="Class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              options={[{ value: "", label: "Choose..." }, ...classes.map((c) => ({ value: c.id, label: `${c.name} · ${c.campus.name}` }))]}
            />
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="mb-1 font-medium">Subjects</legend>
              {subjects.data?.map((s) => (
                <label key={s.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.includes(s.id)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id)))}
                  />
                  {s.name}
                </label>
              ))}
            </fieldset>
            <Field label="Total marks" name="maxMarks" type="number" min={1} defaultValue={100} required />
            <Field label="Pass marks" name="passMarks" type="number" min={0} defaultValue={33} required />
            <Field label="Date (optional)" name="date" type="date" />
            <Button type="submit">Save papers</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
