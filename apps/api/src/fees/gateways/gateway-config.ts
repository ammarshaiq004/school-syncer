/**
 * Settings for the online payment gateways, read from the environment.
 *
 * PAYMENTS_MODE decides where checkouts go:
 * - "mock" (the default outside production): nothing leaves the server. Parents see a sandbox
 *   checkout page in the portal, and approving it produces the same signed
 *   callback the real gateway would send, so verification, receipts and the
 *   cash book are exercised end to end without merchant accounts.
 * - "sandbox": the providers' test environments, with test merchant credentials.
 * - "live": production endpoints.
 * - "off": no online payments. The default when NODE_ENV is production, so a
 *   server never lets parents "approve" their own fees by accident; mock mode
 *   there needs PAYMENTS_MODE=mock set on purpose.
 */
export type PaymentsMode = 'mock' | 'sandbox' | 'live' | 'off';

export interface GatewayConfig {
  mode: PaymentsMode;
  /** Public base URL of this API (no trailing /api), for gateway return URLs. */
  apiUrl: string;
  /** Public base URL of the web portal, where parents land after paying. */
  webUrl: string;
  /** Minutes a wallet checkout stays open. */
  checkoutMinutes: number;
  /** Days a 1Bill consumer number can be paid against. */
  onebillDays: number;
  jazzcash: { merchantId: string; password: string; integritySalt: string; url: string; inquiryUrl: string };
  easypaisa: {
    storeId: string;
    hashKey: string;
    username: string;
    password: string;
    accountNum: string;
    checkoutUrl: string;
    inquiryUrl: string;
  };
  onebill: { billerPrefix: string; username: string; password: string };
}

// Fixed keys for mock mode only, so mock callbacks are signed and verified for real.
const MOCK = {
  jazzcash: { merchantId: 'MOCK00001', password: 'mock-password', integritySalt: 'mock-integrity-salt' },
  easypaisa: { storeId: '00000', hashKey: 'MOCKHASHKEY12345', username: 'mock', password: 'mock', accountNum: '000000' },
  onebill: { billerPrefix: '00000', username: 'mock-1link', password: 'mock-1link' },
};

const HOSTS = {
  sandbox: {
    jazzcash: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
    jazzcashInquiry: 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire',
    easypaisa: 'https://easypaystg.easypaisa.com.pk',
  },
  live: {
    jazzcash: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
    jazzcashInquiry: 'https://payments.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire',
    easypaisa: 'https://easypay.easypaisa.com.pk',
  },
};

export function gatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const modes: PaymentsMode[] = ['mock', 'sandbox', 'live', 'off'];
  const mode =
    modes.find((m) => m === env.PAYMENTS_MODE) ?? (env.NODE_ENV === 'production' ? 'off' : 'mock');
  const real = mode === 'sandbox' || mode === 'live' ? HOSTS[mode] : null;
  const pick = (key: string, mock: string) => (mode === 'mock' ? mock : (env[key] ?? ''));
  const easypaisaHost = env.EASYPAISA_BASE_URL || real?.easypaisa || '';
  return {
    mode,
    apiUrl: (env.API_PUBLIC_URL || `http://localhost:${env.PORT ?? 4000}`).replace(/\/+$/, ''),
    webUrl: (env.WEB_PUBLIC_URL || (env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim()).replace(/\/+$/, ''),
    checkoutMinutes: Number(env.PAYMENTS_CHECKOUT_MINUTES) || 60,
    onebillDays: Number(env.ONEBILL_VALID_DAYS) || 3,
    jazzcash: {
      merchantId: pick('JAZZCASH_MERCHANT_ID', MOCK.jazzcash.merchantId),
      password: pick('JAZZCASH_PASSWORD', MOCK.jazzcash.password),
      integritySalt: pick('JAZZCASH_INTEGRITY_SALT', MOCK.jazzcash.integritySalt),
      url: env.JAZZCASH_CHECKOUT_URL || real?.jazzcash || '',
      inquiryUrl: env.JAZZCASH_INQUIRY_URL || real?.jazzcashInquiry || '',
    },
    easypaisa: {
      storeId: pick('EASYPAISA_STORE_ID', MOCK.easypaisa.storeId),
      hashKey: pick('EASYPAISA_HASH_KEY', MOCK.easypaisa.hashKey),
      username: pick('EASYPAISA_USERNAME', MOCK.easypaisa.username),
      password: pick('EASYPAISA_PASSWORD', MOCK.easypaisa.password),
      accountNum: pick('EASYPAISA_ACCOUNT_NUM', MOCK.easypaisa.accountNum),
      checkoutUrl: easypaisaHost && `${easypaisaHost}/easypay/Index.jsf`,
      inquiryUrl: easypaisaHost && `${easypaisaHost}/easypay-service/rest/v4/inquire-transaction`,
    },
    onebill: {
      billerPrefix: pick('ONEBILL_BILLER_PREFIX', MOCK.onebill.billerPrefix),
      username: pick('ONEBILL_USERNAME', MOCK.onebill.username),
      password: pick('ONEBILL_PASSWORD', MOCK.onebill.password),
    },
  };
}

/** Which gateways have what they need to take a payment in this mode. */
export function enabledProviders(c: GatewayConfig) {
  if (c.mode === 'off') return { JAZZCASH: false, EASYPAISA: false, ONEBILL: false };
  if (c.mode === 'mock') return { JAZZCASH: true, EASYPAISA: true, ONEBILL: true };
  return {
    JAZZCASH: Boolean(c.jazzcash.merchantId && c.jazzcash.password && c.jazzcash.integritySalt),
    EASYPAISA: Boolean(c.easypaisa.storeId && c.easypaisa.hashKey && c.easypaisa.username && c.easypaisa.password),
    ONEBILL: Boolean(c.onebill.billerPrefix && c.onebill.username && c.onebill.password),
  };
}

/** "20261005143000" in Pakistan time, the format JazzCash and Easypaisa use. */
export function pkTimestamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}
