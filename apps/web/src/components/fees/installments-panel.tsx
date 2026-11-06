"use client";

import { useState, type FormEvent } from "react";
import { CalendarRange, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Dialog, StatusPill, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Plan {
  installments: { id: string; seq: number; dueDate: string; amount: number; paid: number; balance: number; status: string }[];
}

const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { PAID: "success", OVERDUE: "danger", PARTIAL: "warning", UNPAID: "neutral" };

/** A voucher's payment plan: split what is owed into dated instalments. */
export function InstallmentsPanel({ invoiceId, open, canManage }: { invoiceId: string; open: boolean; canManage: boolean }) {
  const plan = useApi<Plan>(`/fees/invoices/${invoiceId}/installments`);
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const items = plan.data?.installments ?? [];
  if (!plan.data || (!items.length && !(open && canManage))) return null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await api(`/fees/invoices/${invoiceId}/installments`, {
        method: "PUT",
        body: { count: Number(f.get("count")), firstDue: f.get("firstDue") },
      });
      setDialog(false);
      setError("");
      toast.success("Payment plan saved", "The voucher is now due in instalments.");
      await plan.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await api(`/fees/invoices/${invoiceId}/installments`, { method: "DELETE" });
    toast.success("Payment plan removed", "The voucher is due in one go again.");
    await plan.reload();
  }

  return (
    <Card className="print:hidden">
      <CardHeader
        title="Payment plan"
        description={items.length ? `${items.length} instalments` : "Let the family pay this voucher in instalments"}
        icon={<CalendarRange />}
        action={
          canManage && open ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDialog(true)}>
                {items.length ? "Change" : "Split into instalments"}
              </Button>
              {items.length > 0 && (
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={remove}>
                  Remove
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      {items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <div className="font-medium text-fg">
                  {i.seq}. Due {day(i.dueDate)}
                </div>
                <div className="text-xs text-fg-muted">
                  {rupees(i.paid)} of {rupees(i.amount)} paid
                </div>
              </div>
              <StatusPill status={i.status} tone={TONE[i.status]} label={i.status.charAt(0) + i.status.slice(1).toLowerCase()} />
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Split into instalments"
        description="The voucher is split evenly, one instalment a month. Payments fill the instalments in order."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="installment-plan" loading={saving}>
              Save plan
            </Button>
          </>
        }
      >
        <form id="installment-plan" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <TextField label="Instalments" name="count" type="number" min={2} max={12} defaultValue={3} required />
          <TextField label="First due date" name="firstDue" type="date" min={todayIso()} defaultValue={todayIso()} required />
          {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        </form>
      </Dialog>
    </Card>
  );
}
