"use client";

import { Building, Copy, Landmark, Smartphone, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Button, Dialog, IconButton, useToast } from "@/components/kit";
import { day, rupees } from "@/lib/format";

export interface PayDuesInvoice {
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
 * "Pay dues": how a parent can pay a voucher today (bank, JazzCash, Easypaisa, 1Bill or the
 * school counter), keyed on the voucher number. Online checkout is not built yet.
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
  const ref = invoice.voucherNo;

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(ref);
      toast.success("Voucher number copied", ref);
    } catch {
      toast.error("Could not copy", `Please note down voucher no. ${ref}.`);
    }
  }

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
          The school office marks the voucher as paid once your payment reaches them. Keep the receipt or transaction ID until then.
        </p>

        <Alert tone="info" title="Online payment is coming soon">
          You will be able to pay by card or wallet right here. For now, please use one of the options above.
        </Alert>
      </div>
    </Dialog>
  );
}
