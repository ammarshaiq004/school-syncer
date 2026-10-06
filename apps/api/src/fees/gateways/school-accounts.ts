import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { GatewayConfig } from './gateway-config.js';

/**
 * A school's own merchant accounts. Each gateway has a few identifiers that
 * are safe to show (merchant id, store id, biller prefix) and a few secrets
 * that are encrypted at rest and never sent back to the browser.
 */
export const ACCOUNT_FIELDS = {
  JAZZCASH: { settings: ['merchantId'], secrets: ['password', 'integritySalt'] },
  EASYPAISA: { settings: ['storeId', 'username', 'accountNum'], secrets: ['password', 'hashKey'] },
  ONEBILL: { settings: ['billerPrefix', 'username'], secrets: ['password'] },
} as const;

export type AccountProvider = keyof typeof ACCOUNT_FIELDS;
export const ACCOUNT_PROVIDERS = Object.keys(ACCOUNT_FIELDS) as AccountProvider[];

/** Fields Easypaisa does not insist on (the account number only narrows an inquiry). */
const OPTIONAL = new Set(['accountNum']);

export interface SchoolAccount {
  provider: AccountProvider;
  enabled: boolean;
  settings: Record<string, string>;
  secrets: Record<string, string>;
}

/** Where a gateway's payments go for a school: its own account, the server's, or nowhere. */
export type AccountSource = 'school' | 'platform' | null;

/** The 32-byte key from PAYMENTS_SECRET_KEY: 64 hex characters, base64 of 32 bytes, or a passphrase of 32+ characters. */
export function secretKey(value: string | undefined = process.env.PAYMENTS_SECRET_KEY): Buffer | null {
  const v = value?.trim() ?? '';
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  const b64 = /^[A-Za-z0-9+/]{43}=?$/.test(v) ? Buffer.from(v, 'base64') : null;
  if (b64?.length === 32) return b64;
  return v.length >= 32 ? createHash('sha256').update(v).digest() : null;
}

/** "v1:" + base64(iv, tag, ciphertext) of the JSON, AES-256-GCM. */
export function sealSecrets(secrets: Record<string, string>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

/** Decrypts sealSecrets output. Throws when the key is wrong or the value was altered. */
export function openSecrets(sealed: string, key: Buffer): Record<string, string> {
  if (!sealed) return {};
  if (!sealed.startsWith('v1:')) throw new Error('Unknown secret format');
  const raw = Buffer.from(sealed.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as Record<string, string>;
}

/** The fields an account still needs before it can take payments. */
export function missingFields(provider: AccountProvider, settings: Record<string, string>, secrets: Record<string, string>): string[] {
  const f = ACCOUNT_FIELDS[provider];
  return [
    ...f.settings.filter((k) => !OPTIONAL.has(k) && !settings[k]?.trim()),
    ...f.secrets.filter((k) => !secrets[k]?.trim()),
  ];
}

const platformHas = (c: GatewayConfig, p: AccountProvider) =>
  p === 'JAZZCASH'
    ? Boolean(c.jazzcash.merchantId && c.jazzcash.password && c.jazzcash.integritySalt)
    : p === 'EASYPAISA'
      ? Boolean(c.easypaisa.storeId && c.easypaisa.hashKey && c.easypaisa.username && c.easypaisa.password)
      : Boolean(c.onebill.billerPrefix && c.onebill.username && c.onebill.password);

/**
 * The gateway settings for one school: its own accounts where it has them,
 * otherwise the server's account from the environment. A school that switched
 * a gateway off gets no account for it, even if the server has one. Mock and
 * off modes ignore school accounts.
 */
export function withSchoolAccounts(base: GatewayConfig, accounts: SchoolAccount[]): { config: GatewayConfig; sources: Record<AccountProvider, AccountSource> } {
  const sources = Object.fromEntries(
    ACCOUNT_PROVIDERS.map((p) => [p, base.mode === 'off' ? null : base.mode === 'mock' || platformHas(base, p) ? 'platform' : null]),
  ) as Record<AccountProvider, AccountSource>;
  if (base.mode === 'mock' || base.mode === 'off') return { config: base, sources };
  const config: GatewayConfig = { ...base, jazzcash: { ...base.jazzcash }, easypaisa: { ...base.easypaisa }, onebill: { ...base.onebill } };
  const use = (p: AccountProvider, s: Record<string, string>, k: Record<string, string>) => {
    if (p === 'JAZZCASH') {
      Object.assign(config.jazzcash, { merchantId: s.merchantId ?? '', password: k.password ?? '', integritySalt: k.integritySalt ?? '' });
    } else if (p === 'EASYPAISA') {
      Object.assign(config.easypaisa, {
        storeId: s.storeId ?? '',
        username: s.username ?? '',
        accountNum: s.accountNum ?? '',
        password: k.password ?? '',
        hashKey: k.hashKey ?? '',
      });
    } else {
      Object.assign(config.onebill, { billerPrefix: s.billerPrefix ?? '', username: s.username ?? '', password: k.password ?? '' });
    }
  };
  for (const a of accounts) {
    if (!a.enabled) {
      sources[a.provider] = null;
      use(a.provider, {}, {});
    } else if (missingFields(a.provider, a.settings, a.secrets).length === 0) {
      sources[a.provider] = 'school';
      use(a.provider, a.settings, a.secrets);
    }
    // Enabled but half filled in: the server's account (if any) carries on meanwhile.
  }
  return { config, sources };
}

/**
 * What would stop real payments working with these settings: gateways only
 * call back to public https addresses, and school accounts need the key.
 */
export function goLiveProblems(c: GatewayConfig, env: Record<string, string | undefined> = process.env): string[] {
  if (c.mode !== 'sandbox' && c.mode !== 'live') return [];
  const problems: string[] = [];
  const local = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.)/.test(url);
  if (!env.API_PUBLIC_URL) problems.push('API_PUBLIC_URL is not set, so gateways would call back to localhost.');
  else if (local(c.apiUrl)) problems.push(`API_PUBLIC_URL (${c.apiUrl}) is not reachable from the internet.`);
  else if (c.mode === 'live' && !c.apiUrl.startsWith('https://')) problems.push('API_PUBLIC_URL must use https for live payments.');
  if (c.mode === 'live' && (local(c.webUrl) || !c.webUrl.startsWith('https://'))) {
    problems.push('WEB_PUBLIC_URL must be the public https address of the portal.');
  }
  if (!secretKey(env.PAYMENTS_SECRET_KEY)) {
    problems.push('PAYMENTS_SECRET_KEY is not set (or shorter than 32 characters), so schools cannot save their own merchant accounts.');
  }
  return problems;
}
