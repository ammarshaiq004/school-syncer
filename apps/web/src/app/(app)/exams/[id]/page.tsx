"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Award,
  BookOpen,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FileText,
  Lock,
  Percent,
  Plus,
  Save,
  Send,
  Trash2,
  Trophy,
  Undo2,
  Users,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  FieldLabel,
  IconButton,
  KpiCard,
  LetterGrade,
  NativeSelect,
  PageHeader,
  ProgressBar,
  Section,
  SelectField,
  Skeleton,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Switch,
  TabPanel,
  Tabs,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { can, useSession } from "@/lib/session";
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

type TabId = "marks" | "results" | "papers";

export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  // Whoever has "manage" on exams runs them: administrators, and custom roles
  // such as an exam coordinator.
  const canManage = can(user, "exams", "manage");
  const exam = useApi<Exam>(`/exams/${id}`);
  const [tab, setTab] = useState<TabId>("marks");
  const published = exam.data?.status === "PUBLISHED";

  const tabs = [
    { value: "marks", label: "Marks", icon: <ClipboardList /> },
    { value: "results", label: "Results", icon: <Award /> },
    ...(canManage ? [{ value: "papers", label: "Papers", icon: <BookOpen />, count: exam.data?.papers.length }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={exam.data?.name ?? (exam.error ? "Exam" : <Skeleton className="h-7 w-48" />)}
        breadcrumbs={[{ label: "Exams", href: "/exams" }, { label: exam.data?.name ?? "Exam" }]}
        description={exam.data ? `Academic year ${exam.data.academicYear.name}` : undefined}
        meta={
          exam.data && (
            <>
              <StatusPill status={exam.data.status} />
              {published && exam.data.publishedAt && <span className="text-[13px] text-fg-muted">Published {day(exam.data.publishedAt)}</span>}
            </>
          )
        }
        actions={
          <Link href="/exams" className={buttonClass("secondary", "sm")}>
            All exams
          </Link>
        }
      />
      {exam.error ? (
        <ErrorState message={exam.error} onRetry={exam.reload} />
      ) : !exam.data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-72" />
          <SkeletonRows rows={5} />
        </div>
      ) : (
        <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as TabId)} aria-label="Exam sections">
          <TabPanel value="marks">
            <MarksTab exam={exam.data} canManage={canManage} />
          </TabPanel>
          <TabPanel value="results">
            <ResultsTab exam={exam.data} canManage={canManage} onChange={exam.reload} />
          </TabPanel>
          {canManage && (
            <TabPanel value="papers">
              <PapersTab exam={exam.data} onChange={exam.reload} />
            </TabPanel>
          )}
        </Tabs>
      )}
    </div>
  );
}

// ---- Marks entry -----------------------------------------------------------

interface Sheet {
  paper: { subject: string; maxMarks: number; passMarks: number };
  section: { name: string };
  locked: boolean;
  /** False when the user may read this sheet but not change it (exam managers who do not teach the subject). */
  canEnter: boolean;
  students: { id: string; name: string; admissionNo: string; rollNo: number | null; marks: number | null; isAbsent: boolean }[];
}
type Entry = { marks: string; isAbsent: boolean };

const sheetKey = (r: { sectionId: string; subjectId: string }) => `${r.sectionId}-${r.subjectId}`;

