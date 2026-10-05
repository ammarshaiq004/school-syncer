"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FlaskConical, Lock } from "lucide-react";
import { periodLabel } from "@/components/invoices/invoice-breakdown";
import { groupDigits, PROVIDER_LABEL, type CheckoutDetail, type PaymentOptions } from "@/components/invoices/online-payment";
import { Alert, Button, Card, ErrorState, PageHeader, SkeletonRows, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

/** Brand colour strip per gateway, so the sandbox page reads like the page it stands in for. */
const BRAND: Record<string, string> = {
  JAZZCASH: "bg-[#c8102e]",
  EASYPAISA: "bg-[#0bb15c]",
  ONEBILL: "bg-[#1f3c88]",
};

/**
 * Sandbox checkout (payments in mock mode): stands in for the JazzCash or
 * Easypaisa hosted page, or for a banking app paying a 1Bill number. Approving
 * makes the API produce the gateway's real response and verify it, so the
 * voucher, receipt and cash book update exactly as they would in production.
 */
export default function SandboxCheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const res = useApi<CheckoutDetail>(`/parent/payments/${id}`);
  const options = useApi<PaymentOptions>("/parent/payment-options");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const c = res.data;
  const back = c ? `/parent/invoices/${c.invoice.id}?payment=${c.id}` : "/parent/invoices";

  // Nothing to decide on a finished checkout: show its outcome on the voucher.
  useEffect(() => {
    if (c && c.status !== "PENDING") router.replace(back);
  }, [c, back, router]);

  async function finish(approve: boolean) {
    setBusy(approve ? "approve" : "decline");
    try {
      await api(`/parent/payments/${id}/mock`, { method: "POST", body: { approve } });
      router.replace(back);
    } catch (e) {
      toast.error("Could not complete the sandbox payment", (e as Error).message);
      setBusy(null);
    }
  }

  const crumbs = [
    { label: "Parent Dashboard", href: "/parent" },
    { label: "Fee invoices", href: "/parent/invoices" },
    { label: "Sandbox checkout" },
  ];

  if (!c) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Sandbox checkout" breadcrumbs={crumbs} />
        <Card padding={res.error ? "none" : "md"}>
          {res.error ? <ErrorState message={res.error} onRetry={res.reload} /> : <SkeletonRows rows={4} columns={2} />}
        </Card>
      </div>
    );
  }

  const name = PROVIDER_LABEL[c.provider];
  const onebill = c.provider === "ONEBILL";
  const notMock = options.data && options.data.mode !== "mock";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={onebill ? "Pay a 1Bill number" : `${name} checkout`}
        description="Sandbox: this page stands in for the gateway. No real money moves."
        breadcrumbs={crumbs}
      />
      {notMock && (
        <Alert tone="danger" title="Sandbox checkout is switched off">
          This school takes real payments, so sandbox payments cannot be completed here.
        </Alert>
      )}
      <Card padding="none" className="mx-auto w-full max-w-md overflow-hidden">
        <div className={`flex items-center justify-between px-5 py-4 text-white ${BRAND[c.provider]}`}>
          <span className="text-lg font-semibold">{onebill ? "1Bill via your bank" : name}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
            <FlaskConical className="size-3" aria-hidden /> Sandbox
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-5 text-sm">
          <dt className="text-fg-muted">Pay to</dt>
          <dd className="text-right font-medium text-fg">{c.school.name}</dd>
          <dt className="text-fg-muted">For</dt>
          <dd className="text-right text-fg">
            {c.student.name}, {periodLabel(c.invoice.period)}
          </dd>
          <dt className="text-fg-muted">Voucher</dt>
          <dd className="text-right font-mono text-fg">{c.invoice.voucherNo}</dd>
          {onebill ? (
            <>
              <dt className="text-fg-muted">1Bill number</dt>
              <dd className="text-right font-mono text-fg">{groupDigits(c.consumerNumber ?? "")}</dd>
            </>
          ) : (
            <>
              <dt className="text-fg-muted">Order</dt>
              <dd className="text-right font-mono text-fg">{c.txnRef}</dd>
            </>
          )}
          <dt className="text-fg-muted">Valid until</dt>
          <dd className="text-right text-fg">
            {new Date(c.expiresAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </dd>
          <dt className="self-center text-fg-muted">Amount</dt>
          <dd className="text-right font-display text-2xl font-semibold tabular-nums text-fg">{rupees(c.amount)}</dd>
        </dl>
        <div className="flex flex-col gap-2 border-t border-border bg-surface-2 px-5 py-4">
          <Button onClick={() => finish(true)} loading={busy === "approve"} disabled={busy !== null || !!notMock || c.expired}>
            {onebill ? "Pay from my bank" : `Approve and pay ${rupees(c.amount)}`}
          </Button>
          <Button variant="secondary" onClick={() => finish(false)} loading={busy === "decline"} disabled={busy !== null || !!notMock}>
            {onebill ? "Cancel this 1Bill number" : "Decline"}
          </Button>
          <p className="flex items-center justify-center gap-1 pt-1 text-xs text-fg-muted">
            <Lock className="size-3" aria-hidden />
            {c.expired ? "This checkout has timed out. Start a new one from Pay dues." : "Real gateways open their own secure page here."}
          </p>
        </div>
      </Card>
    </div>
  );
}
