"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardHeader, DataTable, Dialog, SelectField, TextField, useToast, type Column } from "@/components/ui";
import { isOwner, useConsoleAdmin } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

interface Credit {
  id: string;
  kind: "PLAN_CHANGE" | "REFERRAL" | "GOODWILL" | "CARRIED";
  amount: number;
  reason: string;
  createdAt: string;
  invoice: { number: string } | null;
}

const KINDS: Record<Credit["kind"], string> = { PLAN_CHANGE: "Plan change", REFERRAL: "Referral", GOODWILL: "Goodwill", CARRIED: "Left over" };

/** Credits and plan-change charges waiting on (or already taken by) a school's bills. */
export function SchoolCredits({ schoolId }: { schoolId: string }) {
  const toast = useToast();
  const owner = isOwner(useConsoleAdmin());
  const credits = usePlatformApi<Credit[]>(`/schools/${schoolId}/credits`);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("REFERRAL");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await platformApi(`/schools/${schoolId}/credits`, { method: "POST", body: { kind, amount: Number(f.get("amount")), reason: String(f.get("reason")) } });
      toast.success("Credit added", "The school's next bill takes it off.");
      setOpen(false);
      await credits.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Credit) {
    try {
      await platformApi(`/schools/${schoolId}/credits/${c.id}`, { method: "DELETE" });
      await credits.reload();
    } catch (e) {
      toast.error("Could not take it back", (e as Error).message);
    }
  }

  const columns: Column<Credit>[] = [
    { id: "date", header: "Added", cell: (c) => day(c.createdAt), hideBelow: "md" },
    {
      id: "what",
      header: "What",
      cell: (c) => (
        <>
          <span className="font-medium text-fg">{KINDS[c.kind]}</span>
          <span className="block text-xs text-fg-secondary">{c.reason}</span>
        </>
      ),
    },
    { id: "amount", header: "Amount", align: "right", cell: (c) => (c.amount < 0 ? `- ${rupees(-c.amount)}` : rupees(c.amount)) },
    {
      id: "used",
      header: "Taken by",
      align: "right",
      cell: (c) =>
        c.invoice ? (
          c.invoice.number
        ) : owner && c.kind !== "PLAN_CHANGE" ? (
          <Button size="sm" variant="secondary" onClick={() => void remove(c)}>
            Take back
          </Button>
        ) : (
          "Next bill"
        ),
    },
  ];

  return (
    <Card padding="none">
      <div className="p-5 pb-0">
        <CardHeader
          title="Credits and plan changes"
          description="Amounts waiting for the next bill. A credit never takes a bill below nothing; what is left carries over."
          action={owner && <Button size="sm" onClick={() => { setError(""); setOpen(true); }}>Give credit</Button>}
        />
      </div>
      <DataTable bare label="Credits" columns={columns} data={credits.data} error={credits.error} onRetry={credits.reload} getRowId={(c) => c.id} empty={{ title: "Nothing waiting", description: "A referral reward or a plan change part-way through a month shows up here." }} />
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)} title="Give credit">
        <form onSubmit={add} className="flex flex-col gap-4">
          <SelectField label="Why" options={[{ value: "REFERRAL", label: "Referred another school" }, { value: "GOODWILL", label: "Goodwill" }]} value={kind} onChange={(e) => setKind(e.target.value)} />
          <TextField label="Rupees off" name="amount" type="number" required min={1} />
          <TextField label="Note" name="reason" required minLength={3} maxLength={200} hint="For example the name of the school they referred." />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Add credit</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
