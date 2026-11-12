"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { SelectField, TextField } from "@/components/kit/inputs";
import { Alert, Button, Dialog, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";

const KINDS = [
  { value: "ADVANCE", label: "Advance received (credit)" },
  { value: "WITHDRAW", label: "Credit refunded or used up" },
  { value: "OWED", label: "Opening balance owed (arrears)" },
];

/**
 * Advance credit and balances brought forward from an old system: advances become credit that
 * the next vouchers use up; arrears become a voucher dated the day given.
 */
export function CreditDialog({
  studentId,
  name,
  open,
  onOpenChange,
  onSaved,
}: {
  studentId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const kind = String(f.get("kind"));
    const amount = Number(f.get("amount"));
    const note = String(f.get("note") ?? "").trim() || undefined;
    const on = String(f.get("on") || todayIso());
    setBusy(true);
    try {
      if (kind === "OWED") {
        await api("/fees/opening-balance", { method: "POST", body: { studentId, amount, note, asOf: on } });
      } else {
        await api("/fees/credits", { method: "POST", body: { studentId, amount: kind === "WITHDRAW" ? -amount : amount, note, effectiveOn: on } });
      }
      setError("");
      toast.success("Saved", `${name}'s balance is updated.`);
      onOpenChange(false);
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
      title={`Credit and opening balance for ${name}`}
      description="Advance credit comes off the next vouchers automatically."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="credit-form" loading={busy} icon={<Save />}>
            Save
          </Button>
        </>
      }
    >
      <form id="credit-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <SelectField label="What happened" name="kind" options={KINDS} wrapperClassName="sm:col-span-2" />
        <TextField label="Amount (Rs)" name="amount" type="number" min={1} max={10_000_000} required inputMode="numeric" />
        <TextField label="Date" name="on" type="date" max={todayIso()} defaultValue={todayIso()} required />
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
