"use client";

import { useState, type FormEvent } from "react";
import { HandCoins } from "lucide-react";
import { DataTable, type Column } from "@/components/kit/data-table";
import { TextField } from "@/components/kit/inputs";
import { Alert, Button, Dialog, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface SecurityRow {
  id: string;
  name: string;
  balance: number;
  staffProfile: { employeeNo: string | null } | null;
  securityEntries: { id: string; amount: number; note: string | null; effectiveOn: string }[];
}

/** Security money held from salaries (a deduction marked "security" on the staff record) and what has been given back. */
export function SecurityTab({ canRefund }: { canRefund: boolean }) {
  const rows = useApi<SecurityRow[]>("/hr/security");
  const toast = useToast();
  const [target, setTarget] = useState<SecurityRow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/hr/security/${target.id}/refund`, { method: "POST", body: { amount: Number(f.get("amount")), note: String(f.get("note") ?? "").trim() || undefined } });
      toast.success("Refund recorded", `${target.name}'s security balance is updated.`);
      setTarget(null);
      setError("");
      rows.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SecurityRow>[] = [
    { id: "name", header: "Staff member", cell: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name },
    { id: "no", header: "Employee no.", cell: (r) => r.staffProfile?.employeeNo ?? "-", hideBelow: "sm" },
    {
      id: "last",
      header: "Last entry",
      cell: (r) => (r.securityEntries[0] ? `${r.securityEntries[0].amount < 0 ? "Refunded" : "Held"} ${rupees(Math.abs(r.securityEntries[0].amount))} on ${day(r.securityEntries[0].effectiveOn)}` : "-"),
      hideBelow: "md",
    },
    { id: "balance", header: "Balance held", align: "right", cell: (r) => <span className="tabular-nums font-medium">{rupees(r.balance)}</span>, sortValue: (r) => r.balance },
    ...(canRefund
      ? [
          {
            id: "refund",
            header: <span className="sr-only">Refund</span>,
            align: "right" as const,
            cell: (r: SecurityRow) => (
              <Button type="button" size="sm" variant="ghost" icon={<HandCoins />} disabled={r.balance <= 0} onClick={() => setTarget(r)}>
                Refund
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">
        Mark a deduction as &ldquo;Security&rdquo; on a staff record. Every finalised payroll then adds it to that person&rsquo;s balance here.
      </p>
      <DataTable
        label="Staff security balances"
        columns={columns}
        data={rows.data}
        error={rows.error}
        onRetry={rows.reload}
        getRowId={(r) => r.id}
        empty={{ title: "No security held yet", description: "It appears after a payroll with a security deduction is finalised.", icon: <HandCoins /> }}
      />
      <Dialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Refund security to ${target?.name ?? ""}`}
        description={target ? `${rupees(target.balance)} is held.` : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="security-refund" loading={busy}>
              Record refund
            </Button>
          </>
        }
      >
        <form id="security-refund" onSubmit={refund} className="grid gap-4">
          <TextField label="Amount (Rs)" name="amount" type="number" min={1} max={target?.balance} required inputMode="numeric" />
          <TextField label="Note" name="note" maxLength={200} />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Dialog>
    </div>
  );
}
