"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, FileText, Wallet } from "lucide-react";
import { Button, DataTable, NativeSelect, PageHeader, StatusPill, Tooltip, useToast, type Column } from "@/components/ui";
import { ReasonDialog } from "@/components/platform/reason-dialog";
import { isOwner, useConsoleAdmin } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import type { PlatformPayment } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";

type PaymentRow = PlatformPayment & {
  school: { id: string; name: string; slug: string };
  allocations: { id: string; amount: number; invoice: { id: string; number: string } }[];
};

const PAYMENT_STATUSES = [
  { value: "RECORDED", label: "Received" },
  { value: "VOID", label: "Void" },
];

const linkClass =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-secondary hover:bg-surface-3 hover:text-fg [&_svg]:size-4";

/** Money schools have paid SchoolSyncer, with the bills each payment settled. */
export default function PaymentsPage() {
  const toast = useToast();
  const canVoid = isOwner(useConsoleAdmin());
  const [status, setStatus] = useState("");
  const payments = usePlatformApi<PaymentRow[]>(`/payments${status ? `?status=${status}` : ""}`);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);

  async function voidPayment(reason: string) {
    const p = voiding;
    if (!p) return;
    await platformApi(`/payments/${p.id}/void`, { method: "POST", body: { reason } });
    toast.success(`Receipt ${p.number} voided`, "The bills it paid are owed again.");
    await payments.reload();
  }

  const columns: Column<PaymentRow>[] = [
    { id: "number", header: "Receipt", sortValue: (p) => p.number, cell: (p) => <span className="font-mono text-xs">{p.number}</span> },
    {
      id: "school",
      header: "School",
      sortValue: (p) => p.school.name,
      cell: (p) => (
        <Link href={`/platform/schools/${p.school.id}`} className="font-medium text-fg hover:text-brand">
          {p.school.name}
        </Link>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (p) => p.amount,
      cell: (p) => (p.status === "VOID" ? <span className="text-fg-muted line-through">{rupees(p.amount)}</span> : rupees(p.amount)),
    },
    { id: "method", header: "Method", sortValue: (p) => p.method, cell: (p) => p.method, hideBelow: "md" },
    {
      id: "reference",
      header: "Reference",
      cell: (p) => (p.reference ? <span className="break-all text-[13px]">{p.reference}</span> : <span className="text-fg-muted">–</span>),
      hideBelow: "lg",
    },
    { id: "received", header: "Received on", sortValue: (p) => p.receivedOn, cell: (p) => day(p.receivedOn) },
    {
      id: "bills",
      header: "Paid bills",
      cell: (p) => {
        const applied = p.allocations.reduce((sum, a) => sum + a.amount, 0);
        const credit = p.status === "RECORDED" ? p.amount - applied : 0;
        return (
          <span className="flex flex-col gap-0.5 text-[13px]">
            {p.allocations.map((a) => (
              <span key={a.id}>
                <Link href={`/platform/bills/${a.invoice.id}`} className="font-mono text-xs text-fg hover:text-brand">
                  {a.invoice.number}
                </Link>{" "}
                <span className="text-fg-muted">{rupees(a.amount)}</span>
              </span>
            ))}
            {credit > 0 && <span className="text-fg-muted">{rupees(credit)} credit</span>}
            {!p.allocations.length && !credit && <span className="text-fg-muted">–</span>}
          </span>
        );
      },
      hideBelow: "md",
    },
    {
      id: "status",
      header: "Status",
      sortValue: (p) => p.status,
      cell: (p) =>
        p.status === "VOID" ? (
          <span className="flex max-w-56 flex-col items-start gap-0.5">
            <StatusPill status="VOID" label="Void" />
            {p.voidReason && <span className="text-xs text-fg-muted">{p.voidReason}</span>}
          </span>
        ) : (
          <span className="flex flex-col items-start gap-0.5">
            <StatusPill status="PAID" label="Received" />
            {p.recordedBy && <span className="text-xs text-fg-muted">by {p.recordedBy}</span>}
          </span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (p) => (
        <span className="flex justify-end gap-1.5 whitespace-nowrap">
          <Link href={`/platform/receipts/${p.id}`} className={linkClass} aria-label={`View or print receipt ${p.number}`}>
            <FileText aria-hidden />
            Receipt
          </Link>
          {p.status === "RECORDED" && (
            <Tooltip content="Only a SchoolSyncer owner can void a payment" disabled={canVoid}>
              <span tabIndex={canVoid ? undefined : 0}>
                <Button size="sm" variant="ghost" type="button" icon={<Ban />} disabled={!canVoid} onClick={() => setVoiding(p)} aria-label={`Void ${p.number}`}>
                  Void
                </Button>
              </span>
            </Tooltip>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Money received from schools. Each payment goes to the oldest unpaid bills first; anything left over is kept as credit. Record new payments from a school's Billing tab."
      />
      <DataTable
        label="Payments"
        columns={columns}
        data={payments.data}
        getRowId={(p) => p.id}
        error={payments.error}
        onRetry={payments.reload}
        getSearchText={(p) => `${p.number} ${p.school.name} ${p.reference ?? ""} ${p.method} ${p.allocations.map((a) => a.invoice.number).join(" ")}`}
        searchPlaceholder="Search receipt, school, reference or bill"
        filters={
          <NativeSelect
            aria-label="Status"
            placeholder="All payments"
            options={PAYMENT_STATUSES}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            wrapperClassName="w-40"
          />
        }
        filtered={!!status}
        empty={{ icon: <Wallet />, title: "No payments yet", description: "Payments appear here once one is recorded for a school." }}
      />

      <ReasonDialog
        open={!!voiding}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={voiding ? `Void receipt ${voiding.number}?` : "Void payment?"}
        description={
          voiding
            ? `Use this for a payment recorded by mistake or a cheque that bounced. ${rupees(voiding.amount)} from ${voiding.school.name} stops counting, and the bills it paid are owed again.`
            : ""
        }
        confirmLabel="Void payment"
        destructive
        reasonLabel="Why is this payment being voided?"
        placeholder="Cheque bounced; bank returned it on 14 Oct"
        onSubmit={voidPayment}
      />
    </div>
  );
}
