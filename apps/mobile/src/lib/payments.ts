import { api } from './api';

/** Shapes of the online fee payment endpoints (apps/api/src/fees/online-payments.*). */

export type OnlineProvider = 'JAZZCASH' | 'EASYPAISA' | 'ONEBILL';
export type CheckoutStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REVIEW';

export interface PaymentOptions {
  /** "mock": no gateway is called; the app plays the gateway's part. */
  mode: 'mock' | 'sandbox' | 'live' | 'off';
  providers: OnlineProvider[];
}

export interface CheckoutDetail {
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
  school: { name: string; city: string | null; phone: string | null };
  invoice: { id: string; voucherNo: string; period: string; balance: number };
  student: { name: string; admissionNo: string };
  receipt: { receiptNo: string; receivedAt: string; reference: string | null } | null;
}

export type GatewayForm = { kind: 'form'; url: string; fields: Record<string, string> };
export type CheckoutAction = GatewayForm | { kind: 'onebill'; consumerNumber: string } | { kind: 'mock' };

/** GET /parent/invoices/:id (the parts the pay screen uses). */
export interface ParentInvoice {
  id: string;
  voucherNo: string;
  period: string;
  dueDate: string;
  displayStatus: string;
  school: { name: string; phone: string | null };
  student: { id: string; name: string; admissionNo: string };
  breakdown: { lateFine: number; balance: number; totalDue: number };
}

export const PROVIDER_LABEL: Record<OnlineProvider, string> = { JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', ONEBILL: '1Bill' };

export const PROVIDER_HINT: Record<OnlineProvider, string> = {
  JAZZCASH: "Mobile account or debit card, on JazzCash's secure page",
  EASYPAISA: "Easypaisa mobile account, on Easypaisa's secure page",
  ONEBILL: 'Get a 1Bill number to pay from any banking or wallet app',
};

export const CHECKOUT_LABEL: Record<CheckoutStatus, string> = {
  PENDING: 'Waiting',
  PAID: 'Paid',
  FAILED: 'Not completed',
  REVIEW: 'Needs review',
};
export const CHECKOUT_TONE = { PENDING: 'amber', PAID: 'green', FAILED: 'red', REVIEW: 'blue' } as const;

export function startCheckout(invoiceId: string, provider: OnlineProvider) {
  return api<{ checkout: { id: string }; action: CheckoutAction }>(`/parent/invoices/${invoiceId}/checkout`, {
    method: 'POST',
    body: { provider },
  });
}

/** "1234 5678 9012 345": a 1Bill number grouped for reading out. */
export const groupDigits = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * Signed gateway forms waiting for the gateway screen, by checkout id. Kept in
 * memory rather than in route params so the hash never sits in navigation state.
 */
export const pendingForms = new Map<string, GatewayForm>();

/** A page that posts the signed form straight on to the gateway's hosted checkout. */
export function gatewayPage(form: GatewayForm, title: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const inputs = Object.entries(form.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head><body onload="document.forms[0].submit()" style="font-family:sans-serif;padding:24px;color:#64748b">
<form method="post" action="${esc(form.url)}">${inputs}<noscript><button type="submit">Continue</button></noscript></form>
<p>Taking you to ${esc(title)}...</p></body></html>`;
}

/**
 * Whether the gateway has sent the parent back: the API answers every return
 * with a redirect to the portal's /parent/invoices page carrying ?payment=.
 */
export const isReturnUrl = (url: string) => /\/parent\/invoices(\/[^?#]*)?\?(.*&)?payment=/.test(url);
