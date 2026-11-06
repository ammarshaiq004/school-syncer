"use client";

import { useState } from "react";
import { BookOpen, CalendarRange, Pencil, Printer } from "lucide-react";
import {
  Alert,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  NativeSelect,
  SkeletonRows,
  TextArea,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";

export interface SheetPaper {
  id: string;
  classId: string;
  className: string;
  subject: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  syllabus: string | null;
  maxMarks: number;
}
interface School { name: string; logoUrl: string | null }
interface Datesheet {
  school: School;
  exam: { id: string; name: string; academicYear: string };
  papers: SheetPaper[];
  clashes: string[];
}
interface Slips {
  school: School;
  exam: { id: string; name: string; academicYear: string };
  section: string;
  papers: SheetPaper[];
  students: { studentId: string; name: string; admissionNo: string; rollNo: number | null }[];
}
interface ExamLike { id: string; papers: { classId: string; class: { name: string } }[] }

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
export const timeRange = (p: Pick<SheetPaper, "startTime" | "endTime">) =>
  p.startTime ? (p.endTime ? `${p.startTime} to ${p.endTime}` : p.startTime) : "";

function classOptions(exam: ExamLike) {
  const seen = new Map(exam.papers.map((p) => [p.classId, p.class.name]));
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** The paper-white table shared by the datesheet and the roll number slips. */
function PaperTable({ papers }: { papers: SheetPaper[] }) {
  const cell = "border border-slate-300 px-2 py-1.5 text-left print:border-slate-500";
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="bg-slate-100 print:bg-slate-100">
          {["Date", "Day", "Subject", "Time", "Room"].map((h) => (
            <th key={h} className={`${cell} font-semibold`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {papers.map((p) => (
          <tr key={p.id}>
            <td className={`${cell} whitespace-nowrap`}>{p.date ? day(p.date) : "To be announced"}</td>
            <td className={cell}>{p.date ? weekday(p.date) : ""}</td>
            <td className={`${cell} font-medium`}>{p.subject}</td>
            <td className={`${cell} whitespace-nowrap`}>{timeRange(p)}</td>
            <td className={cell}>{p.room ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const sheet = "mx-auto w-full rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-900 shadow-card [print-color-adjust:exact] print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none";

function Heading({ school, title, subtitle }: { school: School; title: string; subtitle: string }) {
  return (
    <header className="mb-4 text-center">
      <p className="font-display text-lg font-semibold">{school.name}</p>
      <p className="font-semibold">{title}</p>
      <p className="text-xs text-slate-600">{subtitle}</p>
    </header>
  );
}

function PrintBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      {children}
      <Button type="button" variant="secondary" icon={<Printer />} onClick={() => window.print()} className="ms-auto">
        Print
      </Button>
    </div>
  );
}

export function DatesheetTab({ exam }: { exam: ExamLike }) {
  const classes = classOptions(exam);
  const [classId, setClassId] = useState("");
  const chosen = classId || classes[0]?.value || "";
  const data = useApi<Datesheet>(chosen ? `/exams/${exam.id}/datesheet?classId=${chosen}` : null);

  if (!classes.length) {
    return <EmptyState icon={<CalendarRange />} title="No papers yet" description="Add papers on the Papers tab, with dates and times, to build the datesheet." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <PrintBar>
        <NativeSelect aria-label="Class" value={chosen} onChange={(e) => setClassId(e.target.value)} options={classes} />
      </PrintBar>
      {data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <SkeletonRows rows={5} columns={5} />
      ) : (
        <>
          {!!data.data.clashes.length && (
            <Alert tone="warning" className="print:hidden">
              <p className="font-medium">Fix these clashes on the Papers tab before printing:</p>
              <ul className="list-disc ps-5">
                {data.data.clashes.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </Alert>
          )}
          <section className={`${sheet} max-w-3xl`}>
            <Heading
              school={data.data.school}
              title={`${data.data.exam.name} datesheet`}
              subtitle={`${classes.find((c) => c.value === chosen)?.label}, ${data.data.exam.academicYear}`}
            />
            <PaperTable papers={data.data.papers} />
            {data.data.papers.some((p) => p.syllabus) && (
              <div className="mt-5">
                <p className="mb-2 font-semibold">Syllabus</p>
                <dl className="grid gap-2 text-xs">
                  {data.data.papers.filter((p) => p.syllabus).map((p) => (
                    <div key={p.id} className="break-inside-avoid">
                      <dt className="font-medium">{p.subject}</dt>
                      <dd className="whitespace-pre-line text-slate-700">{p.syllabus}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function SlipsTab({ exam }: { exam: ExamLike }) {
  const sections = useSectionOptions({ campusScoped: true });
  const examClasses = new Set(exam.papers.map((p) => p.classId));
  const options = sections.options.filter((o) => examClasses.has(o.classId));
  const [sectionId, setSectionId] = useState("");
  const slips = useApi<Slips>(sectionId ? `/exams/${exam.id}/slips?sectionId=${sectionId}` : null);

  return (
    <div className="flex flex-col gap-4">
      <PrintBar>
        <NativeSelect aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Choose a section" options={options} />
      </PrintBar>
      {!sectionId ? (
        <EmptyState icon={<Printer />} title="Choose a section" description="Roll number slips are printed for one section at a time, two to a row." compact />
      ) : slips.error ? (
        <ErrorState message={slips.error} onRetry={slips.reload} />
      ) : !slips.data ? (
        <SkeletonRows rows={4} columns={3} />
      ) : !slips.data.students.length ? (
        <EmptyState icon={<BookOpen />} title="No students in this section" compact />
      ) : (
        <>
          {slips.data.papers.some((p) => !p.date) && (
            <Alert tone="warning" className="print:hidden">Some papers have no date yet; their slips will say “To be announced”.</Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-2 print:gap-3">
            {slips.data.students.map((s) => (
              <section key={s.studentId} className={`${sheet} break-inside-avoid !p-4 print:!border print:!border-slate-500 print:!p-3`}>
                <Heading school={slips.data!.school} title={`${slips.data!.exam.name} roll number slip`} subtitle={slips.data!.exam.academicYear} />
                <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="col-span-2"><dt className="inline text-slate-600">Name: </dt><dd className="inline font-semibold">{s.name}</dd></div>
                  <div><dt className="inline text-slate-600">Roll no: </dt><dd className="inline font-semibold">{s.rollNo ?? "-"}</dd></div>
                  <div><dt className="inline text-slate-600">Admission no: </dt><dd className="inline font-semibold">{s.admissionNo}</dd></div>
                  <div className="col-span-2"><dt className="inline text-slate-600">Class: </dt><dd className="inline font-semibold">{slips.data!.section}</dd></div>
                </dl>
                <PaperTable papers={slips.data!.papers} />
                <p className="mt-6 flex justify-between text-xs text-slate-600"><span>Class teacher</span><span>Principal</span></p>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function SyllabusTab({ exam, canManage }: { exam: ExamLike; canManage: boolean }) {
  const classes = classOptions(exam);
  const [classId, setClassId] = useState("");
  const chosen = classId || classes[0]?.value || "";
  const data = useApi<Datesheet>(chosen ? `/exams/${exam.id}/datesheet?classId=${chosen}` : null);
  const [editing, setEditing] = useState<SheetPaper | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/exams/${exam.id}/papers/${editing.id}/syllabus`, { method: "PUT", body: { syllabus: text } });
      toast.success("Syllabus saved", `${editing.subject} for ${editing.className}.`);
      setEditing(null);
      await data.reload();
    } catch (e) {
      toast.error("Could not save syllabus", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!classes.length) {
    return <EmptyState icon={<BookOpen />} title="No papers yet" description="Add papers first, then write what each one covers." />;
  }
  const columns: Column<SheetPaper>[] = [
    { id: "subject", header: "Subject", sortValue: (p) => p.subject, cell: (p) => <span className="font-medium text-fg">{p.subject}</span> },
    {
      id: "syllabus",
      header: "Covers",
      cell: (p) => (p.syllabus ? <span className="line-clamp-3 whitespace-pre-line">{p.syllabus}</span> : <span className="text-fg-muted">Not set</span>),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "56px",
      align: "right",
      cell: (p) =>
        canManage && (
          <IconButton size="sm" aria-label={`Edit syllabus for ${p.subject}`} onClick={() => { setEditing(p); setText(p.syllabus ?? ""); }}>
            <Pencil />
          </IconButton>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <NativeSelect aria-label="Class" value={chosen} onChange={(e) => setClassId(e.target.value)} options={classes} />
      {data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <SkeletonRows rows={5} columns={3} />
      ) : (
        <DataTable label="Syllabus" columns={columns} data={data.data.papers} getRowId={(p) => p.id} pageSize={50} />
      )}
      <Drawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `${editing.subject} syllabus` : "Syllabus"}
        description={editing ? `${editing.className}. One topic per line; it prints under the datesheet.` : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="button" loading={saving} onClick={save}>Save</Button>
          </>
        }
      >
        <TextArea label="Topics covered" rows={10} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
      </Drawer>
    </div>
  );
}
