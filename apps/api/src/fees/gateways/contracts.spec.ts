import { createDecipheriv, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gatewayConfig } from './gateway-config.js';
import { easypaisaCheckout, easypaisaConfirm, easypaisaInquiryRequest, easypaisaResult, type EasypaisaInquiryResponse } from './easypaisa.js';
import {
  jazzcashCheckout,
  jazzcashHash,
  jazzcashInquiryRequest,
  jazzcashInquiryResult,
  jazzcashIpnAck,
  jazzcashVerify,
} from './jazzcash.js';
import { ONEBILL, onebillAmount, onebillAuthorised, onebillInquiryResponse, onebillRupees } from './onebill.js';
import { easypaisaProbeVerdict, jazzcashProbeVerdict } from './connection-check.js';

/**
 * Contract tests (SCHOOL-149): the request and response formats of each
 * gateway, pinned with sample payloads in ./samples, so a change to field
 * names, signing, amounts or code handling fails here without any network.
 * The hash inputs in the samples are written out by hand from the providers'
 * descriptions, so they check our signing independently of our own code.
 */
const sample = (name: string) => JSON.parse(readFileSync(new URL(`./samples/${name}.json`, import.meta.url), 'utf8'));
const jc = sample('jazzcash');
const ep = sample('easypaisa');
const ob = sample('onebill');

const config = gatewayConfig({
  PAYMENTS_MODE: 'sandbox',
  API_PUBLIC_URL: 'https://api.example.pk',
  JAZZCASH_MERCHANT_ID: jc.credentials.merchantId,
  JAZZCASH_PASSWORD: jc.credentials.password,
  JAZZCASH_INTEGRITY_SALT: jc.credentials.integritySalt,
  EASYPAISA_STORE_ID: ep.credentials.storeId,
  EASYPAISA_HASH_KEY: ep.credentials.hashKey,
  EASYPAISA_USERNAME: ep.credentials.username,
  EASYPAISA_PASSWORD: ep.credentials.password,
  EASYPAISA_ACCOUNT_NUM: ep.credentials.accountNum,
  ONEBILL_BILLER_PREFIX: ob.credentials.billerPrefix,
  ONEBILL_USERNAME: ob.credentials.username,
  ONEBILL_PASSWORD: ob.credentials.password,
});
const salt = jc.credentials.integritySalt as string;
const hmac = (text: string) => createHmac('sha256', salt).update(text).digest('hex').toUpperCase();
const signed = (fields: Record<string, string>) => ({ ...fields, pp_SecureHash: jazzcashHash(fields, salt) });

