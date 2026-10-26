"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Banknote, Paperclip } from "lucide-react";
import { FileUploadField, type FileLink } from "@/components/elearning/file-upload";
import { Alert, Button, Card, CardHeader, DataTable, Dialog, SelectField, StatusPill, TextareaField, TextField, useToast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees, todayIso } from "@/lib/format";
import { CLAIM_STATUS, PAYMENT_METHODS, type PaymentClaim } from "@/lib/platform-billing";
import { useApi } from "@/lib/use-api";

const METHODS = PAYMENT_METHODS.map((m) => ({ value: m, label: m }));
const PROOF_TYPES = ".png,.jpg,.jpeg,.webp,.gif,.pdf";

const columns: Column<PaymentClaim>[] = [
  { id: "paidOn", header: "Paid on", sortValue: (c) => c.paidOn, cell: (c) => day(c.paidOn) },
  { id: "amount", header: "Amount", align: "right", sortValue: (c) => c.amount, cell: (c) => rupees(c.amount) },
  {
    id: "method",
    header: "How",
    cell: (c) => (
      <>
        {c.method}
        {c.reference && <span className="block font-mono text-xs text-fg-muted">{c.reference}</span>}
      </>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (c) => (
      <>
        <StatusPill status={c.status} tone={CLAIM_STATUS[c.status].tone} label={CLAIM_STATUS[c.status].label} />
        {c.rejectReason && <span className="mt-1 block max-w-64 text-xs text-fg-secondary">{c.rejectReason}</span>}
      </>
    ),
  },
  {
    id: "receipt",
    header: "",
    align: "right",
    cell: (c) =>
      c.receipt ? (
        <Link href={`/billing/receipts/${c.receipt.id}`} className="text-[13px] font-medium text-brand hover:underline">
          Receipt {c.receipt.number}
        </Link>
      ) : null,
  },
];

/**
 * "I have paid": the school sends the bank or wallet details with the slip
 * (SCHOOL-42). SchoolSyncer checks it against the bank, then the payment and
 * its receipt appear under Your payments.
 */
export function PaymentClaims({ owed, onChanged }: { owed: number; onChanged: () => Promise<void> }) {
  const claims = useApi<PaymentClaim[]>("/subscription/payment-claims");
  const [open, setOpen] = useState(false);
  const rows = claims.data ?? [];
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardHeader
          title="Paid by bank transfer or wallet?"
          description="Send us the details and the slip. We check them and confirm here with a receipt."
          action={
            <Button icon={<Banknote />} onClick={() => setOpen(true)}>
              I have paid
            </Button>
          }
        />
      </div>
      {rows.length > 0 && (
        <DataTable bare label="Payments you have sent us" columns={columns} data={rows} getRowId={(c) => c.id} pageSize={6} />
      )}
      <ClaimDialog
        open={open}
        onOpenChange={setOpen}
        owed={owed}
        onSent={async () => {
          await Promise.all([claims.reload(), onChanged()]);
        }}
      />
    </Card>
  );
}

function ClaimDialog({
  open,
  onOpenChange,
  owed,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owed: number;
  onSent: () => Promise<void>;
}) {
  const toast = useToast();
  const [proof, setProof] = useState<FileLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/subscription/payment-claims", {
        method: "POST",
        body: {
          amount: Number(f.get("amount")),
          method: f.get("method"),
          reference: String(f.get("reference") ?? "").trim() || undefined,
          paidOn: f.get("paidOn"),
          note: String(f.get("note") ?? "").trim() || undefined,
          proofId: proof?.id,
        },
      });
      setProof(null);
      onOpenChange(false);
      toast.success("Payment details sent", "We will check them against our bank and confirm here.");
      await onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
        if (!o) setError("");
      }}
      title="Tell us about your payment"
      description="Give the transaction number, the slip, or both."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="payment-claim" loading={busy} icon={<Paperclip />}>
            Send
          </Button>
        </>
      }
    >
      <form id="payment-claim" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Amount paid (Rs)" name="amount" type="number" min={1} max={100_000_000} step={1} required inputMode="numeric" defaultValue={owed > 0 ? owed : undefined} />
        <SelectField label="How did you pay?" name="method" options={METHODS} defaultValue={PAYMENT_METHODS[0]} />
        <TextField label="Transaction number" name="reference" maxLength={60} hint="From your bank or wallet app" />
        <TextField label="Paid on" name="paidOn" type="date" required max={todayIso()} defaultValue={todayIso()} />
        <div className="sm:col-span-2">
          <FileUploadField
            label="Slip or screenshot"
            hint="A photo or PDF of the transfer, up to 5 MB."
            endpoint="/subscription/payment-claims/proof"
            accept={PROOF_TYPES}
            value={proof}
            onChange={setProof}
            disabled={busy}
          />
        </div>
        <TextareaField label="Note (optional)" name="note" rows={2} maxLength={300} wrapperClassName="sm:col-span-2" />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
