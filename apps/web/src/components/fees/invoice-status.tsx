import { StatusPill } from "@/components/kit";
import { todayIso } from "@/lib/format";

export type InvoiceDisplay = "PAID" | "PENDING" | "PARTIAL" | "OVERDUE" | "CANCELLED";

/**
 * What a fee voucher looks like to a person: Paid, Pending (unpaid and not yet due),
 * Partially paid, Overdue (money still owed after the due date) or Cancelled.
 */
export function invoiceDisplay(inv: { status: string; dueDate: string }): InvoiceDisplay {
  if (inv.status === "PAID") return "PAID";
  if (inv.status === "CANCELLED") return "CANCELLED";
  if (inv.dueDate.slice(0, 10) < todayIso()) return "OVERDUE";
  return inv.status === "PARTIAL" ? "PARTIAL" : "PENDING";
}

const PILL: Record<InvoiceDisplay, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PAID: { label: "Paid", tone: "success" },
  PENDING: { label: "Pending", tone: "warning" },
  PARTIAL: { label: "Partially paid", tone: "warning" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function InvoiceStatusPill({ invoice, className }: { invoice: { status: string; dueDate: string }; className?: string }) {
  const d = invoiceDisplay(invoice);
  return <StatusPill status={d} tone={PILL[d].tone} label={PILL[d].label} className={className} />;
}
