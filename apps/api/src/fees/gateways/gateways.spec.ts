import { createDecipheriv, createHmac } from 'node:crypto';
import { easypaisaCheckout, easypaisaConfirm, easypaisaHashedRequest, easypaisaInquiryRequest, easypaisaResult } from './easypaisa.js';
import { enabledProviders, gatewayConfig, pkTimestamp } from './gateway-config.js';
import { jazzcashCheckout, jazzcashHash, jazzcashMockReturn, jazzcashVerify } from './jazzcash.js';
import { onebillAmount, onebillAuthorised, onebillConsumerNumber, onebillInquiryResponse, onebillRupees } from './onebill.js';

const sandbox = gatewayConfig({
  PAYMENTS_MODE: 'sandbox',
  API_PUBLIC_URL: 'https://api.school.pk/',
  WEB_ORIGIN: 'https://portal.school.pk, http://localhost:8081',
  JAZZCASH_MERCHANT_ID: 'MC12345',
  JAZZCASH_PASSWORD: 'pass',
  JAZZCASH_INTEGRITY_SALT: 'salt123',
  EASYPAISA_STORE_ID: '12345',
  EASYPAISA_HASH_KEY: 'ABCDEFGHIJKLMNOP',
  EASYPAISA_USERNAME: 'store',
  EASYPAISA_PASSWORD: 'secret',
  EASYPAISA_ACCOUNT_NUM: '654321',
  ONEBILL_BILLER_PREFIX: '10077',
  ONEBILL_USERNAME: '1link',
  ONEBILL_PASSWORD: 'p@ss',
});

describe('gatewayConfig', () => {
  it('defaults to mock outside production and off in production', () => {
    expect(gatewayConfig({}).mode).toBe('mock');
    expect(gatewayConfig({ NODE_ENV: 'production' }).mode).toBe('off');
    expect(gatewayConfig({ NODE_ENV: 'production', PAYMENTS_MODE: 'mock' }).mode).toBe('mock');
    expect(enabledProviders(gatewayConfig({ NODE_ENV: 'production' }))).toEqual({ JAZZCASH: false, EASYPAISA: false, ONEBILL: false });
  });

  it('uses the sandbox hosts and trims URLs', () => {
    expect(sandbox.apiUrl).toBe('https://api.school.pk');
    expect(sandbox.webUrl).toBe('https://portal.school.pk');
    expect(sandbox.jazzcash.url).toContain('sandbox.jazzcash.com.pk');
    expect(sandbox.easypaisa.checkoutUrl).toBe('https://easypaystg.easypaisa.com.pk/easypay/Index.jsf');
  });

  it('only enables a gateway with its credentials', () => {
    expect(enabledProviders(gatewayConfig({ PAYMENTS_MODE: 'live', JAZZCASH_MERCHANT_ID: 'x' }))).toEqual({
      JAZZCASH: false,
      EASYPAISA: false,
      ONEBILL: false,
    });
    expect(enabledProviders(sandbox)).toEqual({ JAZZCASH: true, EASYPAISA: true, ONEBILL: true });
  });

  it('formats Pakistan time', () => {
    expect(pkTimestamp(new Date('2026-10-05T19:30:05Z'))).toBe('20261006003005');
  });
});

describe('JazzCash', () => {
  const at = new Date('2026-10-05T10:00:00Z');
  const checkout = jazzcashCheckout(sandbox, {
    txnRef: 'T123',
    amount: 4500,
    billReference: '202610-K7Q2MX',
    description: 'School fee 202610-K7Q2MX',
    createdAt: at,
    expiresAt: new Date(at.getTime() + 3_600_000),
  });

  it('signs the salt and the non-empty pp_ values in name order', () => {
    const f = checkout.fields;
    const ordered = Object.keys(f)
      .filter((k) => k.startsWith('pp') && k !== 'pp_SecureHash' && f[k] !== '')
      .sort()
      .map((k) => f[k]);
    const expected = createHmac('sha256', 'salt123').update(['salt123', ...ordered].join('&')).digest('hex').toUpperCase();
    expect(f.pp_SecureHash).toBe(expected);
    expect(f.pp_Amount).toBe('450000');
    expect(f.pp_BillReference).toBe('202610K7Q2MX');
    expect(f.pp_TxnDateTime).toBe('20261005150000');
    expect(f.pp_ReturnURL).toBe('https://api.school.pk/api/payments/return/jazzcash');
  });

  it('accepts a genuine return and reads the outcome', () => {
    const ret = jazzcashMockReturn(sandbox, { txnRef: 'T123', amount: 4500, approve: true, at });
    expect(jazzcashVerify(sandbox, ret)).toMatchObject({ txnRef: 'T123', outcome: 'PAID', amount: 4500, responseCode: '000' });
    const declined = jazzcashMockReturn(sandbox, { txnRef: 'T123', amount: 4500, approve: false, at });
    expect(jazzcashVerify(sandbox, declined)?.outcome).toBe('FAILED');
  });

  it('rejects a tampered return, a wrong merchant or a different salt', () => {
    const ret = jazzcashMockReturn(sandbox, { txnRef: 'T123', amount: 4500, approve: false, at });
    expect(jazzcashVerify(sandbox, { ...ret, pp_ResponseCode: '000' })).toBeNull();
    expect(jazzcashVerify(sandbox, { ...ret, pp_SecureHash: undefined })).toBeNull();
    const other: Record<string, string> = { ...ret, pp_MerchantID: 'OTHER' };
    other.pp_SecureHash = jazzcashHash(other, 'salt123');
    expect(jazzcashVerify(sandbox, other)).toBeNull();
    const mock = gatewayConfig({});
    expect(jazzcashVerify(mock, ret)).toBeNull();
  });

  it('treats a voucher still waiting to be paid as pending', () => {
    const ret = jazzcashMockReturn(sandbox, { txnRef: 'T9', amount: 100, approve: true, at });
    ret.pp_ResponseCode = '124';
    ret.pp_SecureHash = jazzcashHash(ret, 'salt123');
    expect(jazzcashVerify(sandbox, ret)?.outcome).toBe('PENDING');
  });
});