function MarksTab({ exam, canManage }: { exam: Exam; canManage: boolean }) {
  const progress = useApi<ProgressRow[]>(`/exams/${exam.id}/progress`);
  const [open, setOpen] = useState<ProgressRow | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  // Whoever runs the exam sees every sheet so they can chase missing marks;
  // sheets they do not teach open read-only. Teachers see their own subjects.
  const all = canManage ? progress.data : progress.data?.filter((r) => r.canEnter);
  const rows = all?.filter((r) => !missingOnly || r.missing > 0) ?? null;
  const sheetRef = useRef<HTMLDivElement>(null);

  function choose(r: ProgressRow) {
    setOpen(r);
    requestAnimationFrame(() => sheetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const columns: Column<ProgressRow>[] = [
    { id: "section", header: "Section", sortValue: (r) => r.section, cell: (r) => <span className="font-medium text-fg">{r.section}</span> },
    { id: "subject", header: "Subject", sortValue: (r) => r.subject, cell: (r) => r.subject },
    {
      id: "entered",
      header: "Entered",
      sortValue: (r) => (r.enrolled ? r.entered / r.enrolled : 0),
      cell: (r) => (
        <ProgressBar
          value={r.entered}
          max={r.enrolled}
          valueText={`${r.entered} of ${r.enrolled}`}
          tone={r.missing ? "primary" : "success"}
          size="sm"
          className="min-w-36 max-w-56"
        />
      ),
      hideBelow: "sm",
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.missing,
      cell: (r) => (r.missing ? <StatusPill status="pending" label={`${r.missing} missing`} /> : <StatusPill status="completed" label="Complete" />),
    },
    {
      id: "open",
      header: <span className="sr-only">Open</span>,
      width: "110px",
      align: "right",
      cell: (r) => (
        <Button type="button" size="sm" variant={open && sheetKey(open) === sheetKey(r) ? "primary" : "secondary"} onClick={() => choose(r)}>
          {open && sheetKey(open) === sheetKey(r) ? "Open" : r.canEnter ? "Enter marks" : "View"}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Marks sheets"
        description={
          canManage
            ? "Every sheet in this exam. Sheets for subjects you do not teach open read-only."
            : "Pick a sheet to enter marks. You see the subjects you teach."
        }
        action={
          <Switch
            checked={missingOnly}
            onCheckedChange={setMissingOnly}
            label="Missing only"
          />
        }
      >
        <DataTable
          label="Marks sheets"
          columns={columns}
          data={rows}
          getRowId={sheetKey}
          error={progress.error}
          onRetry={progress.reload}
          getSearchText={(r) => `${r.section} ${r.subject}`}
          searchPlaceholder="Search section or subject"
          onRowClick={choose}
          getRowLabel={(r) => `${r.canEnter ? "Enter marks for" : "View marks for"} ${r.section} ${r.subject}`}
          rowClassName={(r) => (open && sheetKey(open) === sheetKey(r) ? "[&>td]:bg-primary-tint" : undefined)}
          empty={
            missingOnly
              ? { icon: <CircleCheck />, title: "Nothing missing", description: "Every sheet you can see has all its marks entered." }
              : canManage
                ? { icon: <ClipboardList />, title: "No sheets in this exam", description: "Sheets appear once papers are added for classes with sections." }
                : { icon: <ClipboardList />, title: "No sheets for you in this exam", description: "Sheets appear once papers are added for the classes you teach." }
          }
          dense
          pageSize={10}
        />
      </Section>
      <div ref={sheetRef} className="scroll-mt-20">
        {open && <MarksSheet key={sheetKey(open)} examId={exam.id} row={open} onSaved={progress.reload} />}
      </div>
    </div>
  );
}

function MarksSheet({ examId, row, onSaved }: { examId: string; row: ProgressRow; onSaved: () => Promise<void> }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    api<Sheet>(`/exams/${examId}/marks?sectionId=${row.sectionId}&subjectId=${row.subjectId}`)
      .then((s) => {
        if (cancelled) return;
        setSheet(s);
        setLoadError("");
        setEntries(Object.fromEntries(s.students.map((st) => [st.id, { marks: st.marks?.toString() ?? "", isAbsent: st.isAbsent }])));
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [examId, row.sectionId, row.subjectId, attempt]);

  // A half-entered sheet is easy to lose: warn before a reload or a closed tab.
  // (An in-app link cannot be blocked with the app router, so the "Unsaved
  // changes" badge and this warning are what we have.)
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(studentId: string, patch: Partial<Entry>) {
    setEntries((all) => ({ ...all, [studentId]: { ...(all[studentId] ?? { marks: "", isAbsent: false }), ...patch } }));
    setDirty(true);
  }

  async function save() {
    // Blank rows are skipped so a teacher can save part of a sheet.
    const filled = Object.entries(entries).filter(([, e]) => e.isAbsent || e.marks !== "");
    if (!filled.length) return setError("Enter at least one mark.");
    // The API refuses the whole sheet over one out-of-range mark, so stop here.
    const limit = sheet?.paper.maxMarks ?? 0;
    const bad = filled.filter(([, e]) => !e.isAbsent && (Number(e.marks) < 0 || Number(e.marks) > limit));
    if (bad.length) return setError(`Marks must be between 0 and ${limit}. Fix ${bad.length} mark${bad.length === 1 ? "" : "s"} first.`);
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
      toast.success("Marks saved", `Saved marks for ${res.saved} students.`);
      setError("");
      setDirty(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Enter or arrow keys move between mark cells, like a spreadsheet. */
  function onCellKey(event: KeyboardEvent<HTMLInputElement>, index: number) {
    const step = event.key === "Enter" || event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const cells = tableRef.current?.querySelectorAll<HTMLInputElement>("input[data-mark-cell]:not(:disabled)");
    if (!cells) return;
    const list = Array.from(cells);
    const current = list.findIndex((c) => Number(c.dataset.markCell) === index);
    const next = list[current + step];
    if (next) {
      next.focus();
      next.select();
    }
  }

  if (loadError)
    return (
      <Card>
        <ErrorState title="Could not load this marks sheet" message={loadError} onRetry={() => setAttempt((n) => n + 1)} compact />
      </Card>
    );
  if (!sheet)
    return (
      <Card>
        <Skeleton className="mb-4 h-6 w-64" />
        <SkeletonRows rows={6} columns={4} />
      </Card>
    );

  const max = sheet.paper.maxMarks;
  const pass = sheet.paper.passMarks;
  const readOnly = sheet.locked || !sheet.canEnter;
  const entered = sheet.students
    .map((s) => entries[s.id])
    .filter((e): e is Entry => !!e && !e.isAbsent && e.marks !== "" && !Number.isNaN(Number(e.marks)))
    .map((e) => Number(e.marks));
  // An out-of-range mark is not a mark yet: it is left out of the totals and
  // blocks saving, because the API refuses the whole sheet over one bad value.
  const values = entered.filter((v) => v >= 0 && v <= max);
  const overMax = entered.filter((v) => v > max).length;
  const belowZero = entered.filter((v) => v < 0).length;
  const invalidCount = overMax + belowZero;
  const fixMessage =
    invalidCount === 0
      ? ""
      : belowZero === 0
        ? `Fix ${overMax} mark${overMax === 1 ? "" : "s"} over ${max}`
        : overMax === 0
          ? `Fix ${belowZero} mark${belowZero === 1 ? "" : "s"} below 0`
          : `Fix ${invalidCount} marks outside 0 to ${max}`;
  const absent = sheet.students.filter((s) => entries[s.id]?.isAbsent).length;
  const blank = sheet.students.length - entered.length - absent;
  const passed = values.filter((v) => v >= pass).length;
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const highest = values.length ? Math.max(...values) : null;

  const saveButton = !readOnly && (
    <Button type="button" icon={<Save />} onClick={save} loading={saving} disabled={invalidCount > 0} title={fixMessage || undefined}>
      Save marks
    </Button>
  );

  return (
    <Card padding="none" className="animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">
            {sheet.section.name}, {sheet.paper.subject}
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">
            Out of <span className="tabular-nums">{max}</span>, pass mark <span className="tabular-nums">{pass}</span>. Press Enter to move to the next student.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {invalidCount > 0 && <Badge tone="danger" icon={<CircleAlert />}>{fixMessage}</Badge>}
          {dirty && <Badge tone="warning">Unsaved changes</Badge>}
          {sheet.locked && <Badge tone="neutral" icon={<Lock />}>Locked</Badge>}
          {!sheet.locked && !sheet.canEnter && <Badge tone="neutral" icon={<Lock />}>Read-only</Badge>}
          {saveButton}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {sheet.locked && (
          <Alert tone="warning" title="Marks are locked">
            Results are published, so marks are locked. An administrator can unpublish to correct them.
          </Alert>
        )}

        {!sheet.locked && !sheet.canEnter && (
          <Alert tone="info" title="You can read this sheet but not change it">
            Only the teacher of this subject (or an administrator) enters its marks.
          </Alert>
        )}

        {invalidCount > 0 && (
          <Alert tone="danger" title={fixMessage}>
            Marks must be between 0 and {max}. The sheet cannot be saved, and the totals below leave these out.
          </Alert>
        )}

        {sheet.students.length > 0 && (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm sm:grid-cols-5">
            {[
              ["Entered", `${values.length + absent} of ${sheet.students.length}`],
              ["Blank", blank],
              ["Average", average === null ? "None yet" : `${average.toFixed(1)} / ${max}`],
              ["Highest", highest === null ? "None yet" : highest],
              ["Passing", values.length ? `${passed} of ${values.length}` : "None yet"],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface-2 px-3 py-2">
                <dt className="text-xs text-fg-muted">{label}</dt>
                <dd className="font-medium tabular-nums text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!sheet.students.length ? (
          <EmptyState icon={<Users />} title="No students in this section" description="Students enrolled in this section will appear here." compact />
        ) : (
          <div className="max-h-[65vh] overflow-auto rounded-lg border border-border">
            <table ref={tableRef} className="w-full min-w-[560px] border-separate border-spacing-0 text-sm" aria-label={`Marks for ${sheet.section.name}, ${sheet.paper.subject}`}>
              <thead className="sticky top-0 z-20">
                <tr className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted [&>th]:h-10 [&>th]:border-b [&>th]:border-border [&>th]:bg-surface-2 [&>th]:px-3 [&>th]:text-left">
                  <th scope="col" className="sticky left-0 z-10 w-[40%] border-r">Student</th>
                  <th scope="col" className="w-32 text-right!">Marks / {max}</th>
                  <th scope="col" className="w-20 text-right!">%</th>
                  <th scope="col" className="w-24">Absent</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {sheet.students.map((s, i) => {
                  const e = entries[s.id] ?? { marks: "", isAbsent: false };
                  const hasMark = !e.isAbsent && e.marks !== "";
                  const n = Number(e.marks);
                  const over = hasMark && n > max;
                  const negative = hasMark && n < 0;
                  const failing = hasMark && !over && !negative && n < pass;
                  const invalid = over || negative;
                  return (
                    <tr
                      key={s.id}
                      className={cn(
                        "[&>*]:h-11 [&>*]:border-b [&>*]:border-border [&>*]:px-3 [&>*]:transition-colors last:[&>*]:border-b-0",
                        failing || invalid ? "[&>*]:bg-danger-tint" : i % 2 ? "[&>*]:bg-surface-2" : "[&>*]:bg-surface",
                        "focus-within:[&>*]:bg-primary-tint",
                      )}
                    >
                      <th scope="row" className="sticky left-0 z-10 border-r text-left font-normal">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-fg-muted">{s.rollNo ?? ""}</span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-fg">{s.name}</div>
                            {/* Duplicate names are common, so show the admission number too. */}
                            <div className="truncate text-xs tabular-nums text-fg-muted">{s.admissionNo}</div>
                          </div>
                        </div>
                      </th>
                      <td className="text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={max}
                          step="0.5"
                          data-mark-cell={i}
                          value={e.isAbsent ? "" : e.marks}
                          placeholder={e.isAbsent ? "Abs" : ""}
                          disabled={readOnly || e.isAbsent}
                          onChange={(ev) => edit(s.id, { marks: ev.target.value })}
                          onKeyDown={(ev) => onCellKey(ev, i)}
                          onFocus={(ev) => ev.currentTarget.select()}
                          onWheel={(ev) => ev.currentTarget.blur()}
                          aria-label={`Marks for ${s.name}`}
                          aria-invalid={invalid || undefined}
                          className={cn(
                            "h-8 w-24 rounded-md border bg-surface px-2 text-right tabular-nums text-fg outline-none transition-[border-color,box-shadow] duration-150",
                            "border-border hover:border-border-strong focus:border-primary focus:ring-[3px] focus:ring-ring",
                            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted",
                            invalid && "border-danger focus:border-danger focus:ring-danger/25",
                            failing && "text-danger-text",
                          )}
                        />
                      </td>
                      <td className="text-right tabular-nums text-fg-secondary">{hasMark && !invalid && max > 0 ? `${Math.round((n / max) * 100)}` : ""}</td>
                      <td>
                        <Checkbox
                          checked={e.isAbsent}
                          disabled={readOnly}
                          onCheckedChange={(c) => edit(s.id, { isAbsent: c })}
                          aria-label={`${s.name} was absent`}
                        />
                      </td>
                      <td>
                        {e.isAbsent ? (
                          <StatusPill status="absent" />
                        ) : over ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text"><CircleAlert className="size-3.5" aria-hidden />Over {max}</span>
                        ) : negative ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text"><CircleAlert className="size-3.5" aria-hidden />Below 0</span>
                        ) : hasMark ? (
                          <StatusPill status={failing ? "failed" : "passed"} label={failing ? "Below pass" : "Pass"} />
                        ) : (
                          <span className="text-xs text-fg-muted">Not entered</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
        {saveButton && sheet.students.length > 8 && <div className="flex justify-end">{saveButton}</div>}
      </div>
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

function ResultsTab({ exam, canManage, onChange }: { exam: Exam; canManage: boolean; onChange: () => Promise<void> }) {
  // Only the campuses this user's roles cover: the API refuses the others.
  const sections = useSectionOptions({ campusScoped: true });
  const [sectionId, setSectionId] = useState("");
  const results = useApi<{ results: ResultRow[] }>(sectionId ? `/exams/${exam.id}/results?sectionId=${sectionId}` : null);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const toast = useToast();
  const published = exam.status === "PUBLISHED";
  const classIds = new Set(exam.papers.map((p) => p.classId));
  const options = sections.options.filter((o) => classIds.has(o.classId));

  async function run(action: "publish" | "unpublish") {
    setBusy(true);
    try {
      if (action === "publish") {
        const res = await api<{ published: number; messagesSent: number }>(`/exams/${exam.id}/publish`, { method: "POST", body: { sendWhatsApp } });
        toast.success(
          "Results published",
          `Published results for ${res.published} students.${res.messagesSent ? ` ${res.messagesSent} parent messages sent.` : ""}`,
        );
      } else {
        await api(`/exams/${exam.id}/unpublish`, { method: "POST" });
        toast.info("Results taken down", "Marks can be corrected now.");
      }
      setError("");
      setConfirmUnpublish(false);
      await Promise.all([onChange(), results.reload()]);
    } catch (e) {
      setError((e as Error).message);
      setConfirmUnpublish(false);
    } finally {
      setBusy(false);
    }
  }

  const list = sectionId ? results.data?.results : [];
  const rows = list ?? [];
  const passCount = rows.filter((r) => r.passed).length;
  const avg = rows.length ? rows.reduce((n, r) => n + r.percent, 0) / rows.length : 0;
  const top = [...rows].sort((a, b) => a.position - b.position)[0];

  const columns: Column<ResultRow>[] = [
    {
      id: "position",
      header: "Pos.",
      align: "right",
      width: "64px",
      sortValue: (r) => r.position,
      cell: (r) => <span className={cn("font-semibold", r.position <= 3 ? "text-brand" : "text-fg")}>{r.position}</span>,
    },
    {
      id: "student",
      header: "Student",
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{r.name}</div>
          <div className="text-xs text-fg-muted">{r.admissionNo}</div>
        </div>
      ),
    },
    { id: "marks", header: "Marks", align: "right", sortValue: (r) => r.obtained, cell: (r) => `${r.obtained} / ${r.maxTotal}`, hideBelow: "sm" },
    { id: "percent", header: "%", align: "right", sortValue: (r) => r.percent, cell: (r) => r.percent },
    { id: "grade", header: "Grade", align: "center", sortValue: (r) => r.percent, cell: (r) => <LetterGrade grade={r.grade} /> },
    {
      id: "result",
      header: "Result",
      sortValue: (r) => Number(r.passed),
      cell: (r) => <StatusPill status={r.passed ? "passed" : "failed"} label={r.passed ? "Pass" : "Fail"} />,
    },
    { id: "remark", header: "Teacher remark", cell: (r) => <RemarkInput examId={exam.id} row={r} />, hideBelow: "md" },
    {
      id: "card",
      header: <span className="sr-only">Report card</span>,
      align: "right",
      cell: (r) =>
        published ? (
          <Link href={`/exams/${exam.id}/report-cards/${r.studentId}`} className={buttonClass("ghost", "sm", "whitespace-nowrap")}>
            <FileText aria-hidden />
            Report card
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <Card>
          {published ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success-tint text-success-text" aria-hidden>
                  <CircleCheck className="size-[18px]" />
                </span>
                <div>
                  <p className="font-medium text-fg">Published{exam.publishedAt ? ` on ${day(exam.publishedAt)}` : ""}</p>
                  <p className="text-sm text-fg-muted">Parents can see report cards in their portal.</p>
                </div>
              </div>
              <Button type="button" variant="secondary" icon={<Undo2 />} onClick={() => setConfirmUnpublish(true)} disabled={busy}>
                Unpublish to correct marks
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 max-w-2xl items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-tint text-warning-text" aria-hidden>
                  <Send className="size-[18px]" />
                </span>
                <div>
                  <p className="font-medium text-fg">Ready to publish?</p>
                  <p className="text-sm text-fg-muted">
                    Publishing calculates totals, grades and class positions and shows report cards to parents. Every mark must be entered first.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Switch checked={sendWhatsApp} onCheckedChange={setSendWhatsApp} label="Tell parents on WhatsApp" />
                <Button type="button" icon={<Send />} onClick={() => run("publish")} loading={busy}>
                  Publish results
                </Button>
              </div>
            </div>
          )}
          {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
        </Card>
      )}

      {/* The KPIs are only shown once this section's results are in: no numbers while loading or after a failure. */}
      {sectionId && !results.error && (
        results.data ? (
          rows.length > 0 && (
            <StatGrid>
              <KpiCard label="Students" value={rows.length} icon={<Users />} />
              <KpiCard label="Class average" value={`${avg.toFixed(1)}%`} icon={<Percent />} tone="info" />
              <KpiCard label="Passed" value={`${passCount} of ${rows.length}`} icon={<CircleCheck />} tone={passCount === rows.length ? "success" : "warning"} />
              <KpiCard label="Top of class" value={top?.name ?? ""} hint={top ? `${top.percent}%, grade ${top.grade}` : undefined} icon={<Trophy />} tone="primary" />
            </StatGrid>
          )
        ) : (
          <SkeletonCards count={4} />
        )
      )}

      <DataTable
        label="Results"
        columns={columns}
        data={list}
        getRowId={(r) => r.studentId}
        error={sectionId ? results.error : undefined}
        onRetry={results.reload}
        loading={!!sectionId && !results.data && !results.error}
        getSearchText={(r) => `${r.name} ${r.admissionNo}`}
        searchPlaceholder="Search student"
        defaultSort={{ id: "position", dir: "asc" }}
        filters={
          <NativeSelect
            aria-label="Section"
            placeholder="Choose a section"
            options={options}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            wrapperClassName="w-56"
          />
        }
        rowClassName={(r) => (r.passed ? undefined : "[&>td]:bg-danger-tint/40")}
        empty={
          sectionId
            ? { icon: <Award />, title: "No results yet", description: "They appear here once the exam is published." }
            : { icon: <Users />, title: "Choose a section", description: "Pick a section above to see its results, grades and positions." }
        }
        pageSize={50}
      />

      <ConfirmDialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title="Take results down?"
        description="Parents will no longer see them until you publish again."
        confirmLabel="Unpublish"
        destructive
        loading={busy}
        onConfirm={() => run("unpublish")}
      />
    </div>
  );
}

/** Saves the teacher's remark when the field loses focus. */
function RemarkInput({ examId, row }: { examId: string; row: ResultRow }) {
  const [value, setValue] = useState(row.teacherRemark ?? "");
  const [savedValue, setSavedValue] = useState(row.teacherRemark ?? "");
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  async function save() {
    if (value === savedValue) return;
    setState("saving");
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
        aria-invalid={state === "error" || undefined}
        className="h-8 w-52 rounded-md border border-border bg-surface px-2 text-sm text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-fg-muted hover:border-border-strong focus:border-primary focus:ring-[3px] focus:ring-ring aria-[invalid=true]:border-danger"
      />
      <span className="w-16 text-xs" aria-live="polite">
        {state === "saving" && <span className="text-fg-muted">Saving</span>}
        {state === "saved" && (
          <span className="inline-flex items-center gap-1 text-success-text">
            <CircleCheck className="size-3.5" aria-hidden />
            Saved
          </span>
        )}
        {state === "error" && (
          <span className="inline-flex items-center gap-1 text-danger-text">
            <CircleAlert className="size-3.5" aria-hidden />
            Not saved
          </span>
        )}
      </span>
    </div>
  );
}

// ---- Papers ----------------------------------------------------------------

interface Subject { id: string; name: string }

const PAPERS_FORM = "add-papers-form";

function PapersTab({ exam, onChange }: { exam: Exam; onChange: () => Promise<void> }) {
  const sections = useSectionOptions();
  const subjects = useApi<Subject[]>("/subjects");
  const [classId, setClassId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const toast = useToast();
  const published = exam.status === "PUBLISHED";
  const classes = sections.classes;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (!classId || !chosen.length) return setError("Choose a class and at least one subject.");
    setSaving(true);
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
      toast.success("Papers saved", `${chosen.length} ${chosen.length === 1 ? "paper" : "papers"} saved.`);
      setChosen([]);
      setError("");
      setAdding(false);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(paper: Paper) {
    setRemoving(paper.id);
    try {
      await api(`/exams/${exam.id}/papers/${paper.id}`, { method: "DELETE" });
      toast.success("Paper removed", `${paper.subject.name} for ${paper.class.name}.`);
      await onChange();
    } catch (e) {
      toast.error("Could not remove paper", (e as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  const addButton = !published ? (
    <Button type="button" size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
      Add papers
    </Button>
  ) : undefined;

  const columns: Column<Paper>[] = [
    { id: "class", header: "Class", sortValue: (p) => p.class.name, cell: (p) => <span className="font-medium text-fg">{p.class.name}</span> },
    { id: "subject", header: "Subject", sortValue: (p) => p.subject.name, cell: (p) => p.subject.name },
    { id: "total", header: "Total", align: "right", sortValue: (p) => p.maxMarks, cell: (p) => p.maxMarks },
    { id: "pass", header: "Pass", align: "right", sortValue: (p) => p.passMarks, cell: (p) => p.passMarks },
    { id: "date", header: "Date", sortValue: (p) => p.date, cell: (p) => (p.date ? day(p.date) : <span className="text-fg-muted">Not set</span>), hideBelow: "sm" },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "56px",
      align: "right",
      cell: (p) =>
        !published && (
          <IconButton
            size="sm"
            aria-label={`Remove ${p.subject.name} paper for ${p.class.name}`}
            loading={removing === p.id}
            onClick={() => remove(p)}
            className="hover:text-danger-text"
          >
            <Trash2 />
          </IconButton>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {published && (
        <Alert tone="info">Results are published, so papers cannot be changed. Unpublish from the Results tab to edit them.</Alert>
      )}
      <DataTable
        label="Papers"
        columns={columns}
        data={exam.papers}
        getRowId={(p) => p.id}
        getSearchText={(p) => `${p.class.name} ${p.subject.name}`}
        searchPlaceholder="Search class or subject"
        toolbarActions={addButton}
        defaultSort={{ id: "class", dir: "asc" }}
        empty={{ icon: <BookOpen />, title: "No papers yet", description: "Add the subjects each class sits.", action: addButton }}
        pageSize={50}
      />

      <Drawer
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setError("");
        }}
        title="Add papers"
        description="Pick a class and the subjects it sits. Every chosen subject gets the same marks and date."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" form={PAPERS_FORM} loading={saving}>
              Save papers
            </Button>
          </>
        }
      >
        <form id={PAPERS_FORM} className="grid gap-5" onSubmit={add}>
          <SelectField
            label="Class"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            placeholder="Choose a class"
            options={classes.map((c) => ({ value: c.id, label: `${c.name}, ${c.campus.name}` }))}
            error={sections.error || undefined}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 flex w-full items-center justify-between gap-2">
              <FieldLabel>Subjects</FieldLabel>
              {!!subjects.data?.length && (
                <button
                  type="button"
                  className="text-xs font-medium text-brand hover:underline"
                  onClick={() => setChosen(chosen.length === subjects.data!.length ? [] : subjects.data!.map((s) => s.id))}
                >
                  {chosen.length === subjects.data.length ? "Clear all" : "Select all"}
                </button>
              )}
            </legend>
            {subjects.error ? (
              <ErrorState message={subjects.error} onRetry={subjects.reload} compact />
            ) : !subjects.data ? (
              <SkeletonRows rows={4} columns={1} />
            ) : !subjects.data.length ? (
              <EmptyState icon={<BookOpen />} title="No subjects yet" description="Add subjects on the Classes page first." compact />
            ) : (
              <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                {subjects.data.map((s) => (
                  <Checkbox
                    key={s.id}
                    label={s.name}
                    checked={chosen.includes(s.id)}
                    onCheckedChange={(checked) => setChosen((c) => (checked ? [...c, s.id] : c.filter((x) => x !== s.id)))}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Total marks" name="maxMarks" type="number" min={1} defaultValue={100} required />
            <TextField label="Pass marks" name="passMarks" type="number" min={0} defaultValue={33} required />
          </div>
          <TextField label="Date" hint="Optional" name="date" type="date" />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Drawer>
    </div>
  );
}
