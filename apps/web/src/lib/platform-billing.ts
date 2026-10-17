/**
 * SchoolSyncer's own billing of schools: shapes the API returns and the small
 * rules both the console and the school's Plan and billing page use. Pure, so
 * it can be unit tested without a browser.
 *
 * A bill stays UNPAID until payments cover it in full; "part paid" is an
 * UNPAID bill with amountPaid > 0. What is still owed on a bill is
 * amount - amountPaid.
 */

export type PlatformBillStatus = "UNPAID" | "PAID" | "VOID";
export type PlatformPaymentStatus = "RECORDED" | "VOID";
export type NoticeSeverity = "INFO" | "WARNING" | "URGENT";

export interface PlatformBill {
  id: string;
  number: string;
  period: string;
  planName: string;
  students: number;
  /** Total due, tax included. */
  amount: number;
  taxPercent: number;
  taxAmount: number;
  amountPaid: number;
  status: PlatformBillStatus;
  dueDate: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface PlatformPayment {
  id: string;
  number: string;
  amount: number;
  method: string;
  reference: string | null;
  receivedOn: string;
  note: string | null;
  status: PlatformPaymentStatus;
  voidReason: string | null;
  voidedAt: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** SchoolSyncer's business details printed on bills and receipts (GET settings). */
export interface PlatformSettings {
  businessName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  ntn: string | null;
  strn: string | null;
  /** Sales tax added to new bills; null while tax is off. */
  salesTaxPercent: number | null;
  paymentInstructions: string | null;
  updatedAt?: string;
}

/** The school's details on a printable bill or receipt. */
export interface BilledSchool {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  phone: string | null;
  email: string | null;
}

/** GET invoices/:id (console and school side). */
export interface BillDocument {
  invoice: PlatformBill & {
    school: BilledSchool;
    allocations: {
      id: string;
      amount: number;
      payment: { id: string; number: string; receivedOn: string; method: string; status: PlatformPaymentStatus };
    }[];
  };
  settings: PlatformSettings;
}

/** GET payments/:id (console and school side). */
export interface ReceiptDocument {
  payment: PlatformPayment & {
    school: BilledSchool;
    allocations: { id: string; amount: number; invoice: { id: string; number: string; period: string; amount: number } }[];
  };
  settings: PlatformSettings;
}

export interface PlatformNotice {
  id: string;
  kind: string;
  severity: NoticeSeverity;
  title: string;
  body: string;
  invoiceId: string | null;
  paymentId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** How SchoolSyncer staff record the way a school paid. */
export const PAYMENT_METHODS = ["Bank transfer", "JazzCash", "Easypaisa", "Cash", "Cheque", "Other"] as const;

/** What is still owed on a bill: nothing on a paid or void bill. */
export function billOwed(bill: Pick<PlatformBill, "amount" | "amountPaid" | "status">): number {
  if (bill.status !== "UNPAID") return 0;
  return Math.max(0, bill.amount - bill.amountPaid);
}

export type BillState = "PAID" | "PART_PAID" | "UNPAID" | "OVERDUE" | "VOID";

/**
 * Where a bill stands for display. An unpaid bill past its due date is
 * overdue whether or not part of it is paid; otherwise money towards it
 * makes it part paid. `today` is YYYY-MM-DD.
 */
export function billState(bill: Pick<PlatformBill, "amount" | "amountPaid" | "status" | "dueDate">, today: string): BillState {
  if (bill.status === "PAID" || bill.status === "VOID") return bill.status;
  if (bill.dueDate.slice(0, 10) < today) return "OVERDUE";
  return bill.amountPaid > 0 ? "PART_PAID" : "UNPAID";
}

export const BILL_STATE: Record<BillState, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  PAID: { label: "Paid", tone: "success" },
  PART_PAID: { label: "Part paid", tone: "info" },
  UNPAID: { label: "Unpaid", tone: "warning" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  VOID: { label: "Void", tone: "neutral" },
};

/** Total still owed across bills. */
export const totalOwed = (bills: Pick<PlatformBill, "amount" | "amountPaid" | "status">[]) => bills.reduce((sum, b) => sum + billOwed(b), 0);

/** The lines under SchoolSyncer's name on a bill: address, contact, and tax numbers only when set. */
export function businessLines(s: PlatformSettings): string[] {
  const contact = [s.phone, s.email].map((v) => v?.trim()).filter(Boolean).join(" | ");
  const tax = [s.ntn?.trim() && `NTN ${s.ntn.trim()}`, s.strn?.trim() && `STRN ${s.strn.trim()}`].filter(Boolean).join(" | ");
  return [s.address?.trim(), contact, tax].filter((l): l is string => !!l);
}

/** The school's city and contact lines on a bill or receipt (schools have no stored street address). */
export function schoolLines(s: BilledSchool): string[] {
  const contact = [s.phone, s.email].map((v) => v?.trim()).filter(Boolean).join(" | ");
  return [s.city?.trim() ?? "", contact].filter(Boolean);
}

/**
 * Reads the sales tax box on the settings page: empty means tax is off
 * (null); otherwise a whole percent from 1 to 50. Returns an error message
 * for anything else.
 */
export function parseTaxPercent(input: string): { value: number | null } | { error: string } {
  const text = input.trim().replace(/%$/, "").trim();
  if (!text) return { value: null };
  if (!/^\d+$/.test(text)) return { error: "Enter a whole number, like 16." };
  const n = Number(text);
  if (n < 1 || n > 50) return { error: "Use a percent from 1 to 50, or switch tax off." };
  return { value: n };
}

/** Banner and list tone for a notice's severity. */
export const noticeTone = (severity: NoticeSeverity) => (severity === "URGENT" ? "danger" : severity === "WARNING" ? "warning" : "info");

