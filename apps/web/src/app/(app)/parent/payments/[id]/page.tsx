"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CircleCheck, Printer } from "lucide-react";
import { periodLabel } from "@/components/invoices/invoice-breakdown";
import { CHECKOUT_LABEL, CHECKOUT_TONE, PROVIDER_LABEL, type CheckoutDetail } from "@/components/invoices/online-payment";
import { Button, Card, ErrorState, PageHeader, SkeletonRows, StatusPill } from "@/components/ui";
import { buttonClass } from "@/components/kit";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

/** Receipt for one online fee payment, printable. */
export default function PaymentReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<CheckoutDetail>(`/parent/payments/${id}`);
  const c = res.data;
  const crumbs = [
    { label: "Parent Dashboard", href: "/parent" },
    { label: "Fee invoices", href: "/parent/invoices" },
    { label: "Receipt" },
  ];

  if (!c) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Payment receipt" breadcrumbs={crumbs} />
        <Card padding={res.error ? "none" : "md"}>
          {res.error ? (
            <ErrorState
              title={res.errorStatus === 404 ? "Payment not found" : undefined}
              message={res.errorStatus === 404 ? "This payment is not for any of your children." : res.error}
              onRetry={res.errorStatus === 404 ? undefined : res.reload}
            />
          ) : (
            <SkeletonRows rows={6} columns={2} />
          )}
        </Card>
      </div>
    );
  }

  const rows: [string, string][] = [
    ["Receipt no.", c.receipt?.receiptNo ?? "Not issued"],
    ["Paid on", c.receipt ? day(c.receipt.receivedAt) : "Not paid"],
    ["Student", `${c.student.name} (${c.student.admissionNo})`],
    ["Fee month", periodLabel(c.invoice.period)],
    ["Voucher no.", c.invoice.voucherNo],
    ["Paid by", PROVIDER_LABEL[c.provider]],
    ["Transaction ID", c.receipt?.reference ?? c.providerRef ?? c.txnRef],
    ["Balance left on voucher", rupees(c.invoice.balance)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payment receipt"
        description={`${c.student.name}, ${periodLabel(c.invoice.period)}`}
        breadcrumbs={crumbs}
        meta={<StatusPill status={c.status} tone={CHECKOUT_TONE[c.status]} label={CHECKOUT_LABEL[c.status]} />}
        actions={
          <>
            <Link href={`/parent/invoices/${c.invoice.id}`} className={buttonClass("secondary")}>
              Open voucher
            </Link>
            {c.receipt && (
              <Button icon={<Printer />} onClick={() => window.print()}>
                Print receipt
              </Button>
            )}
          </>
        }
      />
      <Card className="mx-auto w-full max-w-lg print:max-w-none print:border-0 print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <div className="font-display text-lg font-semibold text-fg">{c.school.name}</div>
            <div className="text-xs text-fg-muted">{[c.school.city, c.school.phone].filter(Boolean).join(", ")}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Amount paid</div>
            <div className="font-display text-2xl font-semibold tabular-nums text-fg">{rupees(c.amount)}</div>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 py-4 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="text-right font-medium text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        {c.status === "PAID" && (
          <p className="flex items-center gap-2 border-t border-border pt-4 text-xs text-success-text">
            <CircleCheck className="size-4" aria-hidden /> Confirmed by {PROVIDER_LABEL[c.provider]} and recorded by the school.
          </p>
        )}
      </Card>
    </div>
  );
}
