import { createCipheriv } from 'node:crypto';
import { pkTimestamp, type GatewayConfig } from './gateway-config.js';
import type { CheckoutAction, GatewayResult } from './gateway-types.js';

/**
 * Easypaisa "Easypay" hosted checkout. The browser posts the order to
 * Index.jsf; Easypaisa sends it back to postBackURL with an auth_token, which
 * we post to Confirm.jsf; after payment the browser returns to the second
 * postBackURL with status and orderRefNumber.
 *
 * Nothing in those browser redirects (or in Easypaisa's IPN ping) is signed,
 * so a checkout is only marked paid after the authenticated Inquire
 * Transaction API confirms it.
 *
 * merchantHashedReq is AES-128-ECB (PKCS#5) of "key=value&..." over the
 * request fields in name order, keyed with the store's hash key, base64.
 */
export function easypaisaHashedRequest(fields: Record<string, string>, hashKey: string): string {
  const plain = Object.keys(fields)
    .filter((k) => k !== 'merchantHashedReq' && fields[k] !== '')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('&');
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(hashKey, 'utf8').subarray(0, 16), null);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

/** "20261005 143000": Easypaisa's expiry format, Pakistan time. */
const expiryFormat = (at: Date) => {
  const t = pkTimestamp(at);
  return `${t.slice(0, 8)} ${t.slice(8)}`;
};

export function easypaisaCheckout(
  c: GatewayConfig,
  p: { txnRef: string; amount: number; expiresAt: Date; mobile?: string; email?: string },
): CheckoutAction & { kind: 'form' } {
  const fields: Record<string, string> = {
    storeId: c.easypaisa.storeId,
    amount: p.amount.toFixed(1),
    postBackURL: `${c.apiUrl}/api/payments/return/easypaisa`,
    orderRefNum: p.txnRef,
    expiryDate: expiryFormat(p.expiresAt),
    autoRedirect: '1',
    paymentMethod: 'MA_PAYMENT_METHOD',
    emailAddr: p.email ?? '',
    mobileNum: p.mobile ?? '',
  };
  fields.merchantHashedReq = easypaisaHashedRequest(fields, c.easypaisa.hashKey);
  return { kind: 'form', url: c.easypaisa.checkoutUrl, fields };
}

/** Second leg: the form that hands Easypaisa's auth_token back to Confirm.jsf. */
export function easypaisaConfirm(c: GatewayConfig, authToken: string): CheckoutAction & { kind: 'form' } {
  return {
    kind: 'form',
    url: c.easypaisa.checkoutUrl.replace(/Index\.jsf$/, 'Confirm.jsf'),
    fields: { auth_token: authToken, postBackURL: `${c.apiUrl}/api/payments/return/easypaisa/done` },
  };
}

/** The Inquire Transaction request for one order. */
export function easypaisaInquiryRequest(c: GatewayConfig, orderRef: string) {
  return {
    url: c.easypaisa.inquiryUrl,
    headers: {
      'Content-Type': 'application/json',
      Credentials: Buffer.from(`${c.easypaisa.username}:${c.easypaisa.password}`).toString('base64'),
    },
    body: { orderId: orderRef, storeId: c.easypaisa.storeId, accountNum: c.easypaisa.accountNum },
  };
}

export interface EasypaisaInquiryResponse {
  responseCode?: string;
  responseDesc?: string;
  orderId?: string;
  storeId?: string | number;
  transactionId?: string;
  transactionStatus?: string;
  transactionAmount?: string | number;
}

/** Reads an Inquire Transaction response. Null when it is about another order or store. */
export function easypaisaResult(c: GatewayConfig, orderRef: string, r: EasypaisaInquiryResponse): GatewayResult | null {
  if (r.responseCode !== '0000') {
    // The inquiry itself failed (unknown order, bad credentials); nothing is settled yet.
    return { txnRef: orderRef, outcome: 'PENDING', responseCode: r.responseCode, message: r.responseDesc };
  }
  if (r.orderId !== orderRef || String(r.storeId) !== c.easypaisa.storeId) return null;
  const status = (r.transactionStatus ?? '').toUpperCase();
  const amount = r.transactionAmount === undefined ? undefined : Number(r.transactionAmount);
  return {
    txnRef: orderRef,
    outcome: status === 'PAID' ? 'PAID' : status === 'FAILED' || status === 'REVERSED' || status === 'EXPIRED' ? 'FAILED' : 'PENDING',
    amount: Number.isFinite(amount) ? amount : undefined,
    providerRef: r.transactionId || undefined,
    responseCode: status,
    message: r.responseDesc,
  };
}

/** Calls Inquire Transaction (sandbox or live). Never used in mock mode. */
export async function easypaisaInquire(c: GatewayConfig, orderRef: string): Promise<GatewayResult | null> {
  const req = easypaisaInquiryRequest(c, orderRef);
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { txnRef: orderRef, outcome: 'PENDING', message: `Easypaisa inquiry returned HTTP ${res.status}` };
  return easypaisaResult(c, orderRef, (await res.json()) as EasypaisaInquiryResponse);
}
