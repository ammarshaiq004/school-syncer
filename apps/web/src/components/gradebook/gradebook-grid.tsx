"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BookOpenCheck, CircleCheck, ClipboardList, Download, Lock, Sigma, TriangleAlert, Users } from "lucide-react";
import { Avatar, Badge, Button, buttonClass, Card, EmptyState, ErrorState, KpiCard, LetterGrade, SearchInput, Skeleton, Spinner, StatGrid, Tooltip, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { downloadCsv } from "@/lib/csv";
import {
  cellText,
  classAverage,
  KIND_META,
  letterGrade,
  parseEntry,
  rescoreRow,
  shortDate,
  type Gradebook,
  type GradebookCell,
  type GradebookColumn,
  type GradebookRow,
} from "./gradebook-rules";

interface Loaded {
  key: string;
  book: Gradebook;
}

const cellId = (studentId: string, colKey: string) => `${studentId}|${colKey}`;
const pct = (n: number | null) => (n == null ? "-" : `${n.toFixed(1)}%`);

/** Spreadsheet of one section and subject: students down the side, assessments across. */
export function GradebookGrid({ sectionId, subjectId }: { sectionId: string; subjectId: string }) {
  const toast = useToast();
  const key = `${sectionId}|${subjectId}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  /** Text typed into a cell that has not been saved yet (or is invalid). */
  const [drafts, setDraftsState] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [announce, setAnnounce] = useState("");
  // Refs hold the latest values for blur/keyboard handlers that fire back to back.
  const bookRef = useRef<Loaded | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const seq = useRef(new Map<string, number>());
  const gridRef = useRef<HTMLTableElement>(null);

  const setBook = useCallback((next: Loaded | null) => {
    bookRef.current = next;
    setLoaded(next);
  }, []);
  const setDraft = useCallback((id: string, text: string | undefined) => {
    const next = { ...draftsRef.current };
    if (text === undefined) delete next[id];
    else next[id] = text;
    draftsRef.current = next;
    setDraftsState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const k = `${sectionId}|${subjectId}`;
    api<Gradebook>(`/gradebook?sectionId=${encodeURIComponent(sectionId)}&subjectId=${encodeURIComponent(subjectId)}`)
      .then((book) => {
        if (cancelled) return;
        draftsRef.current = {};
        setDraftsState({});
        setBook({ key: k, book });
        setLoadError(null);
      })
      .catch((e: Error) => !cancelled && setLoadError({ key: k, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [sectionId, subjectId, attempt, setBook]);

  const data = loaded?.key === key ? loaded.book : null;
  const error = loadError?.key === key ? loadError.message : "";
  const columns = useMemo(() => data?.columns ?? [], [data]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => !q || `${r.name} ${r.admissionNo} ${r.rollNo ?? ""}`.toLowerCase().includes(q)),
    [data, q],
  );
  const average = useMemo(() => (data ? classAverage(data.rows, data.columns) : null), [data]);

  /** Replaces one cell (and rescores that row) in the loaded book. */
  const putCell = useCallback(
    (k: string, studentId: string, colKey: string, cell: GradebookCell) => {
      const cur = bookRef.current;
      if (!cur || cur.key !== k) return;
      const book = cur.book;
      const rowsNext = book.rows.map((r) => (r.studentId === studentId ? rescoreRow({ ...r, cells: { ...r.cells, [colKey]: cell } }, book.gradeBands) : r));
      setBook({ key: k, book: { ...book, rows: rowsNext } });
    },
    [setBook],
  );

  function save(k: string, row: GradebookRow, col: GradebookColumn, next: GradebookCell, original: GradebookCell) {
    const id = cellId(row.studentId, col.key);
    const n = (seq.current.get(id) ?? 0) + 1;
    seq.current.set(id, n);
    putCell(k, row.studentId, col.key, next);
    setSaving((s) => ({ ...s, [id]: true }));
    const [secId, subId] = k.split("|");
    const request =
      col.kind === "EXAM"
        ? api(`/exams/${col.refId}/marks`, {
            method: "PUT",
            body: { sectionId: secId, subjectId: subId, entries: [{ studentId: row.studentId, marks: next.status === "absent" ? null : next.score, isAbsent: next.status === "absent" }] },
          })
        : api(`/elearning/assignments/${col.refId}/grades/${row.studentId}`, { method: "PUT", body: { points: next.score } });
    request
      .then(() => setAnnounce(`Saved ${row.name}, ${col.title}.`))
      .catch((e: Error) => {
        if (seq.current.get(id) !== n) return; // a newer edit owns this cell now
        putCell(k, row.studentId, col.key, original);
        toast.error(`Could not save ${row.name}'s mark for ${col.title}`, `${e.message} The previous mark is back.`);
        setAnnounce(`Could not save ${row.name}, ${col.title}. Changed back.`);
      })
      .finally(() => {
        if (seq.current.get(id) === n) setSaving((s) => ({ ...s, [id]: false }));
      });
  }

  /** Saves what was typed into a cell, if it changed and is valid. Safe to call twice. */
  function commit(studentId: string, col: GradebookColumn) {
    const id = cellId(studentId, col.key);
    const text = draftsRef.current[id];
    const cur = bookRef.current;
    if (text === undefined || !cur || cur.key !== key) return;
    const row = cur.book.rows.find((r) => r.studentId === studentId);
    const cell = row?.cells[col.key];
    if (!row || !cell || !cell.editable) return setDraft(id, undefined);
    const parsed = parseEntry(text, col);
    if (parsed.kind === "invalid") {
      setAnnounce(`${row.name}, ${col.title}: ${parsed.reason}. Not saved.`);
      return;
    }
    if (parsed.kind === "empty") {
      setDraft(id, undefined);
      if (cell.status === "graded" || cell.status === "absent") {
        toast.info("Marks cannot be removed", col.kind === "EXAM" ? "Type a new mark instead, or A to mark the student absent." : "Type the new points instead.");
      }
      return;
    }
    setDraft(id, undefined);
    let next: GradebookCell;
    if (parsed.kind === "absent") {
      if (cell.status === "absent") return;
      next = { ...cell, score: 0, status: "absent" };
    } else {
      if (cell.status === "graded" && cell.score === parsed.value) return;
      next = { ...cell, score: parsed.value, status: "graded" };
    }
    save(cur.key, row, col, next, cell);
  }

  // Keyboard: arrows and Enter move like a spreadsheet, skipping read-only cells.
  function focusCell(r: number, c: number, dr: number, dc: number) {
    let [nr, nc] = [r + dr, c + dc];
    while (nr >= 0 && nr < rows.length && nc >= 0 && nc < columns.length) {
      const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${nr}-${nc}"]`);
      if (el) {
        el.focus();
        el.select();
        return true;
      }
      nr += dr;
      nc += dc;
    }
    return false;
  }

  function onCellKey(e: KeyboardEvent<HTMLInputElement>, r: number, c: number, row: GradebookRow, col: GradebookColumn) {
    const input = e.currentTarget;
    const len = input.value.length;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const allSelected = start === 0 && end === len;
    let move: [number, number] | null = null;
    if (e.key === "Enter") move = [e.shiftKey ? -1 : 1, 0];
    else if (e.key === "ArrowDown") move = [1, 0];
    else if (e.key === "ArrowUp") move = [-1, 0];
    else if (e.key === "ArrowLeft" && (end === 0 || allSelected)) move = [0, -1];
    else if (e.key === "ArrowRight" && (start === len || allSelected)) move = [0, 1];
    else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(cellId(row.studentId, col.key), undefined);
      setAnnounce("Change undone.");
      return;
    }
    if (!move) return;
    e.preventDefault();
    commit(row.studentId, col);
    focusCell(r, c, move[0], move[1]);
  }

  function exportCsv() {
    if (!data) return;
    const header = ["Roll no", "Admission no", "Student", ...data.columns.map((c) => `${c.title} (${KIND_META[c.kind].label}, out of ${c.maxPoints})`), "Overall %", "Grade"];
    const body = data.rows.map((r) => [
      r.rollNo,
      r.admissionNo,
      r.name,
      ...data.columns.map((c) => {
        const cell = r.cells[c.key];
        if (!cell) return "";
        if (cell.status === "absent") return "Absent";
        if (cell.status === "submitted") return "Submitted";
        return cell.score ?? "";
      }),
      r.overallPercent ?? "",
      r.letterGrade ?? "",
    ]);
    if (average) {
      body.push(["", "", "Class average (%)", ...data.columns.map((c) => average.byColumn[c.key] ?? ""), average.overallPercent ?? "", ""]);
    }
    downloadCsv(`gradebook-${data.section.name}-${data.subject.name}.csv`.replace(/\s+/g, "-").toLowerCase(), header, body);
  }

  if (error) {
    return (
      <Card padding="none">
        <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
      </Card>
    );
  }
  if (!data || !average) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <StatGrid>
          {["Students", "Class average", "Assessments", "Below passing"].map((l) => (
            <KpiCard key={l} label={l} value="0" loading />
          ))}
        </StatGrid>
        <Card padding="none" className="p-4">
          <div className="flex flex-col gap-2" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const bandsAsc = [...data.gradeBands].sort((a, b) => a.minPercent - b.minPercent);
  const passing = bandsAsc[1]?.minPercent ?? null;
  const below = passing == null ? 0 : data.rows.filter((r) => r.overallPercent != null && r.overallPercent < passing).length;
  const kindCount = (k: GradebookColumn["kind"]) => columns.filter((c) => c.kind === k).length;
  const assessmentsHint = [
    [kindCount("EXAM"), "exam"],
    [kindCount("ASSIGNMENT"), "assignment"],
    [kindCount("QUIZ"), "quiz"],
  ]
    .filter(([n]) => n)
    .map(([n, w]) => `${n} ${w}${n === 1 ? "" : w === "quiz" ? "zes" : "s"}`)
    .join(", ");
  const anyEditable = columns.some((c) => c.editable);
  const savingCount = Object.values(saving).filter(Boolean).length;
  const title = `${data.subject.name}, ${data.section.name}`;
  const classGradeLetter = letterGrade(average.overallPercent, data.gradeBands);

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <KpiCard label="Students" value={data.rows.length} icon={<Users />} hint={data.section.name} />
        <KpiCard
          label="Class average"
          value={pct(average.overallPercent)}
          icon={<Sigma />}
          tone="info"
          hint={classGradeLetter ? `Grade ${classGradeLetter}` : "No marks yet"}
        />
        <KpiCard label="Assessments" value={columns.length} icon={<ClipboardList />} tone="primary" hint={assessmentsHint || "None yet"} />
        <KpiCard
          label="Below passing"
          value={below}
          icon={<TriangleAlert />}
          tone={below ? "danger" : "success"}
          hint={passing == null ? undefined : `Overall under ${passing}%`}
        />
      </StatGrid>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <p className="flex items-center gap-2 text-[13px] text-fg-muted" aria-live="polite">
              {savingCount ? (
                <Spinner label={`Saving ${savingCount} mark${savingCount === 1 ? "" : "s"}`} />
              ) : anyEditable ? (
                <>
                  <CircleCheck className="size-3.5 text-success" aria-hidden /> Changes save automatically.
                </>
              ) : (
                "View only."
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} placeholder="Find a student" wrapperClassName="w-full sm:w-52" />
            <Button type="button" variant="secondary" size="sm" icon={<Download />} onClick={exportCsv} disabled={!data.rows.length}>
              Export CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface-2 px-4 py-2 text-xs text-fg-secondary sm:px-5">
          {(Object.keys(KIND_META) as (keyof typeof KIND_META)[]).map((k) => (
            <Badge key={k} tone={KIND_META[k].tone}>
              {KIND_META[k].label}
            </Badge>
          ))}
          <span className="text-fg-muted">
            {anyEditable
              ? "Type a mark and press Enter. Arrow keys move between cells, Esc undoes. Type A to mark an exam absent."
              : "Published exams are locked and quizzes are marked automatically."}{" "}
            Overall % counts graded work only; absent counts as zero.
          </span>
        </div>

        {!columns.length ? (
          <EmptyState
            compact
            icon={<BookOpenCheck />}
            title="No assessments yet"
            description={`Exam papers, published assignments and quizzes for ${title} will show up here.`}
            action={
              <Link href="/exams" className={buttonClass("secondary", "sm")}>
                Go to exams
              </Link>
            }
          />
        ) : !data.rows.length ? (
          <EmptyState compact icon={<Users />} title="No students in this section yet" description="Students enrolled in this section will appear here." />
        ) : !rows.length ? (
          <EmptyState
            compact
            title="No students match"
            description={`Nobody in this section matches "${query}".`}
            action={
              <Button variant="secondary" size="sm" type="button" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table ref={gridRef} className="border-separate border-spacing-0 text-sm" aria-label={`Gradebook for ${title}`}>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-30 min-w-36 border-b border-e border-border bg-surface-2 px-3 py-2 sm:min-w-60 sm:px-4 text-left align-bottom text-xs font-medium uppercase tracking-[0.04em] text-fg-muted"
                  >
                    Student
                  </th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="sticky top-0 z-20 min-w-32 max-w-44 border-b border-border bg-surface-2 px-3 py-2 text-left align-bottom font-normal">
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <Badge tone={KIND_META[c.kind].tone} className="px-1.5 py-0 text-[11px]">
                            {KIND_META[c.kind].label}
                          </Badge>
                          {c.kind === "EXAM" && c.examStatus === "PUBLISHED" && (
                            <Tooltip content="Results are published. Unpublish the exam to change marks.">
                              <span tabIndex={0} className="inline-flex rounded text-fg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring" aria-label="Published, read only">
                                <Lock className="size-3.5" aria-hidden />
                              </span>
                            </Tooltip>
                          )}
                        </span>
                        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-fg" title={c.title}>
                          {c.title}
                        </span>
                        <span className="text-[11px] tabular-nums text-fg-muted">
                          Out of {c.maxPoints}
                          {c.date ? `, ${shortDate(c.date)}` : ""}
                        </span>
                      </div>
                    </th>
                  ))}
                  <th scope="col" className="sticky top-0 z-30 w-24 sm:right-20 min-w-24 border-b border-s border-border bg-surface-2 px-3 py-2 text-right align-bottom text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                    Overall
                  </th>
                  <th scope="col" className="sticky top-0 z-30 w-20 sm:right-0 min-w-20 border-b border-border bg-surface-2 px-3 py-2 text-center align-bottom text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                    Grade
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => {
                  const zebra = r % 2 === 1;
                  const stickyBg = zebra ? "bg-surface-2" : "bg-surface";
                  return (
                    <tr key={row.studentId} className="group">
                      <th scope="row" className={cn("sticky left-0 z-10 border-b border-e border-border px-3 py-1.5 sm:px-4 text-left font-normal group-hover:bg-surface-3", stickyBg)}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="hidden w-5 shrink-0 text-right text-xs tabular-nums text-fg-muted sm:inline">{row.rollNo ?? ""}</span>
                          <span className="hidden shrink-0 sm:inline-flex">
                            <Avatar name={row.name} src={row.photoUrl ?? undefined} size="xs" />
                          </span>
                          <div className="min-w-0">
                            <div className="max-w-28 truncate font-medium text-fg sm:max-w-44" title={row.name}>{row.name}</div>
                            <div className="text-[11px] text-fg-muted">{row.admissionNo}</div>
                          </div>
                        </div>
                      </th>
                      {columns.map((col, c) => {
                        const cell = row.cells[col.key];
                        const id = cellId(row.studentId, col.key);
                        const draft = drafts[id];
                        const parsed = draft === undefined ? null : parseEntry(draft, col);
                        const invalid = parsed?.kind === "invalid" ? parsed.reason : null;
                        return (
                          <td key={col.key} className={cn("border-b border-border px-2 py-1 group-hover:bg-surface-3/70", zebra && "bg-surface-2/60")}>
                            {cell?.editable ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  data-cell={`${r}-${c}`}
                                  value={draft ?? cellText(cell)}
                                  placeholder={cell.status === "submitted" ? "Grade" : "-"}
                                  aria-label={`${row.name}, ${col.title}, out of ${col.maxPoints}`}
                                  aria-invalid={invalid ? true : undefined}
                                  aria-busy={saving[id] || undefined}
                                  title={invalid ?? undefined}
                                  onChange={(e) => setDraft(id, e.target.value)}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onBlur={() => commit(row.studentId, col)}
                                  onKeyDown={(e) => onCellKey(e, r, c, row, col)}
                                  className={cn(
                                    "h-8 w-16 rounded-md border bg-surface px-2 text-right text-sm tabular-nums text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-fg-disabled focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                                    invalid ? "border-danger bg-danger-tint text-danger-text" : "border-border hover:border-border-strong",
                                    saving[id] && "ring-2 ring-primary/40",
                                  )}
                                />
                                <CellNote cell={cell} invalid={invalid} />
                              </div>
                            ) : (
                              <ReadOnlyCell cell={cell} />
                            )}
                          </td>
                        );
                      })}
                      <td className={cn("z-10 border-b sm:sticky sm:right-20 border-s border-border px-3 py-1.5 text-right font-medium tabular-nums text-fg group-hover:bg-surface-3", stickyBg)}>
                        {row.overallPercent == null ? <span className="text-xs font-normal text-fg-muted">No marks</span> : pct(row.overallPercent)}
                      </td>
                      <td className={cn("z-10 border-b sm:sticky sm:right-0 border-border px-3 py-1.5 text-center group-hover:bg-surface-3", stickyBg)}>
                        {row.letterGrade ? <LetterGrade grade={row.letterGrade} /> : <span className="text-fg-disabled">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="sticky bottom-0 left-0 z-30 border-e border-t border-border bg-surface-2 px-3 py-2 sm:px-4 text-left text-xs font-medium text-fg-secondary">
                    Class average
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className="sticky bottom-0 z-20 border-t border-border bg-surface-2 px-3 py-2 text-xs tabular-nums text-fg-secondary">
                      {average.byColumn[c.key] == null ? <span className="text-fg-disabled">-</span> : pct(average.byColumn[c.key])}
                    </td>
                  ))}
                  <td className="sticky bottom-0 z-30 sm:right-20 border-s border-t border-border bg-surface-2 px-3 py-2 text-right text-xs font-semibold tabular-nums text-fg">
                    {pct(average.overallPercent)}
                  </td>
                  <td className="sticky bottom-0 z-30 sm:right-0 border-t border-border bg-surface-2 px-3 py-2 text-center">
                    {classGradeLetter ? <LetterGrade grade={classGradeLetter} /> : <span className="text-fg-disabled">-</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

/** Small marker next to an editable cell: the validation error, or what the stored value means. */
function CellNote({ cell, invalid }: { cell: GradebookCell; invalid: string | null }) {
  if (invalid) {
    return (
      <span className="text-danger-text" title={invalid}>
        <TriangleAlert className="size-3.5" aria-hidden />
        <span className="sr-only">{invalid}</span>
      </span>
    );
  }
  if (cell.status === "absent") return <span className="text-[11px] text-fg-muted">Absent</span>;
  if (cell.status === "submitted") return <span className="whitespace-nowrap text-[11px] text-warning-text">To grade</span>;
  return null;
}

function ReadOnlyCell({ cell }: { cell: GradebookCell | undefined }) {
  if (!cell || cell.status === "missing") return <span className="block px-2 text-fg-disabled">-</span>;
  if (cell.status === "absent")
    return (
      <span className="block px-2 text-[13px] text-fg-muted" title="Absent, counts as zero">
        Absent
      </span>
    );
  if (cell.status === "submitted") return <span className="block px-2 text-[13px] text-warning-text">Submitted</span>;
  return (
    <span className="flex items-center gap-1.5 px-2 tabular-nums text-fg">
      {cell.score}
      {cell.status === "review" && (
        <span className="text-[11px] text-warning-text" title="Short answers are waiting to be checked; the score may change">
          Review
        </span>
      )}
    </span>
  );
}
