"use client";

import { useState, type FormEvent } from "react";
import { Save, Scale } from "lucide-react";
import { Alert, Button, Card, CardHeader, ErrorState, Field, SkeletonRows, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Rules {
  shiftStart: string;
  graceMinutes: number;
  latesPerDeduction: number;
  lateDeductionPercent: number;
  freeShortLeaves: number;
  shortLeaveDeductionPercent: number;
}

/** How payroll treats late arrivals and short leaves (applied when a month is calculated). */
export function PayrollRulesTab({ editable }: { editable: boolean }) {
  const rules = useApi<Rules>("/hr/payroll-rules");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const n = (k: string) => Number(f.get(k));
    setBusy(true);
    try {
      await api("/hr/payroll-rules", {
        method: "PUT",
        body: {
          shiftStart: f.get("shiftStart"),
          graceMinutes: n("graceMinutes"),
          latesPerDeduction: n("latesPerDeduction"),
          lateDeductionPercent: n("lateDeductionPercent"),
          freeShortLeaves: n("freeShortLeaves"),
          shortLeaveDeductionPercent: n("shortLeaveDeductionPercent"),
        },
      });
      setError("");
      toast.success("Payroll rules saved", "They apply the next time a month is calculated.");
      await rules.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = rules.data;
  return (
    <Card>
      <CardHeader title="Late arrivals and short leaves" icon={<Scale />} description="Taken off pay when a month is calculated. Draft months pick up changes on recalculation; finalised months stay as they were." />
      {rules.error ? (
        <ErrorState compact message={rules.error} onRetry={rules.reload} />
      ) : !r ? (
        <SkeletonRows rows={4} columns={2} />
      ) : (
        <form key={JSON.stringify(r)} onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Shift starts" name="shiftStart" type="time" required defaultValue={r.shiftStart} disabled={!editable} />
          <Field label="Grace period (minutes)" name="graceMinutes" type="number" min={0} max={120} required defaultValue={r.graceMinutes} disabled={!editable} />
          <Field label="Lates per deduction" name="latesPerDeduction" type="number" min={0} max={31} required defaultValue={r.latesPerDeduction} disabled={!editable} />
          <Field label="Deduction per late set (% of a day's pay)" name="lateDeductionPercent" type="number" min={0} max={300} required defaultValue={r.lateDeductionPercent} disabled={!editable} />
          <Field label="Free short leaves per month" name="freeShortLeaves" type="number" min={0} max={31} required defaultValue={r.freeShortLeaves} disabled={!editable} />
          <Field label="Each extra short leave (% of a day's pay)" name="shortLeaveDeductionPercent" type="number" min={0} max={300} required defaultValue={r.shortLeaveDeductionPercent} disabled={!editable} />
          <p className="text-sm text-fg-muted sm:col-span-2">
            Someone counts as late when marked Late on the staff register, or marked Present with an arrival time after the shift start plus the grace period. Every “lates per deduction” late days in a month cost one deduction; 0 turns this off.
          </p>
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
          {editable && (
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" icon={<Save />} loading={busy}>Save rules</Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
