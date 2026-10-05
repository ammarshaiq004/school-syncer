/** Shapes of GET /parent/invoices and GET /parent/invoices/:id. */

export type ParentInvoiceDisplay = "PAID" | "PENDING" | "OVERDUE";

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
  payments: { id: string; amount: number; method: string; reference: string | null; receiptNo: string; receivedAt: string }[];
}

export const PARENT_INVOICE_LABEL: Record<ParentInvoiceDisplay, string> = { PAID: "Paid", PENDING: "Pending", OVERDUE: "Overdue" };
export const PARENT_INVOICE_TONE = { PAID: "success", PENDING: "warning", OVERDUE: "danger" } as const;
