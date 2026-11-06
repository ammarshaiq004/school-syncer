"use client";

import { useState } from "react";
import { Award, BarChart3, GitCompare, GraduationCap, TrendingDown, TriangleAlert } from "lucide-react";
import {
  Alert,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  NativeSelect,
  PageHeader,
  SkeletonRows,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useSectionOptions } from "@/lib/sections";
import { can, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface ExamSummary { id: string; name: string; status: "DRAFT" | "PUBLISHED"; academicYear: { name: string } }
interface Row {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string;
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  position: number;
}
interface SubjectStat { sectionId: string; section: string; subject: string; students: number; average: number; passRate: number; highest: number; lowest: number; absent: number }
interface TeacherStat { teacherId: string; teacher: string; classes: number; students: number; average: number; passRate: number }
interface MultiRow { studentId: string; name: string; admissionNo: string; percents: (number | null)[]; average: number; change: number; position: number }

type TabId = "toppers" | "failures" | "subjects" | "teachers" | "multi";

const pct = (n: number | null) => (n === null ? <span className="text-fg-muted">-</span> : `${n}%`);

export default function ExamReportsPage() {
  const user = useSession();
  const exams = useApi<ExamSummary[]>("/exams");
  const published = (exams.data ?? []).filter((e) => e.status === "PUBLISHED");
  const [examId, setExamId] = useState("");
  const [tab, setTab] = useState<TabId>("toppers");
  const chosen = examId || published[0]?.id || "";
  const tabs = [
    { value: "toppers", label: "Toppers", icon: <Award /> },
    { value: "failures", label: "Failures", icon: <TrendingDown /> },
    { value: "subjects", label: "Subjects", icon: <BarChart3 /> },
    ...(can(user, "exams", "manage") ? [{ value: "teachers", label: "Teachers", icon: <GraduationCap /> }] : []),
    { value: "multi", label: "Compare exams", icon: <GitCompare /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Exam reports"
        description="Toppers, failures, subject and teacher results, and progress across exams. Published results only."
        breadcrumbs={[{ label: "Exams", href: "/exams" }, { label: "Reports" }]}
      />
      {exams.error ? (
        <ErrorState message={exams.error} onRetry={exams.reload} />
      ) : !exams.data ? (
        <SkeletonRows rows={5} />
      ) : !published.length ? (
        <EmptyState icon={<Award />} title="No published results yet" description="Reports appear once an exam's results are published." />
      ) : (
        <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as TabId)} aria-label="Reports">
          {tab !== "multi" && (
            <NativeSelect
              aria-label="Exam"
              value={chosen}
              onChange={(e) => setExamId(e.target.value)}
              options={published.map((e) => ({ value: e.id, label: `${e.name} (${e.academicYear.name})` }))}
            />
          )}
          <TabPanel value="toppers"><Toppers examId={chosen} /></TabPanel>
          <TabPanel value="failures"><Failures examId={chosen} /></TabPanel>
          <TabPanel value="subjects"><Subjects examId={chosen} /></TabPanel>
          <TabPanel value="teachers"><Teachers examId={chosen} /></TabPanel>
          <TabPanel value="multi"><Multi exams={published} /></TabPanel>
        </Tabs>
      )}
    </div>
  );
}

function Loaded<T>({ state, children }: { state: { data: T | null; error: string; reload: () => Promise<void> }; children: (d: T) => React.ReactNode }) {
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data) return <SkeletonRows rows={5} />;
  return <>{children(state.data)}</>;
}

const nameCell = (r: { name: string; admissionNo: string }) => (
  <span><span className="font-medium text-fg">{r.name}</span> <span className="text-fg-muted">{r.admissionNo}</span></span>
);

