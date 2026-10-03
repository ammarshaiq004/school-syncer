"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { DECISION_LABEL, type Decision, type Overview } from "@/lib/promotions";
import { useApi } from "@/lib/use-api";

/** Year-end in three steps: set up next year, decide class by class, start it. */
export default function PromotionsPage() {
  const overview = useApi<Overview>("/promotions");
  const [carryTimetable, setCarryTimetable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const o = overview.data;

  async function prepare() {
    setBusy(true);
    try {
      const r = await api<{ name: string; sectionsAdded: number; feesCopied: number }>("/promotions/next-year", { method: "POST" });
      setNotice(
        r.sectionsAdded || r.feesCopied
          ? `${r.name} is set up: ${r.sectionsAdded} sections with their teachers, and ${r.feesCopied} fee amounts copied from this year.`
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
    const students = o.sections.reduce((n, s) => n + s.students, 0);
    if (!window.confirm(`Start ${o.next.name} now? All ${students} students move as decided and ${o.next.name} becomes the current year. This can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await api<{ year: string } & Record<Decision, number>>("/promotions/start-year", { method: "POST", body: { carryTimetable } });
      setNotice(`${r.year} has started. ${r.PROMOTE} moved up, ${r.REPEAT} stayed back, ${r.LEAVE} left and ${r.GRADUATE} finished school.`);
      setError("");
      await overview.reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!o) return <ErrorText>{overview.error}</ErrorText>;
  if (!o.current) return <p className="text-sm opacity-70">Set up the current academic year first.</p>;
  const students = o.sections.reduce((n, s) => n + s.students, 0);
  const decided = o.sections.reduce((n, s) => n + s.decided, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Year-end promotions</PageTitle>
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>

      <Card>
        <h2 className="mb-1 font-semibold">1. Set up next year</h2>
        {o.next ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              <b>{o.next.name}</b> starts {day(o.next.startsOn)} with {o.next.sections} sections. Class teachers, subject teachers and fee amounts were copied from {o.current.name}; change them on the Classes and Fees pages.
            </p>
            <Button variant="ghost" onClick={prepare} disabled={busy}>Add any missing sections</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="opacity-80">
              Creates the year after {o.current.name} with the same classes and sections, their class and subject teachers, and this year&apos;s fee amounts. Nothing changes for students yet.
            </p>
            <Button onClick={prepare} disabled={busy}>Set up next year</Button>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">2. Decide, class by class</h2>
          <span className="text-sm opacity-70">
            {decided} of {students} students reviewed
            {o.decisions && Object.keys(o.decisions).length > 0 && (
              <> · {(Object.entries(o.decisions) as [Decision, number][]).map(([d, n]) => `${n} ${DECISION_LABEL[d].toLowerCase()}`).join(", ")}</>
            )}
          </span>
        </div>
        <p className="mb-3 text-sm opacity-70">
          Everyone moves up to the next class unless you decide otherwise. The top class of a junior campus moves on to the campus that teaches the next class, and the school&apos;s last class finishes school. Annual results are shown so you can keep back anyone who failed.
        </p>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60"><tr><th className="py-2">Class</th><th>Campus</th><th>Students</th><th>Reviewed</th><th /></tr></thead>
            <tbody>
              {o.sections.map((s) => (
                <tr key={s.id} className={rowClass}>
                  <td className="py-2">{s.name}</td>
                  <td>{s.campus}</td>
                  <td>{s.students}</td>
                  <td>{s.decided === s.students && s.students > 0 ? <Badge tone="green">done</Badge> : s.decided ? `${s.decided} of ${s.students}` : "–"}</td>
                  <td className="text-right">
                    {o.next ? <Link className="text-brand" href={`/promotions/${s.id}`}>Decide</Link> : <span className="opacity-40">Decide</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">3. Start {o.next?.name ?? "next year"}</h2>
        <p className="mb-3 text-sm opacity-70">
          Moves every student as decided, gives each new class roll numbers in alphabetical order, takes leavers off the rolls and the van, and makes {o.next?.name ?? "next year"} the current year. Attendance, fees and report cards then work on the new classes.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={carryTimetable} onChange={(e) => setCarryTimetable(e.target.checked)} />
          Carry this year&apos;s timetable over to the same classes
        </label>
        <Button onClick={start} disabled={busy || !o.next}>Start {o.next?.name ?? "next year"}</Button>
      </Card>
    </div>
  );
}
