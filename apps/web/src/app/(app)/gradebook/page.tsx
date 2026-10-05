"use client";

import { Table2 } from "lucide-react";
import { GradebookGrid } from "@/components/gradebook/gradebook-grid";
import type { GradebookSection } from "@/components/gradebook/gradebook-rules";
import { Card, EmptyState, ErrorState, PageHeader, SelectField, Skeleton } from "@/components/ui";
import { usePersistedState } from "@/lib/persisted";
import { useApi } from "@/lib/use-api";

interface Pick {
  sectionId: string;
  subjectId: string;
}

export default function GradebookPage() {
  const sections = useApi<GradebookSection[]>("/gradebook/sections");
  const [saved, setPick] = usePersistedState<Pick>("schoolsyncer.gradebook.pick", { sectionId: "", subjectId: "" });

  // Only keep a remembered pick that is still one of this user's sections and subjects.
  const list = sections.data ?? [];
  const section = list.find((s) => s.id === saved.sectionId) ?? null;
  const subject = section?.subjects.find((s) => s.id === saved.subjectId) ?? null;
  const sectionId = section?.id ?? "";
  const subjectId = subject?.id ?? "";

  function chooseSection(id: string) {
    const next = list.find((s) => s.id === id);
    // Default to a subject the user teaches there, else the first one.
    const first = next?.subjects.find((s) => s.teachesIt) ?? next?.subjects[0];
    setPick({ sectionId: id, subjectId: first?.id ?? "" });
  }

  const sectionOptions = list.map((s) => ({ value: s.id, label: s.name }));
  const subjectOptions = (section?.subjects ?? []).map((s) => ({ value: s.id, label: s.teachesIt || !section?.isClassTeacher ? s.name : `${s.name} (as class teacher)` }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gradebook"
        description="Every exam, assignment and quiz for a class in one sheet, with overall percentage and letter grade."
        breadcrumbs={[{ label: "Academics" }, { label: "Gradebook" }]}
      />

      <Card padding="sm">
        {sections.error ? (
          <ErrorState message={sections.error} onRetry={sections.reload} compact />
        ) : !sections.data ? (
          <div className="flex flex-wrap gap-3" aria-hidden>
            <Skeleton className="h-[60px] w-full sm:w-64" />
            <Skeleton className="h-[60px] w-full sm:w-56" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <SelectField
                label="Class and section"
                value={sectionId}
                onChange={(e) => chooseSection(e.target.value)}
                placeholder="Choose a section"
                options={sectionOptions}
                wrapperClassName="w-full sm:w-64"
              />
              <SelectField
                label="Subject"
                value={subjectId}
                onChange={(e) => setPick({ sectionId, subjectId: e.target.value })}
                placeholder={section ? "Choose a subject" : "Pick a section first"}
                options={subjectOptions}
                disabled={!section}
                wrapperClassName="w-full sm:w-64"
              />
            </div>
            {!list.length && <p className="mt-2 text-[13px] text-fg-muted">You do not teach or class-teach any section this year.</p>}
            {section && !section.subjects.length && <p className="mt-2 text-[13px] text-fg-muted">No subjects are assigned to {section.name} yet.</p>}
          </>
        )}
      </Card>

      {sectionId && subjectId ? (
        <GradebookGrid key={`${sectionId}|${subjectId}`} sectionId={sectionId} subjectId={subjectId} />
      ) : (
        sections.data && (
          <Card padding="none">
            <EmptyState
              icon={<Table2 />}
              title="Choose a class and subject"
              description="Pick a section and subject above to open its gradebook. Marks you type save automatically."
            />
          </Card>
        )
      )}
    </div>
  );
}
