import { createHmac, timingSafeEqual } from 'node:crypto';
import { pkTimestamp, type GatewayConfig } from './gateway-config.js';
import { rupeesFromPaisa, type CheckoutAction, type GatewayResult } from './gateway-types.js';

/**
 * JazzCash "HTTP POST page redirection" (API v1.1). The parent's browser posts
 * the signed form to JazzCash's hosted checkout; JazzCash posts the result back
 * to pp_ReturnURL, signed the same way. pp_Amount is in paisa.
 *
 * pp_SecureHash is HMAC-SHA256, keyed with the integrity salt, over the salt
 * followed by every non-empty pp_ field's value, ordered by field name and
 * joined with "&"; hex, upper case.
 */
export function jazzcashHash(fields: Record<string, string | undefined>, salt: string): string {
  const values = Object.keys(fields)
    .filter((k) => (k.startsWith('pp_') || k.startsWith('ppmpf_')) && k !== 'pp_SecureHash')
    .sort()
    .map((k) => fields[k])
    .filter((v): v is string => v !== undefined && v !== '');
  return createHmac('sha256', salt).update([salt, ...values].join('&')).digest('hex').toUpperCase();
}

export interface JazzcashCheckout {
  txnRef: string;
  amount: number;
  billReference: string;
  description: string;
  createdAt: Date;
  expiresAt: Date;
}

export function jazzcashCheckout(c: GatewayConfig, p: JazzcashCheckout): CheckoutAction & { kind: 'form' } {
  const fields: Record<string, string> = {
    pp_Version: '1.1',
    pp_TxnType: '',
    pp_Language: 'EN',
    pp_MerchantID: c.jazzcash.merchantId,
    pp_SubMerchantID: '',
    pp_Password: c.jazzcash.password,
    pp_BankID: '',
    pp_ProductID: '',
    pp_TxnRefNo: p.txnRef,
    pp_Amount: String(p.amount * 100),
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: pkTimestamp(p.createdAt),
    pp_BillReference: p.billReference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20),
    pp_Description: p.description.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 100),
    pp_TxnExpiryDateTime: pkTimestamp(p.expiresAt),
    pp_ReturnURL: `${c.apiUrl}/api/payments/return/jazzcash`,
    ppmpf_1: '',
    ppmpf_2: '',
    ppmpf_3: '',
    ppmpf_4: '',
    ppmpf_5: '',
  };
  fields.pp_SecureHash = jazzcashHash(fields, c.jazzcash.integritySalt);
  return { kind: 'form', url: c.jazzcash.url, fields };
}

/** JazzCash codes that mean the money was taken. */
const PAID = new Set(['000', '121']);
/** Accepted but not settled yet: voucher to be paid at a shop, or a wallet prompt still open. */
const PENDING = new Set(['124', '157']);

/**
 * Checks a JazzCash return post. Returns null when the hash is wrong or the
 * post is for another merchant, so nothing in it can be trusted.
 */
export function jazzcashVerify(c: GatewayConfig, body: Record<string, unknown>): GatewayResult | null {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') fields[k] = v;
  const given = fields.pp_SecureHash ?? '';
  const expected = jazzcashHash(fields, c.jazzcash.integritySalt);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given.toUpperCase()), Buffer.from(expected))) {
    return null;
  }
  if (fields.pp_MerchantID !== c.jazzcash.merchantId || !fields.pp_TxnRefNo) return null;
  const code = fields.pp_ResponseCode ?? '';
  return {
    txnRef: fields.pp_TxnRefNo,
    outcome: PAID.has(code) ? 'PAID' : PENDING.has(code) ? 'PENDING' : 'FAILED',
    amount: rupeesFromPaisa(fields.pp_Amount),
    providerRef: fields.pp_RetreivalReferenceNo || fields.pp_AuthCode || undefined,
    responseCode: code,
    message: fields.pp_ResponseMessage,
  };
}

