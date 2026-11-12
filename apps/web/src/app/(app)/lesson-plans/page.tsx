"use client";

import { CalendarDays, ClipboardCheck, ListChecks } from "lucide-react";
import { LessonPlanReview } from "@/components/lesson-plans/lesson-plan-review";
import type { PlanSection, ReviewQueue } from "@/components/lesson-plans/lesson-plan-types";
import { SyllabusPanel } from "@/components/lesson-plans/syllabus-panel";
import { LessonPlanWeek } from "@/components/lesson-plans/lesson-plan-week";
import { Card, ErrorState, PageHeader, SkeletonRows, TabPanel, Tabs } from "@/components/ui";
import { usePersistedState } from "@/lib/persisted";
import { can, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "week" | "review" | "syllabus";

export default function LessonPlansPage() {
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const canManage = can(user, "lesson_plans", "manage") && user.plan?.access !== "read_only";
  const sections = useApi<PlanSection[]>("/lesson-plans/sections");
  const queue = useApi<ReviewQueue>(isAdmin ? "/lesson-plans/review-queue" : null);
  const [saved, setTab] = usePersistedState<Tab>("schoolsyncer.lesson-plans.tab", "week");
  const tab: Tab = isAdmin || saved !== "review" ? saved : "week";

  const week = sections.error ? (
    <Card padding="none">
      <ErrorState message={sections.error} onRetry={sections.reload} />
    </Card>
  ) : !sections.data ? (
    <Card>
      <SkeletonRows rows={5} />
    </Card>
  ) : (
    <LessonPlanWeek sections={sections.data} canManage={canManage} canReview={isAdmin && canManage} isAdmin={isAdmin} onChanged={isAdmin ? queue.reload : undefined} />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lesson plans"
        description={isAdmin ? "Weekly plans for every class, the plans waiting for your review, and syllabus progress." : "Plan each week per class and subject, then send it for review. Tick off syllabus topics as you cover them."}
        breadcrumbs={[{ label: "Academics" }, { label: "Lesson plans" }]}
      />
      <Tabs
        aria-label="Lesson plan views"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "week", label: "Week view", icon: <CalendarDays /> },
          ...(isAdmin ? [{ value: "review", label: "Review queue", icon: <ClipboardCheck />, count: queue.data?.counts.SUBMITTED }] : []),
          { value: "syllabus", label: "Syllabus", icon: <ListChecks /> },
        ]}
      >
        <TabPanel value="week">{week}</TabPanel>
        {isAdmin && (
          <TabPanel value="review">
            <LessonPlanReview queue={queue} sections={sections.data ?? []} canManage={canManage} />
          </TabPanel>
        )}
        <TabPanel value="syllabus">
          <SyllabusPanel canManage={canManage} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
