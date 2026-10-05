"use client";

import { CalendarX, ClipboardX, MessageSquareText, PenLine, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, NativeSelect, SkeletonRows } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { AtRiskResponse, DraftTarget, RiskFlag } from "./assistant-types";

const AREA_ICON: Record<RiskFlag["area"], typeof CalendarX> = {
  attendance: CalendarX,
  results: ClipboardX,
  fees: Wallet,
};

/** Students flagged from attendance, results and fees (SCHOOL-107). */
export function RiskPanel({ onDraft, canRemark }: { onDraft: (t: DraftTarget) => void; canRemark: boolean }) {
  const [sectionId, setSectionId] = useState("");
  const risk = useApi<AtRiskResponse>(`/assistant/at-risk${sectionId ? `?sectionId=${sectionId}` : ""}`);
  const data = risk.data;

  const parts = data
    ? [data.areas.attendance && "attendance in the last 30 days", data.areas.results && "the last two published exams", data.areas.fees && "overdue fees"].filter(
        (p): p is string => Boolean(p),
      )
    : [];
  const areas = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect
          aria-label="Section"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          placeholder="All my sections"
          options={(data?.sections ?? []).map((s) => ({ value: s.sectionId, label: s.name }))}
          wrapperClassName="w-56"
        />
        {data && (
          <p className="text-sm text-fg-muted">
            Checked {data.checked} students on {areas}.
          </p>
        )}
      </div>
      {risk.error ? (
        <Card padding="none">
          <ErrorState message={risk.error} onRetry={risk.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : !data.students.length ? (
        <Card>
          <EmptyState icon={<ShieldCheck />} title="Nobody is flagged" description="No student is below the attendance, results or fee thresholds right now." />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.students.map((s) => (
            <li key={s.studentId}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-fg-muted">
                      {s.section} · {s.admissionNo}
                    </p>
                  </div>
                  <Badge tone={s.level === "high" ? "danger" : "warning"}>{s.level === "high" ? "High risk" : "Watch"}</Badge>
                </div>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {s.flags.map((f) => {
                    const Icon = AREA_ICON[f.area];
                    return (
                      <li key={f.area} className="flex items-start gap-2">
                        <Icon className={`mt-0.5 size-4 shrink-0 ${f.level === "high" ? "text-danger" : "text-warning"}`} aria-hidden />
                        <span>{f.reason}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<MessageSquareText />}
                    onClick={() =>
                      onDraft({
                        kind: "parent_message",
                        student: { studentId: s.studentId, name: s.name, admissionNo: s.admissionNo, class: s.section },
                        notes: `Concern: ${s.flags.map((f) => f.reason).join("; ")}`,
                      })
                    }
                  >
                    Draft message to parent
                  </Button>
                  {canRemark && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<PenLine />}
                      onClick={() =>
                        onDraft({ kind: "report_remark", student: { studentId: s.studentId, name: s.name, admissionNo: s.admissionNo, class: s.section } })
                      }
                    >
                      Draft remark
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data?.truncated && <p className="text-sm text-fg-muted">Showing the 200 highest-risk students. Pick a section to see the rest.</p>}
    </div>
  );
}
