"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { TextField } from "@/components/kit/inputs";
import { Alert, Button, Dialog, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Commitment {
  id: string;
  amount: number;
  promisedOn: string;
  note: string | null;
  paid: number;
  status: "PENDING" | "KEPT" | "BROKEN";
}

const TONE = { PENDING: "text-fg-secondary", KEPT: "text-success-text", BROKEN: "text-danger-text" } as const;

/** "The parent promised to pay Rs X on day Y", and the fee remark kept on the student's account. */
export function CommitmentDialog({
  studentId,
  name,
  remark,
  open,
  onOpenChange,
  onSaved,
}: {
  studentId: string;
  name: string;
  /** The fee remark on the account now. */
  remark?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const list = useApi<Commitment[]>(open ? `/fees/commitments?studentId=${studentId}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remarkText, setRemarkText] = useState(remark ?? "");

  async function saveRemark() {
    setBusy(true);
    try {
      await api(`/fees/students/${studentId}/remark`, { method: "PUT", body: { remark: remarkText.trim() || null } });
      setError("");
      toast.success("Remark saved", "It shows on the defaulters list and the voucher.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setBusy(true);
    try {
      await api("/fees/commitments", {
        method: "POST",
        body: { studentId, amount: Number(f.get("amount")), promisedOn: f.get("promisedOn"), note: String(f.get("note") ?? "").trim() || undefined },
      });
      setError("");
      formEl.reset();
      toast.success("Promise recorded", `It shows on the dashboard on the day and is marked kept or broken automatically.`);
      await list.reload();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Promise to pay: ${name}`}
      description="Record what the parent promised. Payments that arrive mark it kept or broken."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          <Button type="submit" form="commitment-form" loading={busy} icon={<Save />}>
            Save promise
          </Button>
        </>
      }
    >
      {list.data && list.data.length > 0 && (
        <ul className="mb-4 divide-y divide-border text-sm">
          {list.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {rupees(c.amount)} by {day(c.promisedOn)}
                {c.note && <span className="block text-xs text-fg-muted">{c.note}</span>}
              </span>
              <span className={`text-xs font-medium ${TONE[c.status]}`}>{c.status === "KEPT" ? "Kept" : c.status === "BROKEN" ? "Broken" : `Due, ${rupees(c.paid)} paid so far`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-4 flex items-end gap-2">
        <TextField label="Fee remark" value={remarkText} onChange={(e) => setRemarkText(e.target.value)} maxLength={300} hint="Shown on the defaulters list and the voucher" wrapperClassName="flex-1" />
        <Button type="button" variant="secondary" onClick={saveRemark} disabled={busy}>
          Save remark
        </Button>
      </div>
      <form id="commitment-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Promised amount (Rs)" name="amount" type="number" min={1} max={10_000_000} required inputMode="numeric" />
        <TextField label="Promised by" name="promisedOn" type="date" min={todayIso()} max="2100-12-31" defaultValue={todayIso()} required />
        <TextField label="Note" name="note" maxLength={200} wrapperClassName="sm:col-span-2" />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
