import { api } from "@/lib/api";

/** Shapes of the online fee payment endpoints (apps/api/src/fees/online-payments.*). */

export type OnlineProvider = "JAZZCASH" | "EASYPAISA" | "ONEBILL";
export type CheckoutStatus = "PENDING" | "PAID" | "FAILED" | "REVIEW";

export interface PaymentOptions {
  /** "mock": checkouts open the portal's sandbox page instead of a real gateway. */
  mode: "mock" | "sandbox" | "live" | "off";
  providers: OnlineProvider[];
}

export interface Checkout {
  id: string;
  invoiceId: string;
  provider: OnlineProvider;
  amount: number;
  status: CheckoutStatus;
  /** Still open but past its time; the gateway will no longer take it. */
  expired: boolean;
  txnRef: string;
  consumerNumber: string | null;
  providerRef: string | null;
  message: string | null;
  receiptNo: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CheckoutDetail extends Checkout {
  school: { name: string; city: string | null; phone: string | null };
  invoice: { id: string; voucherNo: string; period: string; balance: number };
  student: { name: string; admissionNo: string };
  receipt: { receiptNo: string; receivedAt: string; reference: string | null } | null;
}

export type CheckoutAction =
  | { kind: "form"; url: string; fields: Record<string, string> }
  | { kind: "onebill"; consumerNumber: string }
  | { kind: "mock" };

export const PROVIDER_LABEL: Record<OnlineProvider, string> = { JAZZCASH: "JazzCash", EASYPAISA: "Easypaisa", ONEBILL: "1Bill" };

export const PROVIDER_HINT: Record<OnlineProvider, string> = {
  JAZZCASH: "Mobile account or debit card, on JazzCash's secure page",
  EASYPAISA: "Easypaisa mobile account, on Easypaisa's secure page",
  ONEBILL: "Get a 1Bill number to pay from any banking or wallet app",
};

export const CHECKOUT_LABEL: Record<CheckoutStatus, string> = {
  PENDING: "Waiting",
  PAID: "Paid",
  FAILED: "Not completed",
  REVIEW: "Needs review",
};
export const CHECKOUT_TONE = { PENDING: "warning", PAID: "success", FAILED: "danger", REVIEW: "info" } as const;

export function startCheckout(invoiceId: string, provider: OnlineProvider) {
  return api<{ checkout: Checkout; action: CheckoutAction }>(`/parent/invoices/${invoiceId}/checkout`, {
    method: "POST",
    body: { provider },
  });
}

/** Sends the browser to a gateway's hosted checkout by posting its signed form. */
export function postToGateway(action: { url: string; fields: Record<string, string> }) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action.url;
  for (const [name, value] of Object.entries(action.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** "1234 5678 9012 345": a 1Bill number grouped for reading out. */
export const groupDigits = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");
