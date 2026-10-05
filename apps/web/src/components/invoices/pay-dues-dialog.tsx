"use client";

import { Building, Copy, CreditCard, Hash, Landmark, Smartphone, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button, Dialog, IconButton, Skeleton, useToast } from "@/components/kit";
import { day, rupees } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import {
  groupDigits,
  postToGateway,
  PROVIDER_HINT,
  PROVIDER_LABEL,
  startCheckout,
  type OnlineProvider,
  type PaymentOptions,
} from "./online-payment";

export interface PayDuesInvoice {
  /** Needed to pay online; without it only the offline ways are shown. */
  invoiceId?: string;
  voucherNo: string;
  dueDate: string;
  /** Balance plus any late fine built up so far. */
  totalDue: number;
  lateFine: number;
  studentName: string;
  periodLabel: string;
  school?: { name: string; phone?: string | null } | null;
}

/**
 * "Pay dues": pay a voucher online (JazzCash, Easypaisa or a 1Bill number) when the school's
 * plan has online payments, or any of the offline ways keyed on the voucher number.
 */
export function PayDuesDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: PayDuesInvoice;
}) {
  const toast = useToast();
  const router = useRouter();
  const user = useSession();
  const ref = invoice.voucherNo;
  const onlineAllowed = !!invoice.invoiceId && invoice.totalDue > 0 && user.plan?.features.includes("online_payments") === true;
  const options = useApi<PaymentOptions>(open && onlineAllowed ? "/parent/payment-options" : null);
  const [starting, setStarting] = useState<OnlineProvider | null>(null);
  const [onebill, setOnebill] = useState<{ checkoutId: string; consumerNumber: string } | null>(null);
  const providers = options.data?.providers ?? [];

  async function payOnline(provider: OnlineProvider) {
    setStarting(provider);
    try {
      const { checkout, action } = await startCheckout(invoice.invoiceId!, provider);
      if (action.kind === "form") {
        // Leaves the portal for the gateway's page; it sends the parent back here afterwards.
        postToGateway(action);
        return;
      }
      if (action.kind === "onebill") {
        setOnebill({ checkoutId: checkout.id, consumerNumber: action.consumerNumber });
      } else {
        router.push(`/parent/pay/${checkout.id}`);
      }
      setStarting(null);
    } catch (e) {
      toast.error("Could not start the payment", (e as Error).message);
      setStarting(null);
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`, text);
    } catch {
      toast.error("Could not copy", `Please note down ${text}.`);
    }
  }

  const copyRef = () => copy(ref, "Voucher number");

  const ways: { icon: ReactNode; title: string; steps: string }[] = [
    {
      icon: <Landmark />,
      title: "Bank branch",
      steps: `Print this voucher with Download invoice PDF and pay it at the school's bank. Quote voucher no. ${ref}.`,
    },
    {
      icon: <Smartphone />,
      title: "JazzCash or Easypaisa",
      steps: `Open the app, choose Bill payment, then Education or School fee, and enter ${ref} as the reference.`,
    },
    {
      icon: <Wallet />,
      title: "1Bill from any banking app",
      steps: `Choose 1Bill, then Invoice or Voucher, and enter ${ref} as the reference number.`,
    },
    {
      icon: <Building />,
      title: "School office",
      steps: `Pay in cash at the fee counter${invoice.school?.phone ? ` (${invoice.school.phone})` : ""} and collect a receipt.`,
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pay dues"
      description={`${invoice.studentName}, ${invoice.periodLabel}`}
      size="md"
      footer={
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Amount to pay</div>
            <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg">{rupees(invoice.totalDue)}</div>
            <div className="text-xs text-fg-muted">
              {invoice.lateFine > 0 ? `Includes ${rupees(invoice.lateFine)} late fee` : `Due by ${day(invoice.dueDate)}`}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Voucher no. (reference)</div>
            <div className="mt-1 flex items-center gap-1">
              <span className="font-mono text-lg font-medium text-fg">{ref}</span>
              <IconButton size="sm" aria-label={`Copy voucher number ${ref}`} onClick={copyRef}>
                <Copy />
              </IconButton>
            </div>
          </div>
        </div>

        {onlineAllowed && (options.data === null && !options.error ? (
          <Skeleton className="h-28 w-full" />
        ) : providers.length > 0 ? (
          <section aria-labelledby="pay-online-title" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="pay-online-title" className="text-sm font-semibold text-fg">
                Pay online now
              </h3>
              {options.data?.mode === "mock" && <span className="text-xs text-fg-muted">Sandbox: no real money moves</span>}
            </div>
            {onebill ? (
              <div className="rounded-xl border border-primary/25 bg-primary-tint p-4">
                <div className="text-xs font-medium uppercase tracking-[0.04em] text-brand">Your 1Bill number</div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="font-mono text-xl font-semibold tracking-wide text-fg">{groupDigits(onebill.consumerNumber)}</span>
                  <IconButton size="sm" aria-label="Copy 1Bill number" onClick={() => copy(onebill.consumerNumber, "1Bill number")}>
                    <Copy />
                  </IconButton>
                </div>
                <p className="mt-2 text-[13px] text-fg-secondary">
                  In your banking or wallet app choose Bill payment, then 1Bill Invoice or Voucher, and enter this number. The
                  amount is {rupees(invoice.totalDue)}. The voucher is marked paid as soon as your bank confirms it.
                </p>
                {options.data?.mode === "mock" && (
                  <Button className="mt-3" size="sm" variant="secondary" onClick={() => router.push(`/parent/pay/${onebill.checkoutId}`)}>
                    Simulate paying from a banking app
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {providers.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={starting !== null}
                    onClick={() => payOnline(p)}
                    aria-describedby={`pay-hint-${p}`}
                    className="flex flex-col items-start gap-1 rounded-xl border border-border bg-surface p-3 text-left transition hover:border-primary/40 hover:bg-primary-tint focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-fg [&_svg]:size-4 [&_svg]:text-brand">
                      {p === "ONEBILL" ? <Hash /> : p === "JAZZCASH" ? <CreditCard /> : <Smartphone />}
                      {starting === p ? "Starting..." : PROVIDER_LABEL[p]}
                    </span>
                    <span id={`pay-hint-${p}`} className="text-xs text-fg-muted">
                      {PROVIDER_HINT[p]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null)}

        {onlineAllowed && providers.length > 0 && <h3 className="text-sm font-semibold text-fg">Or pay another way</h3>}
        <ol className="flex flex-col gap-3" aria-label="Ways to pay">
          {ways.map((w) => (
            <li key={w.title} className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-brand [&_svg]:size-4" aria-hidden>
                {w.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg">{w.title}</div>
                <p className="text-[13px] text-fg-secondary">{w.steps}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-[13px] text-fg-muted">
          {onlineAllowed && providers.length > 0
            ? "Online payments clear the voucher straight away. For other ways, the school office marks it paid once your payment reaches them; keep the receipt or transaction ID until then."
            : "The school office marks the voucher as paid once your payment reaches them. Keep the receipt or transaction ID until then."}
        </p>
      </div>
    </Dialog>
  );
}
