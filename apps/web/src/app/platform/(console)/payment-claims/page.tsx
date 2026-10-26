"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Check, ExternalLink, HandCoins, X } from "lucide-react";
import { Alert, Button, DataTable, Dialog, NativeSelect, PageHeader, StatusPill, TextField, useToast, type Column } from "@/components/ui";
import { ReasonDialog } from "@/components/platform/reason-dialog";
import { platformApi } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { CLAIMS_CHANGED, CLAIM_STATUS, type PaymentClaim } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";

const STATUSES = [
  { value: "PENDING", label: "Waiting to be checked" },
  { value: "APPROVED", label: "Confirmed" },
  { value: "REJECTED", label: "Not confirmed" },
];

/** Payments schools say they made by bank transfer or wallet, with the slip to check against the bank. */
export default function PaymentClaimsPage() {
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const claims = usePlatformApi<PaymentClaim[]>(`/payment-claims?status=${status}`);
  const [approving, setApproving] = useState<PaymentClaim | null>(null);
  const [rejecting, setRejecting] = useState<PaymentClaim | null>(null);

  async function done(message: string, detail: string) {
    toast.success(message, detail);
    window.dispatchEvent(new Event(CLAIMS_CHANGED));
    await claims.reload();
  }

  const columns: Column<PaymentClaim>[] = [
    {
      id: "school",
      header: "School",
      sortValue: (c) => c.school?.name ?? "",
      cell: (c) => (
        <>
          <Link href={`/platform/schools/${c.school?.id}`} className="font-medium text-fg hover:text-brand">
            {c.school?.name}
          </Link>
          <span className="block text-xs text-fg-muted">
            {c.createdByName}, {day(c.createdAt)}
          </span>
        </>
      ),
    },
    { id: "amount", header: "Amount", align: "right", sortValue: (c) => c.amount, cell: (c) => rupees(c.amount) },
    {
      id: "how",
      header: "How",
      cell: (c) => (
        <>
          {c.method}, {day(c.paidOn)}
          {c.reference && <span className="block font-mono text-xs text-fg-muted">{c.reference}</span>}
          {c.note && <span className="block max-w-56 text-xs text-fg-secondary">{c.note}</span>}
        </>
      ),
    },
    {
      id: "proof",
      header: "Proof",
      cell: (c) =>
        c.proof ? (
          <a href={c.proof.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            {c.proof.filename} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : (
          <span className="text-fg-muted">None sent</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (c) => (
        <>
          <StatusPill status={c.status} tone={CLAIM_STATUS[c.status].tone} label={CLAIM_STATUS[c.status].label} />
          {c.reviewedBy && <span className="mt-1 block text-xs text-fg-muted">{c.reviewedBy}</span>}
          {c.rejectReason && <span className="mt-1 block max-w-56 text-xs text-fg-secondary">{c.rejectReason}</span>}
          {c.receipt && (
            <Link href={`/platform/receipts/${c.receipt.id}`} className="mt-1 block text-xs font-medium text-brand hover:underline">
              Receipt {c.receipt.number}
            </Link>
          )}
        </>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (c) =>
        c.status === "PENDING" && (
          <div className="flex justify-end gap-2">
            <Button size="sm" icon={<Check />} onClick={() => setApproving(c)}>
              Confirm
            </Button>
            <Button size="sm" variant="secondary" icon={<X />} onClick={() => setRejecting(c)}>
              Reject
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments to check"
        description="Check each one against the bank statement. Confirming records the payment and sends the school its receipt."
      />
      <DataTable
        label="Payments schools say they made"
        columns={columns}
        data={claims.data}
        error={claims.error}
        onRetry={claims.reload}
        getRowId={(c) => c.id}
        filters={<NativeSelect aria-label="Show" options={STATUSES} value={status} onChange={(e) => setStatus(e.target.value)} wrapperClassName="w-56" />}
        empty={{ icon: <HandCoins />, title: status === "PENDING" ? "Nothing waiting" : "Nothing here yet", description: "Payments schools report appear here." }}
      />
      <ConfirmClaim
        claim={approving}
        onClose={() => setApproving(null)}
        onDone={(c, receipt) => done(`Receipt ${receipt} recorded`, `${rupees(c)} from ${approving?.school?.name}.`)}
      />
      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={rejecting ? `Reject ${rupees(rejecting.amount)} from ${rejecting.school?.name}?` : ""}
        description="The school is told this reason and can send the details again."
        confirmLabel="Reject payment"
        destructive
        placeholder="For example: no such transfer in our statement"
        onSubmit={async (reason) => {
          if (!rejecting) return;
          await platformApi(`/payment-claims/${rejecting.id}/reject`, { method: "POST", body: { reason } });
          await done("Payment rejected", "The school has been told.");
        }}
      />
    </div>
  );
}

function ConfirmClaim({ claim, onClose, onDone }: { claim: PaymentClaim | null; onClose: () => void; onDone: (amount: number, receipt: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claim) return;
    const amount = Number(new FormData(event.currentTarget).get("amount"));
    setBusy(true);
    setError("");
    try {
      const approved = await platformApi<PaymentClaim>(`/payment-claims/${claim.id}/approve`, {
        method: "POST",
        body: amount === claim.amount ? {} : { amount },
      });
      onClose();
      await onDone(amount, approved.receipt?.number ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!claim}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) {
          setError("");
          onClose();
        }
      }}
      title={claim ? `Confirm the payment from ${claim.school?.name}` : ""}
      description="It goes to the oldest unpaid bill first. If the bank shows a different amount, correct it here."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="confirm-claim" loading={busy} icon={<Check />}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="confirm-claim" onSubmit={submit} className="flex flex-col gap-4">
        <TextField key={claim?.id} label="Amount received (Rs)" name="amount" type="number" min={1} max={100_000_000} step={1} required inputMode="numeric" defaultValue={claim?.amount} />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
