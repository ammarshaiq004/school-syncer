/** Shapes of GET /parent/invoices and GET /parent/invoices/:id. */

/** CARRIED_FORWARD: the balance moved onto a later voucher and is paid there. */
export type ParentInvoiceDisplay = "PAID" | "PENDING" | "OVERDUE" | "CARRIED_FORWARD";

export interface ParentInvoiceRow {
  id: string;
  voucherNo: string;
  period: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paid: number;
  /** Date of the most recent payment, if any. */
  paidAt: string | null;
  balance: number;
  lateFine: number;
  /** Balance plus late fine; 0 when paid. */
  totalDue: number;
  status: string;
  displayStatus: ParentInvoiceDisplay;
  student: { id: string; name: string; admissionNo: string; className: string | null };
}

export interface ParentInvoiceList {
  items: ParentInvoiceRow[];
  summary: { totalDue: number; pendingCount: number; overdueCount: number; paidCount: number };
}

export interface ParentInvoiceDetail {
  id: string;
  voucherNo: string;
  period: string;
  issueDate: string;
  dueDate: string;
  status: string;
  displayStatus: ParentInvoiceDisplay;
  school: { name: string; city: string | null; phone: string | null; email: string | null; logoUrl: string | null; currency: string };
  student: { id: string; name: string; admissionNo: string; className: string | null };
  lines: { id: string; description: string; amount: number; feeHeadId: string | null }[];
  breakdown: { subtotal: number; discounts: number; lateFine: number; total: number; paid: number; balance: number; totalDue: number };
  payments: {
    id: string;
    amount: number;
    method: string;
    reference: string | null;
    receiptNo: string;
    receivedAt: string;
    /** Set when the payment came through online checkout; its receipt page is /parent/payments/:checkoutId. */
    checkoutId: string | null;
  }[];
}

export const PARENT_INVOICE_LABEL: Record<ParentInvoiceDisplay, string> = {
  PAID: "Paid",
  PENDING: "Pending",
  OVERDUE: "Overdue",
  CARRIED_FORWARD: "Carried forward",
};
export const PARENT_INVOICE_TONE = { PAID: "success", PENDING: "warning", OVERDUE: "danger", CARRIED_FORWARD: "neutral" } as const;
