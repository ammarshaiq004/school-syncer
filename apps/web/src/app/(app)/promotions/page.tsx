"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, CalendarPlus, Check, ListChecks, Play, Users } from "lucide-react";
import {
  Alert,
  Button,
  buttonClass,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  ProgressBar,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day } from "@/lib/format";
import { DECISION_LABEL, type Decision, type Overview } from "@/lib/promotions";
import { useApi } from "@/lib/use-api";

type SectionRow = Overview["sections"][number];

/** Numbered step card with a done tick. */
function Step({ n, title, done, children, action }: { n: number; title: ReactNode; done?: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full font-display text-sm font-semibold",
            done ? "bg-success-tint text-success-text" : "bg-primary-tint text-brand",
          )}
          aria-hidden
        >
          {done ? <Check className="size-4" strokeWidth={3} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
            <span className="sr-only">Step {n}: </span>
            {title}
            {done && <StatusPill status="completed" label="Done" />}
          </h2>
          <div className="mt-1 text-sm text-fg-secondary">{children}</div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:self-center">{action}</div>}
      </div>
    </Card>
  );
}

/** Year-end in three steps: set up next year, decide class by class, start it. */
export default function PromotionsPage() {
  const overview = useApi<Overview>("/promotions");
  const [carryTimetable, setCarryTimetable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const o = overview.data;

  async function prepare() {
    setBusy(true);
    try {
      const r = await api<{ name: string; sectionsAdded: number; feesCopied: number }>("/promotions/next-year", { method: "POST" });
      toast.success(
        r.sectionsAdded || r.feesCopied ? `${r.name} is set up` : "Nothing to add",
        r.sectionsAdded || r.feesCopied
          ? `${r.sectionsAdded} sections with their teachers, and ${r.feesCopied} fee amounts copied from this year.`
          : `${r.name} already has every section and fee.`,
      );
      setError("");
      await overview.reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function start() {
    if (!o?.next) return;
    setBusy(true);
    try {
      const r = await api<{ year: string } & Record<Decision, number>>("/promotions/start-year", { method: "POST", body: { carryTimetable } });
      toast.success(`${r.year} has started`, `${r.PROMOTE} moved up, ${r.REPEAT} stayed back, ${r.LEAVE} left and ${r.GRADUATE} finished school.`);
      setError("");
      setConfirmStart(false);
      await overview.reload();
    } catch (e) {
      setError((e as Error).message);
      setConfirmStart(false);
    }
    setBusy(false);
  }

  const header = (
    <PageHeader
      title="Year-end promotions"
      description="Move every class up to next year in three steps. Nothing changes for students until the last step."
      breadcrumbs={[{ label: "Academics" }, { label: "Promotions" }]}
    />
  );

  if (!o) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {overview.error ? (
          <ErrorState message={overview.error} onRetry={overview.reload} />
        ) : (
          <>
            <SkeletonCards count={4} />
            <Card><SkeletonRows rows={3} columns={2} /></Card>
            <Card><SkeletonRows rows={6} /></Card>
          </>
        )}
      </div>
    );
  }

  if (!o.current) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card padding="none">
          <EmptyState
            icon={<CalendarPlus />}
            title="Set up the current academic year first"
            description="Promotions move students from the current year into the next one."
            action={<Link href="/classes" className={buttonClass("secondary", "sm")}>Go to classes</Link>}
          />
        </Card>
      </div>
    );
  }

  const students = o.sections.reduce((n, s) => n + s.students, 0);
  const decided = o.sections.reduce((n, s) => n + s.decided, 0);
  const allDecided = students > 0 && decided === students;
  const next = o.next;

  const columns: Column<SectionRow>[] = [
    { id: "name", header: "Class", sortValue: (s) => s.name, cell: (s) => <span className="font-medium text-fg">{s.name}</span> },
    { id: "campus", header: "Campus", sortValue: (s) => s.campus, cell: (s) => s.campus, hideBelow: "md" },
    { id: "students", header: "Students", align: "right", sortValue: (s) => s.students, cell: (s) => s.students },
    {
      id: "reviewed",
      header: "Reviewed",
      sortValue: (s) => (s.students ? s.decided / s.students : 0),
      cell: (s) =>
        s.decided === s.students && s.students > 0 ? (
          <StatusPill status="completed" label="Done" />
        ) : s.decided ? (
          <ProgressBar value={s.decided} max={s.students} valueText={`${s.decided} of ${s.students}`} size="sm" className="min-w-32 max-w-48" />
        ) : (
          <span className="text-fg-muted">Not started</span>
        ),
    },
    {
      id: "decide",
      header: <span className="sr-only">Decide</span>,
      align: "right",
      width: "120px",
      cell: (s) =>
        next ? (
          <Link href={`/promotions/${s.id}`} className={buttonClass("secondary", "sm")} aria-label={`Decide for ${s.name}`}>
            Decide
            <ArrowRight aria-hidden />
          </Link>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled title="Set up next year first">
            Decide
          </Button>
        ),
    },
  ];

  const summary = o.decisions && Object.keys(o.decisions).length > 0
    ? (Object.entries(o.decisions) as [Decision, number][]).map(([d, n]) => `${n} ${DECISION_LABEL[d].toLowerCase()}`).join(", ")
    : "";

  return (
    <div className="flex flex-col gap-6">
      {header}
      {error && <Alert tone="danger" onDismiss={() => setError("")}>{error}</Alert>}

      <StatGrid>
        <KpiCard label="Current year" value={o.current.name} hint={`Ends ${day(o.current.endsOn)}`} icon={<CalendarPlus />} tone="neutral" />
        <KpiCard label="Next year" value={next?.name ?? "Not set up"} hint={next ? `Starts ${day(next.startsOn)}` : "Step 1 below"} icon={<Play />} tone={next ? "primary" : "warning"} />
        <KpiCard label="Students" value={students.toLocaleString("en-PK")} hint={`${o.sections.length} sections`} icon={<Users />} tone="info" />
        <KpiCard
          label="Reviewed"
          value={`${decided} of ${students}`}
          hint={students ? `${Math.round((decided / students) * 100)}% done` : undefined}
          icon={<ListChecks />}
          tone={allDecided ? "success" : "warning"}
        />
      </StatGrid>

      <Step
        n={1}
        title="Set up next year"
        done={!!next}
        action={
          next ? (
            <Button type="button" variant="secondary" onClick={prepare} loading={busy}>Add any missing sections</Button>
          ) : (
            <Button type="button" icon={<CalendarPlus />} onClick={prepare} loading={busy}>Set up next year</Button>
          )
        }
      >
        {next ? (
          <p>
            <b className="font-semibold text-fg">{next.name}</b> starts {day(next.startsOn)} with {next.sections} sections. Class teachers, subject teachers and fee amounts were copied from {o.current.name}; change them on the{" "}
            <Link href="/classes" className="font-medium text-brand hover:underline">Classes</Link> and{" "}
            <Link href="/fees" className="font-medium text-brand hover:underline">Fees</Link> pages.
          </p>
        ) : (
          <p>
            Creates the year after {o.current.name} with the same classes and sections, their class and subject teachers, and this year&apos;s fee amounts. Nothing changes for students yet.
          </p>
        )}
      </Step>

      <section className="flex flex-col gap-4" aria-labelledby="step-2-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full font-display text-sm font-semibold",
              allDecided ? "bg-success-tint text-success-text" : "bg-primary-tint text-brand",
            )}
            aria-hidden
          >
            {allDecided ? <Check className="size-4" strokeWidth={3} /> : 2}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="step-2-title" className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
              <span className="sr-only">Step 2: </span>Decide, class by class
            </h2>
            <p className="mt-1 max-w-[80ch] text-sm text-fg-secondary">
              Everyone moves up to the next class unless you decide otherwise. The top class of a junior campus moves on to the campus that teaches the next class, and the school&apos;s last class finishes school. Annual results are shown so you can keep back anyone who failed.
            </p>
            <p className="mt-2 text-[13px] text-fg-muted tabular-nums">
              {decided} of {students} students reviewed{summary && `: ${summary}`}
            </p>
          </div>
        </div>
        <DataTable
          label="Classes to review"
          columns={columns}
          data={o.sections}
          getRowId={(s) => s.id}
          getSearchText={(s) => `${s.name} ${s.campus}`}
          searchPlaceholder="Search class or campus"
          empty={{ icon: <Users />, title: "No classes this year", description: "Add classes and sections on the Classes page." }}
          pageSize={50}
        />
      </section>

      <Step
        n={3}
        title={`Start ${next?.name ?? "next year"}`}
        action={
          <Button type="button" icon={<Play />} onClick={() => setConfirmStart(true)} disabled={busy || !next}>
            Start {next?.name ?? "next year"}
          </Button>
        }
      >
        <p>
          Moves every student as decided, gives each new class roll numbers in alphabetical order, takes leavers off the rolls and the van, and makes {next?.name ?? "next year"} the current year. Attendance, fees and report cards then work on the new classes.
        </p>
        <Checkbox
          className="mt-3"
          checked={carryTimetable}
          onCheckedChange={setCarryTimetable}
          label="Carry this year's timetable over to the same classes"
        />
        {!allDecided && next && students > 0 && (
          <Alert tone="warning" className="mt-3">
            {students - decided} students have not been reviewed yet. They follow the default: they move up, or finish school from the last class.
          </Alert>
        )}
      </Step>

      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title={`Start ${next?.name ?? "next year"} now?`}
        description={`All ${students} students move as decided and ${next?.name ?? "next year"} becomes the current year. This can't be undone.`}
        confirmLabel={`Start ${next?.name ?? "next year"}`}
        destructive
        loading={busy}
        onConfirm={start}
      />
    </div>
  );
}
