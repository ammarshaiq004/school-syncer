"use client";

import Link from "next/link";
import { useState } from "react";
import { Award, BookOpen, ClipboardCheck, FileText, ListChecks, NotebookPen, Trophy } from "lucide-react";
import { ASSIGNMENT_STATE } from "@/components/student/format";
import type { ExamResultItem, ScoredAssignment, ScoredQuiz, StudentResults } from "@/components/student/types";
import {
  Badge,
  BarChart,
  buttonClass,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  LetterGrade,
  PageHeader,
  ProgressBar,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/ui";
import { day } from "@/lib/format";
import { useSchoolMode, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

const assignmentColumns: Column<ScoredAssignment>[] = [
  {
    id: "title",
    header: "Assignment",
    sortValue: (a) => a.title,
    cell: (a) => (
      <div className="min-w-0">
        <Link href={`/student/assignments/${a.id}`} className="font-medium text-fg hover:text-brand">
          {a.title}
        </Link>
        <div className="text-xs text-fg-muted">{a.subject}</div>
      </div>
    ),
  },
  { id: "due", header: "Due", hideBelow: "md", sortValue: (a) => a.dueAt, cell: (a) => day(a.dueAt) },
  {
    id: "score",
    header: "Score",
    align: "right",
    sortValue: (a) => (a.points ?? -1) / a.maxPoints,
    cell: (a) =>
      a.points == null ? (
        <span className="text-fg-muted">Not marked</span>
      ) : (
        <span>
          <span className="font-semibold text-fg">{a.points}</span>
          <span className="text-fg-muted"> / {a.maxPoints}</span>
        </span>
      ),
  },
  {
    id: "status",
    header: "Status",
    cell: (a) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={a.status} label={ASSIGNMENT_STATE[a.status].label} tone={ASSIGNMENT_STATE[a.status].tone} />
        {a.isLate && <Badge tone="warning">Late</Badge>}
      </span>
    ),
  },
  {
    id: "feedback",
    header: "Teacher feedback",
    hideBelow: "lg",
    cell: (a) => (a.feedback ? <span className="line-clamp-2 text-fg-secondary">{a.feedback}</span> : <span className="text-fg-muted">None</span>),
  },
];

const quizScore = (s: { score: number | null; maxScore: number; percent: number | null } | null) =>
  s && s.score != null ? (
    <span>
      <span className="font-semibold text-fg">{Math.round(s.score * 10) / 10}</span>
      <span className="text-fg-muted"> / {s.maxScore}</span>
      {s.percent != null && <span className="ms-1.5 text-xs text-fg-muted">({pct(s.percent)})</span>}
    </span>
  ) : (
    <span className="text-fg-muted">Hidden</span>
  );

const quizColumns: Column<ScoredQuiz>[] = [
  {
    id: "title",
    header: "Quiz",
    sortValue: (q) => q.title,
    cell: (q) => (
      <div className="min-w-0">
        <Link href={`/student/quizzes/${q.id}`} className="font-medium text-fg hover:text-brand">
          {q.title}
        </Link>
        <div className="text-xs text-fg-muted">{q.subject}</div>
      </div>
    ),
  },
  { id: "attempts", header: "Attempts", align: "right", hideBelow: "sm", sortValue: (q) => q.submitted, cell: (q) => `${q.submitted} of ${q.attemptsAllowed}` },
  { id: "best", header: "Best score", align: "right", sortValue: (q) => q.best?.percent ?? -1, cell: (q) => (q.resultsHidden ? <span className="text-fg-muted">Hidden by teacher</span> : quizScore(q.best)) },
  { id: "latest", header: "Latest", align: "right", hideBelow: "md", cell: (q) => (q.resultsHidden ? "–" : quizScore(q.latest)) },
  {
    id: "status",
    header: "Status",
    cell: (q) =>
      q.latest?.needsReview ? (
        <StatusPill status="REVIEW" label="Teacher checking" />
      ) : q.isOpen && q.submitted < q.attemptsAllowed ? (
        <StatusPill status="OPEN" label="Can retry" tone="info" />
      ) : (
        <StatusPill status="COMPLETED" label="Done" />
      ),
  },
];

export default function StudentGradesPage() {
  const user = useSession();
  const mode = useSchoolMode();
  const results = useApi<StudentResults>("/student/results");
  const [tab, setTab] = useState("exams");
  const r = results.data;
  const features = user.plan?.features;
  const eschool = mode !== "PHYSICAL" && (!features || features.includes("elearning"));

  const latest = r?.exams[0];
  const marked = r?.assignments.filter((a) => a.points != null) ?? [];
  const assignmentAvg = marked.length
    ? (marked.reduce((n, a) => n + (a.points ?? 0), 0) / marked.reduce((n, a) => n + a.maxPoints, 0)) * 100
    : null;
  const quizBest = r?.quizzes.filter((q) => q.best?.percent != null) ?? [];
  const quizAvg = quizBest.length ? quizBest.reduce((n, q) => n + (q.best!.percent ?? 0), 0) / quizBest.length : null;

  const tabs = [
    { value: "exams", label: "Exams", icon: <ClipboardCheck />, count: r?.exams.length },
    ...(eschool || (r && r.assignments.length > 0) ? [{ value: "assignments", label: "Assignments", icon: <NotebookPen />, count: r?.assignments.length }] : []),
    ...(eschool || (r && r.quizzes.length > 0) ? [{ value: "quizzes", label: "Quizzes", icon: <ListChecks />, count: r?.quizzes.length }] : []),
    ...(eschool ? [{ value: "courses", label: "Course progress", icon: <BookOpen /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Grades and transcripts"
        description="Your published exam results with report cards, plus marks for assignments and quizzes."
        breadcrumbs={[{ label: "Learning" }, { label: "Grades and transcripts" }]}
      />

      {results.error && !r ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : (
        <>
          <StatGrid>
            <KpiCard
              label="Latest exam"
              icon={<Trophy />}
              loading={!r}
              value={latest ? pct(latest.percent) : "None yet"}
              hint={latest ? `${latest.exam}, grade ${latest.grade}` : "Results appear once published"}
            />
            <KpiCard
              label="Class position"
              icon={<Award />}
              tone="info"
              loading={!r}
              value={latest?.position ? `#${latest.position}` : "–"}
              hint={latest ? latest.exam : undefined}
            />
            <KpiCard
              label="Assignment average"
              icon={<NotebookPen />}
              tone="success"
              loading={!r}
              value={assignmentAvg == null ? "–" : pct(assignmentAvg)}
              hint={`${marked.length} marked`}
            />
            <KpiCard
              label="Quiz average"
              icon={<ListChecks />}
              tone="warning"
              loading={!r}
              value={quizAvg == null ? "–" : pct(quizAvg)}
              hint={`Best attempt of ${quizBest.length} quizzes`}
            />
          </StatGrid>

          <Tabs tabs={tabs} value={tab} onValueChange={setTab} aria-label="Grade sections">
            <TabPanel value="exams">
              {!r ? (
                <Card>
                  <SkeletonRows rows={5} />
                </Card>
              ) : r.exams.length === 0 ? (
                <Card padding="none">
                  <EmptyState icon={<ClipboardCheck />} title="No exam results yet" description="Your results and report cards appear here once the school publishes them." />
                </Card>
              ) : (
                <div className="flex flex-col gap-6">
                  {r.exams.length >= 2 && (
                    <Card>
                      <h2 className="mb-3 text-base font-semibold text-fg">Exam percentages over time</h2>
                      <BarChart
                        label="Exam percentage per exam, oldest first"
                        categories={[...r.exams].reverse().map((e) => e.exam)}
                        series={[{ name: "Percentage", values: [...r.exams].reverse().map((e) => Math.round(e.percent)) }]}
                        yMax={100}
                        height={200}
                        formatValue={(n) => `${n}%`}
                        showLegend={false}
                      />
                    </Card>
                  )}
                  {r.exams.map((e) => (
                    <ExamCard key={e.examId} exam={e} />
                  ))}
                </div>
              )}
            </TabPanel>

            <TabPanel value="assignments">
              <DataTable
                label="Assignment marks"
                columns={assignmentColumns}
                data={r?.assignments ?? null}
                getRowId={(a) => a.id}
                getSearchText={(a) => `${a.title} ${a.subject}`}
                searchPlaceholder="Search assignments"
                defaultSort={{ id: "due", dir: "desc" }}
                empty={{ title: "No marked assignments yet", description: "Once a teacher marks your work, the score and feedback show here." }}
              />
            </TabPanel>

            <TabPanel value="quizzes">
              <DataTable
                label="Quiz scores"
                columns={quizColumns}
                data={r?.quizzes ?? null}
                getRowId={(q) => q.id}
                getSearchText={(q) => `${q.title} ${q.subject}`}
                searchPlaceholder="Search quizzes"
                empty={{ title: "No quizzes taken yet", description: "Scores from quizzes you hand in show here." }}
              />
            </TabPanel>

            {eschool && (
              <TabPanel value="courses">
                <Card>
                  {!r ? (
                    <SkeletonRows rows={4} columns={2} />
                  ) : r.courses.length === 0 ? (
                    <EmptyState icon={<BookOpen />} title="No courses yet" description="Courses your teachers publish show here with your progress." compact />
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {r.courses.map((c) => (
                        <li key={c.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-6">
                          <div className="min-w-0 sm:w-64">
                            <Link href={`/student/courses/${c.id}`} className="block truncate text-sm font-medium text-fg hover:text-brand">
                              {c.title}
                            </Link>
                            <span className="text-xs text-fg-muted">{[c.subject, c.teacher].filter(Boolean).join(", ")}</span>
                          </div>
                          <ProgressBar
                            className="flex-1"
                            value={c.percent}
                            label={`${c.title} progress`}
                            valueText={`${c.completed} of ${c.lessons} lessons`}
                            showValue
                            tone={c.percent >= 100 ? "success" : "primary"}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </TabPanel>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}

const subjectColumns: Column<ExamResultItem["subjects"][number]>[] = [
  { id: "subject", header: "Subject", cell: (s) => <span className="font-medium text-fg">{s.subject}</span> },
  {
    id: "marks",
    header: "Marks",
    align: "right",
    cell: (s) =>
      s.absent ? (
        <span className="text-fg-muted">Absent</span>
      ) : (
        <span>
          <span className="font-semibold text-fg">{s.marks ?? "–"}</span>
          <span className="text-fg-muted"> / {s.max}</span>
        </span>
      ),
  },
  { id: "pass", header: "Pass mark", align: "right", hideBelow: "sm", cell: (s) => s.pass },
  { id: "result", header: "Result", cell: (s) => <StatusPill status={s.passed ? "PASSED" : "FAILED"} /> },
];

function ExamCard({ exam: e }: { exam: ExamResultItem }) {
  return (
    <Card padding="none">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{e.exam}</h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Academic year {e.academicYear}
            {e.publishedAt && <>. Published {day(e.publishedAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right">
            <div className="font-display text-xl font-semibold tabular-nums text-fg">{pct(e.percent)}</div>
            <div className="text-xs tabular-nums text-fg-muted">
              {e.obtained} / {e.maxTotal}
              {e.position ? `, position ${e.position}` : ""}
            </div>
          </div>
          <LetterGrade grade={e.grade} />
          <StatusPill status={e.passed ? "PASSED" : "FAILED"} />
          <Link href={`/student/grades/${e.examId}`} className={buttonClass("secondary", "sm")} aria-label={`Report card for ${e.exam}`}>
            <FileText className="size-4" aria-hidden />
            Report card
          </Link>
        </div>
      </div>
      <div className="border-t border-border">
        <DataTable bare dense label={`${e.exam} subject marks`} columns={subjectColumns} data={e.subjects} getRowId={(s) => s.subject} pageSize={0} />
      </div>
    </Card>
  );
}