describe('JazzCash contract', () => {
  it('builds the page redirection form with exactly the documented fields and hash', () => {
    const p = jc.checkout.params;
    const form = jazzcashCheckout(config, { ...p, createdAt: new Date(p.createdAt), expiresAt: new Date(p.expiresAt) });
    expect(form.url).toBe('https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/');
    const { pp_SecureHash, ...fields } = form.fields;
    expect(fields).toEqual(jc.checkout.fields);
    expect(Object.keys(fields)).toEqual(Object.keys(jc.checkout.fields));
    expect(pp_SecureHash).toBe(jc.checkout.secureHash);
    // The documented recipe, spelled out by hand: salt, then the non-empty values in field-name order.
    expect(hmac(jc.checkout.hashInput)).toBe(jc.checkout.secureHash);
  });

  it('accepts the signed return post and reads amount and reference', () => {
    const body = { ...jc.return.fields, pp_SecureHash: jc.return.secureHash };
    expect(jazzcashHash(jc.return.fields, salt)).toBe(jc.return.secureHash);
    expect(jazzcashVerify(config, body)).toEqual({
      txnRef: 'T1EXAMPLE0000000001',
      outcome: 'PAID',
      amount: 10,
      providerRef: '261015123456',
      responseCode: '000',
      message: jc.return.fields.pp_ResponseMessage,
    });
    // JazzCash may send the hash in lower case.
    expect(jazzcashVerify(config, { ...body, pp_SecureHash: jc.return.secureHash.toLowerCase() })?.outcome).toBe('PAID');
  });

  it.each(Object.entries(jc.return.codes as Record<string, { outcome: string; message: string }>))(
    'maps return code %s to its outcome',
    (code, { outcome, message }) => {
      const body = signed({ ...jc.return.fields, pp_ResponseCode: code, pp_ResponseMessage: message });
      expect(jazzcashVerify(config, body)).toMatchObject({ outcome, responseCode: code });
    },
  );

  it('refuses tampered, unsigned or foreign return posts', () => {
    const body = { ...jc.return.fields, pp_SecureHash: jc.return.secureHash };
    expect(jazzcashVerify(config, { ...body, pp_Amount: '100' })).toBeNull();
    expect(jazzcashVerify(config, { ...body, pp_ResponseCode: '000', pp_SecureHash: '' })).toBeNull();
    expect(jazzcashVerify(config, signed({ ...jc.return.fields, pp_MerchantID: 'MC99999' }))).toBeNull();
    expect(jazzcashVerify(config, signed({ ...jc.return.fields, pp_TxnRefNo: '' }))).toBeNull();
  });

  it('a repeated return post gives the same verified result', () => {
    const body = { ...jc.return.fields, pp_SecureHash: jc.return.secureHash };
    expect(jazzcashVerify(config, body)).toEqual(jazzcashVerify(config, { ...body }));
  });

  it('sends the Status Inquiry with the documented fields and hash', () => {
    const req = jazzcashInquiryRequest(config, 'T1EXAMPLE0000000001');
    expect(req.url).toBe('https://sandbox.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire');
    expect(req.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(req.body).toEqual({ ...jc.inquiry.request, pp_SecureHash: jc.inquiry.secureHash });
    expect(hmac(jc.inquiry.hashInput)).toBe(jc.inquiry.secureHash);
  });

  it('reads Status Inquiry answers: paid, not found, unsigned', () => {
    expect(jazzcashInquiryResult(config, 'T1EXAMPLE0000000001', signed(jc.inquiry.paid))).toMatchObject({
      outcome: 'PAID',
      amount: 10,
      providerRef: '261015123456',
      responseCode: '121',
    });
    expect(jazzcashInquiryResult(config, 'T1EXAMPLE0000000001', signed(jc.inquiry.notFound))).toMatchObject({
      outcome: 'PENDING',
      responseCode: '110',
    });
    expect(jazzcashInquiryResult(config, 'T1EXAMPLE0000000001', jc.inquiry.paid)).toBeNull();
    const declined = signed({ ...jc.inquiry.paid, pp_PaymentResponseCode: '199', pp_PaymentResponseMessage: 'Declined' });
    expect(jazzcashInquiryResult(config, 'T1EXAMPLE0000000001', declined)?.outcome).toBe('FAILED');
  });

  it('answers IPNs in the signed acknowledgement format', () => {
    expect(jazzcashIpnAck(config, true)).toEqual(signed(jc.ipnAck.ok));
    expect(jazzcashIpnAck(config, false)).toEqual(signed(jc.ipnAck.rejected));
  });

  it('reads a "Test connection" probe: a signed not found passes, the rest fail with a hint', () => {
    const pass = jazzcashProbeVerdict(config, signed(jc.inquiry.notFound));
    expect(pass).toMatchObject({ ok: true, code: '110', message: 'Transaction not found.' });
    const badCreds = jazzcashProbeVerdict(config, signed(jc.inquiry.badCredentials));
    expect(badCreds).toMatchObject({ ok: false, code: '101' });
    expect(badCreds.hint).toMatch(/merchant ID or password/);
    const unsigned = jazzcashProbeVerdict(config, jc.inquiry.notFound);
    expect(unsigned.ok).toBe(false);
    expect(unsigned.hint).toMatch(/without a signature/);
    const otherSalt = { ...jc.inquiry.notFound, pp_SecureHash: jazzcashHash(jc.inquiry.notFound, 'another-salt') };
    const wrongSalt = jazzcashProbeVerdict(config, otherSalt);
    expect(wrongSalt.ok).toBe(false);
    expect(wrongSalt.hint).toMatch(/integrity salt/);
    expect(jazzcashProbeVerdict(config, 'not json').ok).toBe(false);
    // Nothing secret ever comes back.
    for (const v of [pass, badCreds, unsigned, wrongSalt]) {
      expect(JSON.stringify(v)).not.toContain(jc.credentials.password);
      expect(JSON.stringify(v)).not.toContain(salt);
    }
  });
});

describe('Easypaisa contract', () => {
  it('builds the Index.jsf form with the documented fields and encrypted request', () => {
    const p = ep.checkout.params;
    const form = easypaisaCheckout(config, { ...p, expiresAt: new Date(p.expiresAt) });
    expect(form.url).toBe(ep.checkout.url);
    const { merchantHashedReq, ...fields } = form.fields;
    expect(fields).toEqual(ep.checkout.fields);
    expect(merchantHashedReq).toBe(ep.checkout.merchantHashedReq);
    // AES-128-ECB with the hash key over the documented key=value string.
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from(ep.credentials.hashKey, 'utf8'), null);
    const plain = Buffer.concat([decipher.update(Buffer.from(merchantHashedReq, 'base64')), decipher.final()]).toString('utf8');
    expect(plain).toBe(ep.checkout.hashInput);
  });

  it('hands the auth token to Confirm.jsf', () => {
    expect(easypaisaConfirm(config, 'dummy-auth-token')).toEqual({ kind: 'form', ...ep.confirm });
  });

  it('sends Inquire Transaction with the documented URL, Credentials header and body', () => {
    const req = easypaisaInquiryRequest(config, 'T1EXAMPLE0000000002');
    const { responses: _responses, ...documented } = ep.inquiry;
    expect(req).toEqual(documented);
    expect(Buffer.from(req.headers.Credentials, 'base64').toString()).toBe(`${ep.credentials.username}:${ep.credentials.password}`);
  });

  it('maps transaction statuses to outcomes', () => {
    const r = ep.inquiry.responses as Record<string, EasypaisaInquiryResponse>;
    const ref = 'T1EXAMPLE0000000002';
    expect(easypaisaResult(config, ref, r.paid)).toMatchObject({ outcome: 'PAID', amount: 10, providerRef: '20261015000123' });
    expect(easypaisaResult(config, ref, r.pending)?.outcome).toBe('PENDING');
    expect(easypaisaResult(config, ref, r.failed)?.outcome).toBe('FAILED');
    expect(easypaisaResult(config, ref, r.reversed)?.outcome).toBe('FAILED');
    expect(easypaisaResult(config, ref, r.expired)?.outcome).toBe('FAILED');
    // An answer about another store or order is not ours to apply.
    expect(easypaisaResult(config, ref, r.otherStore)).toBeNull();
    expect(easypaisaResult(config, 'TOTHERORDER', r.paid)).toBeNull();
    // A failed inquiry settles nothing.
    expect(easypaisaResult(config, ref, r.orderNotFound)).toMatchObject({ outcome: 'PENDING', responseCode: '0003' });
    expect(easypaisaResult(config, ref, r.systemError)).toMatchObject({ outcome: 'PENDING', responseCode: '0001' });
  });

  it('reads a "Test connection" probe', () => {
    const r = ep.inquiry.responses;
    expect(easypaisaProbeVerdict(config, r.orderNotFound)).toMatchObject({ ok: true, code: '0003' });
    const store = easypaisaProbeVerdict(config, r.storeNotFound);
    expect(store).toMatchObject({ ok: false, code: '0006' });
    expect(store.hint).toMatch(/store ID/);
    expect(easypaisaProbeVerdict(config, { responseCode: '0099', responseDesc: 'NEW CODE' }).hint).toMatch(/API username and password/);
    const shortKey = gatewayConfig({ PAYMENTS_MODE: 'sandbox', EASYPAISA_HASH_KEY: 'short' });
    expect(easypaisaProbeVerdict(shortKey, r.orderNotFound).ok).toBe(false);
    expect(easypaisaProbeVerdict(config, null).ok).toBe(false);
    expect(JSON.stringify(easypaisaProbeVerdict(config, r.orderNotFound))).not.toContain(ep.credentials.hashKey);
  });
});

