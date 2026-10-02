"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorText, Notice, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { DECISION_LABEL, type Decision, type SectionPlan } from "@/lib/promotions";
import { useApi } from "@/lib/use-api";

type Row = { decision: Decision; toSectionId: string | null };
const selectClass = "rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20";

/** One class's students: who moves up, stays back, leaves or finishes school. */
export default function PromotionSectionPage() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const plan = useApi<SectionPlan>(`/promotions/sections/${sectionId}`);
  return plan.data ? <Decisions key={plan.data.students.map((s) => s.decision + s.toSectionId).join()} plan={plan.data} onSaved={plan.reload} /> : <ErrorText>{plan.error}</ErrorText>;
}

function Decisions({ plan, onSaved }: { plan: SectionPlan; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(plan.students.map((s) => [s.id, { decision: s.decision, toSectionId: s.toSectionId }])),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const up = plan.targets.filter((t) => !t.sameClass);
  const same = plan.targets.filter((t) => t.sameClass);
  const defaultUp = plan.students.find((s) => s.decision === "PROMOTE" && s.toSectionId)?.toSectionId ?? up[0]?.id ?? null;

  function set(id: string, decision: Decision) {
    setRows((r) => ({
      ...r,
      [id]: {
        decision,
        toSectionId: decision === "PROMOTE" ? (r[id].decision === "PROMOTE" ? r[id].toSectionId : defaultUp) : decision === "REPEAT" ? plan.repeatSectionId : null,
      },
    }));
  }

  function keepBackFailed() {
    for (const s of plan.students) if (s.result && !s.result.passed) set(s.id, "REPEAT");
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/promotions/sections/${plan.section.id}`, {
        method: "PUT",
        body: { decisions: plan.students.map((s) => ({ studentId: s.id, ...rows[s.id] })) },
      });
      setNotice("Saved. Nothing happens to these students until the new year is started.");
      setError("");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const failed = plan.students.filter((s) => s.result && !s.result.passed).length;
  const counts = Object.values(rows).reduce<Partial<Record<Decision, number>>>((c, r) => ({ ...c, [r.decision]: (c[r.decision] ?? 0) + 1 }), {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/promotions" className="text-sm text-brand">Year-end promotions</Link>
          <h1 className="text-2xl font-semibold">{plan.section.name}</h1>
          <p className="text-sm opacity-70">
            {plan.section.campus} · {plan.students.length} students · {plan.exam ? `results from ${plan.exam.name}` : "no published exam this year"}
          </p>
        </div>
        <div className="flex gap-2">
          {failed > 0 && <Button variant="ghost" onClick={keepBackFailed}>Keep back the {failed} who failed</Button>}
          <Button onClick={save} disabled={busy}>Save decisions</Button>
        </div>
      </div>
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>
      {plan.topClass && (
        <p className="text-sm opacity-70">
          This is the school&apos;s last class, so students finish school here. To keep anyone on, choose &ldquo;Stays back&rdquo;.
        </p>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">Roll</th><th>Student</th><th>Result</th><th>Decision</th><th>Class in {plan.nextYear}</th></tr>
            </thead>
            <tbody>
              {plan.students.map((s) => {
                const r = rows[s.id];
                const options = r.decision === "REPEAT" ? same : r.decision === "PROMOTE" ? up : [];
                return (
                  <tr key={s.id} className={rowClass}>
                    <td className="py-2">{s.rollNo ?? "–"}</td>
                    <td>
                      <Link href={`/students/${s.id}`} className="hover:text-brand">{s.name}</Link>{" "}
                      <span className="text-xs opacity-60">{s.admissionNo}</span>
                    </td>
                    <td>
                      {s.result ? (
                        <Badge tone={s.result.passed ? "green" : "red"}>
                          {Math.round(s.result.percent)}% {s.result.passed ? "" : "failed"}
                        </Badge>
                      ) : (
                        <span className="opacity-40">–</span>
                      )}
                    </td>
                    <td>
                      <select className={selectClass} value={r.decision} onChange={(e) => set(s.id, e.target.value as Decision)} aria-label={`Decision for ${s.name}`}>
                        {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
                          <option key={d} value={d}>{DECISION_LABEL[d]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {options.length ? (
                        <select
                          className={selectClass}
                          value={r.toSectionId ?? ""}
                          onChange={(e) => setRows((all) => ({ ...all, [s.id]: { ...r, toSectionId: e.target.value } }))}
                          aria-label={`Next year's class for ${s.name}`}
                        >
                          {!r.toSectionId && <option value="">Choose</option>}
                          {options.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="opacity-60">{r.decision === "PROMOTE" || r.decision === "REPEAT" ? "No class set up" : "–"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm opacity-70">
          {(Object.entries(counts) as [Decision, number][]).map(([d, n]) => `${n} ${DECISION_LABEL[d].toLowerCase()}`).join(" · ")}
        </p>
      </Card>
    </div>
  );
}