function Toppers({ examId }: { examId: string }) {
  const data = useApi<{ sections: { sectionId: string; section: string; students: Row[] }[] }>(`/exam-reports/toppers?examId=${examId}&limit=3`);
  return (
    <Loaded state={data}>
      {(d) => (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {d.sections.map((s) => (
            <Card key={s.sectionId} className="p-4">
              <h3 className="mb-2 font-display font-semibold text-fg">{s.section}</h3>
              <ol className="flex flex-col gap-1.5 text-sm">
                {s.students.map((r) => (
                  <li key={r.studentId} className="flex items-baseline gap-3">
                    <span className="w-6 font-semibold tabular-nums text-brand">{r.position}</span>
                    <span className="min-w-0 flex-1 truncate">{nameCell(r)}</span>
                    <span className="tabular-nums">{r.percent}% ({r.grade})</span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </Loaded>
  );
}

function Failures({ examId }: { examId: string }) {
  const data = useApi<{
    students: number;
    failed: number;
    passRate: number;
    sections: { sectionId: string; section: string; students: number; failed: number; passRate: number }[];
    list: (Row & { failedSubjects: string[] })[];
  }>(`/exam-reports/failures?examId=${examId}`);
  const columns: Column<Row & { failedSubjects: string[] }>[] = [
    { id: "student", header: "Student", sortValue: (r) => r.name, cell: nameCell },
    { id: "section", header: "Section", sortValue: (r) => r.section, cell: (r) => r.section },
    { id: "percent", header: "Percent", align: "right", sortValue: (r) => r.percent, cell: (r) => pct(r.percent) },
    { id: "failed", header: "Failed papers", cell: (r) => r.failedSubjects.join(", ") },
  ];
  return (
    <Loaded state={data}>
      {(d) => (
        <div className="mt-4 flex flex-col gap-4">
          <Alert tone={d.failed ? "warning" : "success"}>
            {d.failed} of {d.students} students did not pass. Overall pass rate {d.passRate}%.
          </Alert>
          <div className="flex flex-wrap gap-2 text-sm">
            {d.sections.map((s) => (
              <span key={s.sectionId} className={cn("rounded-full border border-border px-3 py-1", s.passRate < 60 && "border-warning/40 bg-warning-tint")}>
                {s.section}: {s.passRate}% pass ({s.failed} failed)
              </span>
            ))}
          </div>
          <DataTable label="Failed students" columns={columns} data={d.list} getRowId={(r) => r.studentId} getSearchText={(r) => `${r.name} ${r.admissionNo}`} pageSize={25}
            empty={{ icon: <Award />, title: "Everyone passed" }} />
        </div>
      )}
    </Loaded>
  );
}

function Subjects({ examId }: { examId: string }) {
  const data = useApi<{ stats: SubjectStat[] }>(`/exam-reports/subjects?examId=${examId}`);
  const columns: Column<SubjectStat>[] = [
    { id: "subject", header: "Subject", sortValue: (r) => r.subject, cell: (r) => <span className="font-medium text-fg">{r.subject}</span> },
    { id: "section", header: "Section", sortValue: (r) => r.section, cell: (r) => r.section },
    { id: "average", header: "Average", align: "right", sortValue: (r) => r.average, cell: (r) => pct(r.average) },
    { id: "pass", header: "Pass rate", align: "right", sortValue: (r) => r.passRate, cell: (r) => pct(r.passRate) },
    { id: "high", header: "Highest", align: "right", sortValue: (r) => r.highest, cell: (r) => pct(r.highest), hideBelow: "md" },
    { id: "low", header: "Lowest", align: "right", sortValue: (r) => r.lowest, cell: (r) => pct(r.lowest), hideBelow: "md" },
    { id: "absent", header: "Absent", align: "right", sortValue: (r) => r.absent, cell: (r) => r.absent, hideBelow: "lg" },
  ];
  return (
    <Loaded state={data}>
      {(d) => (
        <div className="mt-4">
          <DataTable label="Subject comparison" columns={columns} data={d.stats} getRowId={(r) => `${r.sectionId}|${r.subject}`}
            getSearchText={(r) => `${r.subject} ${r.section}`} searchPlaceholder="Search subject or section" defaultSort={{ id: "average", dir: "asc" }} pageSize={25} />
        </div>
      )}
    </Loaded>
  );
}

function Teachers({ examId }: { examId: string }) {
  const data = useApi<{ teachers: TeacherStat[] }>(`/exam-reports/teachers?examId=${examId}`);
  const columns: Column<TeacherStat>[] = [
    { id: "teacher", header: "Teacher", sortValue: (r) => r.teacher, cell: (r) => <span className="font-medium text-fg">{r.teacher}</span> },
    { id: "classes", header: "Sections taught", align: "right", sortValue: (r) => r.classes, cell: (r) => r.classes },
    { id: "students", header: "Students", align: "right", sortValue: (r) => r.students, cell: (r) => r.students },
    { id: "average", header: "Average", align: "right", sortValue: (r) => r.average, cell: (r) => pct(r.average) },
    { id: "pass", header: "Pass rate", align: "right", sortValue: (r) => r.passRate, cell: (r) => pct(r.passRate) },
  ];
  return (
    <Loaded state={data}>
      {(d) => (
        <div className="mt-4 flex flex-col gap-3">
          <Alert tone="info">Averages depend on how hard the paper was and who sat it. Use them to start a conversation, not to rank people.</Alert>
          <DataTable label="Teacher performance" columns={columns} data={d.teachers} getRowId={(r) => r.teacherId} defaultSort={{ id: "average", dir: "desc" }} pageSize={25}
            empty={{ icon: <TriangleAlert />, title: "No teachers assigned", description: "Assign teachers to subjects on the Classes page." }} />
        </div>
      )}
    </Loaded>
  );
}

function Multi({ exams }: { exams: ExamSummary[] }) {
  const sections = useSectionOptions({ campusScoped: true });
  const [sectionId, setSectionId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const ids = picked.join(",");
  const data = useApi<{ exams: { id: string; name: string }[]; students: MultiRow[] }>(
    sectionId && picked.length >= 2 ? `/exam-reports/multi?examIds=${ids}&sectionId=${sectionId}` : null,
  );
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const columns: Column<MultiRow>[] = [
    { id: "position", header: "Pos", width: "56px", sortValue: (r) => r.position, cell: (r) => r.position },
    { id: "student", header: "Student", sortValue: (r) => r.name, cell: nameCell },
    ...(data.data?.exams ?? []).map((e, i) => ({
      id: `exam${i}`, header: e.name, align: "right" as const, sortValue: (r: MultiRow) => r.percents[i] ?? -1, cell: (r: MultiRow) => pct(r.percents[i]),
    })),
    { id: "average", header: "Combined", align: "right", sortValue: (r) => r.average, cell: (r) => <span className="font-semibold">{r.average}%</span> },
    {
      id: "change", header: "Change", align: "right", sortValue: (r) => r.change,
      cell: (r) => <span className={r.change < 0 ? "text-danger-text" : r.change > 0 ? "text-success-text" : "text-fg-muted"}>{r.change > 0 ? "+" : ""}{r.change}</span>,
    },
  ];
  return (
    <div className="mt-4 flex flex-col gap-4">
      <NativeSelect aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Choose a section" options={sections.options} />
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Pick two to six exams, in the order they were sat</legend>
        {exams.map((e) => (
          <label key={e.id} className="flex items-center gap-2">
            <input type="checkbox" checked={picked.includes(e.id)} disabled={!picked.includes(e.id) && picked.length >= 6} onChange={() => toggle(e.id)} />
            {e.name}
          </label>
        ))}
      </fieldset>
      {!sectionId || picked.length < 2 ? (
        <EmptyState icon={<GitCompare />} title="Choose a section and at least two exams" compact />
      ) : (
        <Loaded state={data}>
          {(d) => <DataTable label="Results across exams" columns={columns} data={d.students} getRowId={(r) => r.studentId} getSearchText={(r) => `${r.name} ${r.admissionNo}`} pageSize={50} />}
        </Loaded>
      )}
    </div>
  );
}