describe('1Bill contract', () => {
  it('answers bill inquiry with the documented fields and amount format', () => {
    const answer = onebillInquiryResponse({
      consumerNumber: ob.billInquiry.request.consumer_number,
      studentName: 'Gateway Test',
      amount: 10,
      status: 'U',
      dueDate: new Date('2026-10-18T05:00:00Z'),
      billingMonth: '2026-10',
    });
    expect(answer).toEqual(ob.billInquiry.unpaid);
    expect(Object.keys(answer)).toEqual(Object.keys(ob.billInquiry.unpaid));
    expect(answer.consumer_Detail).toHaveLength(30);
    expect(onebillInquiryResponse(null)).toEqual(ob.billInquiry.notFound);
    expect(onebillInquiryResponse(null, ONEBILL.SERVICE_FAIL)).toEqual(ob.billInquiry.refused);
  });

  it('reads bill payment amounts in paisa, signed or not', () => {
    expect(onebillRupees(ob.billPayment.request.transaction_amount)).toBe(10);
    expect(onebillRupees(ob.billInquiry.unpaid.amount_within_dueDate)).toBe(10);
    expect(onebillAmount(10)).toBe(ob.billInquiry.unpaid.amount_within_dueDate);
    expect(onebillRupees('ten')).toBeNull();
    expect(onebillRupees(undefined)).toBeNull();
  });

  it('uses the documented response codes', () => {
    expect(Object.values(ONEBILL).sort()).toEqual(Object.keys(ob.codes).sort());
  });

  it('accepts only the biller credentials in the headers', () => {
    const { username, password } = ob.billInquiry.headers;
    expect(onebillAuthorised(config, username, password)).toBe(true);
    expect(onebillAuthorised(config, username, `${password}x`)).toBe(false);
    expect(onebillAuthorised(config, undefined, password)).toBe(false);
  });
});