describe('Easypaisa', () => {
  it('encrypts the sorted request with the hash key', () => {
    const { fields, url } = easypaisaCheckout(sandbox, {
      txnRef: 'T456',
      amount: 3000,
      expiresAt: new Date('2026-10-05T19:00:00Z'),
      mobile: '03001234567',
    });
    expect(url).toBe('https://easypaystg.easypaisa.com.pk/easypay/Index.jsf');
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from('ABCDEFGHIJKLMNOP'), null);
    const plain = Buffer.concat([decipher.update(fields.merchantHashedReq, 'base64'), decipher.final()]).toString();
    expect(plain).toBe(
      'amount=3000.0&autoRedirect=1&expiryDate=20261006 000000&mobileNum=03001234567&orderRefNum=T456&paymentMethod=MA_PAYMENT_METHOD' +
        '&postBackURL=https://api.school.pk/api/payments/return/easypaisa&storeId=12345',
    );
    expect(easypaisaHashedRequest({ b: '2', a: '1' }, 'ABCDEFGHIJKLMNOP')).toBe(
      easypaisaHashedRequest({ a: '1', b: '2', empty: '' }, 'ABCDEFGHIJKLMNOP'),
    );
  });

  it('confirms through Confirm.jsf and inquires with credentials', () => {
    expect(easypaisaConfirm(sandbox, 'tok').url).toBe('https://easypaystg.easypaisa.com.pk/easypay/Confirm.jsf');
    const req = easypaisaInquiryRequest(sandbox, 'T456');
    expect(Buffer.from(req.headers.Credentials, 'base64').toString()).toBe('store:secret');
    expect(req.body).toEqual({ orderId: 'T456', storeId: '12345', accountNum: '654321' });
  });

  it('only trusts an inquiry about the same order and store', () => {
    const base = { responseCode: '0000', orderId: 'T456', storeId: '12345', transactionStatus: 'PAID', transactionAmount: '3000.0', transactionId: '991' };
    expect(easypaisaResult(sandbox, 'T456', base)).toMatchObject({ outcome: 'PAID', amount: 3000, providerRef: '991' });
    expect(easypaisaResult(sandbox, 'T456', { ...base, orderId: 'T999' })).toBeNull();
    expect(easypaisaResult(sandbox, 'T456', { ...base, storeId: 1 })).toBeNull();
    expect(easypaisaResult(sandbox, 'T456', { ...base, transactionStatus: 'FAILED' })?.outcome).toBe('FAILED');
    expect(easypaisaResult(sandbox, 'T456', { responseCode: '0001' })?.outcome).toBe('PENDING');
  });
});

describe('1Bill', () => {
  it('formats and reads 1LINK amounts', () => {
    expect(onebillAmount(1500)).toBe('+0000000150000');
    expect(onebillRupees('000000150000')).toBe(1500);
    expect(onebillRupees('+0000000150000')).toBe(1500);
    expect(onebillRupees('15.00')).toBeNull();
  });

  it('builds consumer numbers from the biller prefix', () => {
    expect(onebillConsumerNumber('10077', () => 0.5)).toBe('100775555555555');
  });

  it('checks the biller credentials', () => {
    expect(onebillAuthorised(sandbox, '1link', 'p@ss')).toBe(true);
    expect(onebillAuthorised(sandbox, '1link', 'wrong')).toBe(false);
    expect(onebillAuthorised(sandbox, undefined, undefined)).toBe(false);
  });

  it('answers an inquiry in the 1LINK layout', () => {
    expect(onebillInquiryResponse(null)).toEqual({ response_Code: '01', reserved: '' });
    const r = onebillInquiryResponse({
      consumerNumber: '100771234567890',
      studentName: 'Ayesha Mehmood',
      amount: 4500,
      status: 'U',
      dueDate: new Date('2026-10-08T12:00:00Z'),
      billingMonth: '2026-10',
    });
    expect(r).toMatchObject({ response_Code: '00', bill_status: 'U', due_date: '20261008', billing_month: '2610', amount_within_dueDate: '+0000000450000' });
    expect((r as { consumer_Detail: string }).consumer_Detail).toHaveLength(30);
  });
});