/** Mock mode: the return post JazzCash would send for a checkout, signed with the mock salt. */
export function jazzcashMockReturn(
  c: GatewayConfig,
  p: { txnRef: string; amount: number; approve: boolean; at: Date },
): Record<string, string> {
  const fields: Record<string, string> = {
    pp_Version: '1.1',
    pp_TxnType: 'MWALLET',
    pp_Language: 'EN',
    pp_MerchantID: c.jazzcash.merchantId,
    pp_SubMerchantID: '',
    pp_BankID: '',
    pp_ProductID: '',
    pp_TxnRefNo: p.txnRef,
    pp_Amount: String(p.amount * 100),
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: pkTimestamp(p.at),
    pp_ResponseCode: p.approve ? '000' : '199',
    pp_ResponseMessage: p.approve ? 'Thank you for Using JazzCash, your transaction was successful.' : 'Transaction declined by the customer.',
    pp_RetreivalReferenceNo: p.approve ? `MOCK${p.at.getTime().toString().slice(-8)}` : '',
    pp_AuthCode: '',
    pp_SettlementExpiry: '',
  };
  fields.pp_SecureHash = jazzcashHash(fields, c.jazzcash.integritySalt);
  return fields;
}

/**
 * Transaction Status Inquiry: asks JazzCash what happened to one checkout,
 * for returns that never reached us (the parent closed the browser). The
 * request and the answer are signed like the checkout form.
 */
export function jazzcashInquiryRequest(c: GatewayConfig, txnRef: string) {
  const body: Record<string, string> = {
    pp_TxnRefNo: txnRef,
    pp_MerchantID: c.jazzcash.merchantId,
    pp_Password: c.jazzcash.password,
  };
  body.pp_SecureHash = jazzcashHash(body, c.jazzcash.integritySalt);
  return { url: c.jazzcash.inquiryUrl, headers: { 'Content-Type': 'application/json' }, body };
}

/**
 * Reads an inquiry answer. pp_ResponseCode is about the inquiry itself;
 * pp_PaymentResponseCode is the checkout's own result, in the same codes the
 * return post uses. Null when the answer is not signed by this merchant.
 */
export function jazzcashInquiryResult(c: GatewayConfig, txnRef: string, body: Record<string, unknown>): GatewayResult | null {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') fields[k] = v;
  const given = (fields.pp_SecureHash ?? '').toUpperCase();
  const expected = jazzcashHash(fields, c.jazzcash.integritySalt);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  if (fields.pp_ResponseCode !== '000') {
    // Unknown reference or the inquiry failed: nothing is settled by it.
    return { txnRef, outcome: 'PENDING', responseCode: fields.pp_ResponseCode, message: fields.pp_ResponseMessage };
  }
  const code = fields.pp_PaymentResponseCode ?? '';
  return {
    txnRef,
    outcome: PAID.has(code) ? 'PAID' : PENDING.has(code) || code === '' ? 'PENDING' : 'FAILED',
    amount: rupeesFromPaisa(fields.pp_Amount),
    providerRef: fields.pp_RetreivalReferenceNo || fields.pp_AuthCode || undefined,
    responseCode: code,
    message: fields.pp_PaymentResponseMessage || fields.pp_ResponseMessage,
  };
}

/** Calls Status Inquiry (sandbox or live). Never used in mock mode. */
export async function jazzcashInquire(c: GatewayConfig, txnRef: string): Promise<GatewayResult | null> {
  const req = jazzcashInquiryRequest(c, txnRef);
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { txnRef, outcome: 'PENDING', message: `JazzCash inquiry returned HTTP ${res.status}` };
  return jazzcashInquiryResult(c, txnRef, (await res.json()) as Record<string, unknown>);
}

/** What JazzCash expects back from our IPN listener, signed. */
export function jazzcashIpnAck(c: GatewayConfig, ok: boolean): Record<string, string> {
  const body: Record<string, string> = {
    pp_ResponseCode: ok ? '000' : '001',
    pp_ResponseMessage: ok ? 'IPN received' : 'IPN rejected',
  };
  body.pp_SecureHash = jazzcashHash(body, c.jazzcash.integritySalt);
  return body;
}
