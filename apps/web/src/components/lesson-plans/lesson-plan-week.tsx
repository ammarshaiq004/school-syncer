"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, FilePen, Hourglass, MessageSquareWarning, NotebookPen, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, KpiCard, SelectField, SkeletonRows, StatGrid, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/format";
import { usePersistedState } from "@/lib/persisted";
import { useApi } from "@/lib/use-api";
import { LessonPlanDrawer, type PlanDraftDefaults } from "./lesson-plan-drawer";
import { addDays, mondayOf, STATUS_META, weekLabel, when, type LessonPlan, type PlanSection } from "./lesson-plan-types";

interface Pair {
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  /** From the user's own sections list, so a new plan can be started here. */
  plannable: boolean;
}

interface DrawerState {
  plan: LessonPlan | null;
  defaults: PlanDraftDefaults;
  n: number;
}

/** Week view: one row per class and subject with that week's plans. */
export function LessonPlanWeek({
  sections,
  canManage,
  canReview,
  isAdmin,
  onChanged,
}: {
  sections: PlanSection[];
  canManage: boolean;
  canReview: boolean;
  isAdmin: boolean;
  /** Called after any plan was saved, submitted, reviewed or deleted. */
  onChanged?: () => void;
}) {
  const thisWeek = mondayOf(todayIso());
  const [week, setWeek] = useState(thisWeek);
  const [pick, setPick] = usePersistedState("schoolsyncer.lesson-plans.pick", { sectionId: "", subjectId: "" });
  const section = sections.find((s) => s.id === pick.sectionId) ?? null;
  const sectionId = section?.id ?? "";
  const subjectId = section?.subjects.some((s) => s.id === pick.subjectId) ? pick.subjectId : "";

  const params = new URLSearchParams({ week });
  if (sectionId) params.set("sectionId", sectionId);
  if (subjectId) params.set("subjectId", subjectId);
  const plans = useApi<LessonPlan[]>(`/lesson-plans?${params}`);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const open = (plan: LessonPlan | null, defaults?: Partial<PlanDraftDefaults>) => {
    setDrawer((d) => ({ plan, defaults: { sectionId, subjectId, weekStart: week, ...defaults }, n: (d?.n ?? 0) + 1 }));
    setDrawerOpen(true);
  };

  const rows = (() => {
    const list = plans.data ?? [];
    const pairs: Pair[] = [];
    const seen = new Set<string>();
    const add = (p: Pair) => {
      const k = `${p.sectionId}|${p.subjectId}`;
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push(p);
    };
    // Teachers see every class and subject they plan for; admins (many sections) only the chosen section or rows with plans.
    const base = sectionId ? sections.filter((s) => s.id === sectionId) : isAdmin ? [] : sections;
    for (const s of base) {
      for (const sub of s.subjects) {
        if (subjectId && sub.id !== subjectId) continue;
        if (!sectionId && !sub.teachesIt && s.subjects.some((x) => x.teachesIt)) continue;
        add({ sectionId: s.id, sectionName: s.name, subjectId: sub.id, subjectName: sub.name, plannable: true });
      }
    }
    for (const p of list) {
      add({
        sectionId: p.sectionId,
        sectionName: p.sectionName,
        subjectId: p.subjectId,
        subjectName: p.subjectName,
        plannable: sections.some((s) => s.id === p.sectionId && s.subjects.some((x) => x.id === p.subjectId)),
      });
    }
    return pairs.map((pair) => ({ pair, plans: list.filter((p) => p.sectionId === pair.sectionId && p.subjectId === pair.subjectId) }));
  })();

  const counts = (() => {
    const c = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, NEEDS_CHANGES: 0 };
    for (const p of plans.data ?? []) c[p.status]++;
    return c;
  })();
  const missing = rows.filter((r) => r.pair.plannable && !r.plans.length).length;

  return (
    <div className="flex flex-col gap-6">
      <Card padding="sm">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Class and section"
            value={sectionId}
            onChange={(e) => setPick({ sectionId: e.target.value, subjectId: "" })}
            placeholder={isAdmin ? "All sections" : "All my classes"}
            options={sections.map((s) => ({ value: s.id, label: s.name }))}
            wrapperClassName="w-full sm:w-56"
          />
          <SelectField
            label="Subject"
            value={subjectId}
            onChange={(e) => setPick({ sectionId, subjectId: e.target.value })}
            placeholder="All subjects"
            disabled={!section}
            options={(section?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))}
            wrapperClassName="w-full sm:w-48"
          />
          <div className="flex items-end gap-1.5">
            <IconButton variant="secondary" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
              <ChevronLeft />
            </IconButton>
            <TextField label="Week" type="date" value={week} onChange={(e) => e.target.value && setWeek(mondayOf(e.target.value))} wrapperClassName="w-44" />
            <IconButton variant="secondary" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
              <ChevronRight />
            </IconButton>
          </div>
          {week !== thisWeek && (
            <Button type="button" variant="ghost" size="sm" className="mb-0.5" onClick={() => setWeek(thisWeek)}>
              This week
            </Button>
          )}
          <span className="flex-1" />
          {canManage && sections.length > 0 && (
            <Button type="button" icon={<Plus />} onClick={() => open(null)}>
              New plan
            </Button>
          )}
        </div>
        {!sections.length && <p className="mt-2 text-[13px] text-fg-muted">You do not teach any section this year, so there is nothing to plan yet.</p>}
      </Card>

      <section aria-label={`Summary for ${weekLabel(week)}`} className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">{weekLabel(week)}</h2>
          <p className="text-[13px] text-fg-muted">
            {week === thisWeek ? "This week. " : ""}
            {missing ? `${missing} class${missing === 1 ? "" : "es"} without a plan yet.` : plans.data?.length ? "Every class shown has a plan." : ""}
          </p>
        </div>
        <StatGrid>
          <KpiCard label="Drafts" value={counts.DRAFT} icon={<FilePen />} tone="neutral" loading={!plans.data && !plans.error} />
          <KpiCard label="Awaiting review" value={counts.SUBMITTED} icon={<Hourglass />} tone="info" loading={!plans.data && !plans.error} />
          <KpiCard label="Needs changes" value={counts.NEEDS_CHANGES} icon={<MessageSquareWarning />} tone="warning" loading={!plans.data && !plans.error} />
          <KpiCard label="Approved" value={counts.APPROVED} icon={<CircleCheck />} tone="success" loading={!plans.data && !plans.error} />
        </StatGrid>
      </section>

      <Card padding="none">
        {plans.error ? (
          <ErrorState message={plans.error} onRetry={plans.reload} />
        ) : !plans.data ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : !rows.length ? (
          <EmptyState
            icon={<CalendarDays />}
            title="No lesson plans this week"
            description={isAdmin && !sectionId ? "Pick a section to see every subject, or check another week." : "Plans you write for this week will show up here."}
            action={
              canManage && sections.length > 0 ? (
                <Button type="button" icon={<Plus />} onClick={() => open(null)}>
                  New plan
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ pair, plans: list }) => (
              <li key={`${pair.sectionId}|${pair.subjectId}`} className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[220px_1fr]">
                <div className="min-w-0">
                  <div className="font-medium text-fg">{pair.subjectName}</div>
                  <div className="text-[13px] text-fg-muted">{pair.sectionName}</div>
                </div>
                <div className="flex flex-col gap-2">
                  {list.map((p) => (
                    <PlanCard key={p.id} plan={p} onOpen={() => open(p)} />
                  ))}
                  {!list.length && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2.5">
                      <span className="text-[13px] text-fg-muted">No plan for this week yet.</span>
                      {canManage && pair.plannable && (
                        <Button type="button" size="sm" variant="secondary" icon={<NotebookPen />} onClick={() => open(null, { sectionId: pair.sectionId, subjectId: pair.subjectId })}>
                          Plan this week
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {drawer && (
        <LessonPlanDrawer
          key={drawer.n}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          plan={drawer.plan}
          defaults={drawer.defaults}
          sections={sections}
          canManage={canManage}
          canReview={canReview}
          onChanged={(saved) => {
            if (saved && saved.weekStart !== week) setWeek(saved.weekStart);
            plans.reload();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function PlanCard({ plan, onOpen }: { plan: LessonPlan; onOpen: () => void }) {
  const meta = STATUS_META[plan.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${plan.topic}, ${meta.label}. ${plan.editable ? "Edit" : "Open"}`}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        plan.status === "NEEDS_CHANGES" && "border-warning/50",
      )}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-fg">{plan.topic}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </span>
      {plan.objectives && <span className="line-clamp-2 text-[13px] text-fg-secondary">{plan.objectives}</span>}
      <span className="text-xs text-fg-muted">
        {plan.mine ? "You" : (plan.teacher?.name ?? "Former staff member")}, updated {when(plan.updatedAt)}
        {plan.status === "NEEDS_CHANGES" && plan.reviewerNote ? `. Note: ${plan.reviewerNote}` : ""}
      </span>
    </button>
  );
}
