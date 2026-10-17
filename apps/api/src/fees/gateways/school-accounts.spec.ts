import { createCipheriv, randomBytes } from 'node:crypto';
import { enabledProviders, gatewayConfig } from './gateway-config.js';
import {
  goLiveProblems,
  keyId,
  missingFields,
  openSecrets,
  sealedWith,
  sealSecrets,
  secretKey,
  secretKeys,
  withSchoolAccounts,
  type SchoolAccount,
} from './school-accounts.js';

/** What sealSecrets wrote before key ids (v1). */
function sealV1(secrets: Record<string, string>, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

const platform = gatewayConfig({
  PAYMENTS_MODE: 'live',
  JAZZCASH_MERCHANT_ID: 'PLATFORM1',
  JAZZCASH_PASSWORD: 'pp',
  JAZZCASH_INTEGRITY_SALT: 'ps',
});
const jazz = (over: Partial<SchoolAccount> = {}): SchoolAccount => ({
  provider: 'JAZZCASH',
  enabled: true,
  settings: { merchantId: 'SCHOOL9' },
  secrets: { password: 'sp', integritySalt: 'ss' },
  ...over,
});

describe('PAYMENTS_SECRET_KEY', () => {
  it('takes hex, base64 or a long passphrase', () => {
    const raw = randomBytes(32);
    expect(secretKey(raw.toString('hex'))).toEqual(raw);
    expect(secretKey(raw.toString('base64'))).toEqual(raw);
    expect(secretKey('a passphrase that is long enough!!')).toHaveLength(32);
    expect(secretKey('short')).toBeNull();
    expect(secretKey(undefined)).toBeNull();
  });

  it('seals secrets so only the same key opens them', () => {
    const key = randomBytes(32);
    const sealed = sealSecrets({ password: 'p@ss' }, key);
    // Versioned, with the sealing key's id.
    expect(sealed).toMatch(new RegExp(`^v2:${keyId(key)}:`));
    expect(sealed).not.toContain('p@ss');
    expect(openSecrets(sealed, key)).toEqual({ password: 'p@ss' });
    expect(() => openSecrets(sealed, randomBytes(32))).toThrow(/No key/);
    const [, id, body] = sealed.split(':');
    const tampered = `v2:${id}:${Buffer.from(Buffer.from(body, 'base64').map((b, i) => (i === 40 ? b ^ 1 : b))).toString('base64')}`;
    expect(() => openSecrets(tampered, key)).toThrow();
    expect(() => openSecrets('v9:nope', key)).toThrow(/Unknown secret format/);
    expect(openSecrets('', key)).toEqual({});
  });
});

describe('PAYMENTS_SECRET_KEY rotation', () => {
  const oldKey = randomBytes(32).toString('hex');
  const newKey = randomBytes(32).toString('hex');
  const during = secretKeys({ PAYMENTS_SECRET_KEY: newKey, PAYMENTS_SECRET_KEY_PREVIOUS: oldKey });

  it('seals with the current key and opens with current or previous', () => {
    expect(during.current).toEqual(Buffer.from(newKey, 'hex'));
    expect(during.all).toHaveLength(2);
    const before = sealSecrets({ token: 'old' }, Buffer.from(oldKey, 'hex'));
    expect(openSecrets(before, during.all)).toEqual({ token: 'old' });
    // Without the previous key, secrets sealed with it can no longer be read.
    expect(() => openSecrets(before, secretKeys({ PAYMENTS_SECRET_KEY: newKey }).all)).toThrow(/PAYMENTS_SECRET_KEY_PREVIOUS/);
  });

  it('opens unversioned v1 values with any key in the ring', () => {
    const legacy = sealV1({ password: 'p' }, Buffer.from(oldKey, 'hex'));
    expect(openSecrets(legacy, during.all)).toEqual({ password: 'p' });
    expect(() => openSecrets(legacy, [randomBytes(32)])).toThrow();
  });

  it('tells which values still need re-encrypting', () => {
    const current = during.current!;
    expect(sealedWith(sealSecrets({ a: '1' }, current), current)).toBe(true);
    expect(sealedWith(sealSecrets({ a: '1' }, Buffer.from(oldKey, 'hex')), current)).toBe(false);
    expect(sealedWith(sealV1({ a: '1' }, current), current)).toBe(false);
    expect(sealedWith('', current)).toBe(true);
  });

  it('accepts several previous keys, ignoring bad and repeated ones', () => {
    const third = randomBytes(32).toString('hex');
    const ring = secretKeys({ PAYMENTS_SECRET_KEY: newKey, PAYMENTS_SECRET_KEY_PREVIOUS: `${oldKey}, short, ${third}, ${newKey}` });
    expect(ring.all.map(keyId)).toEqual([newKey, oldKey, third].map((k) => keyId(Buffer.from(k, 'hex'))));
    // Only previous keys: secrets can be read but nothing new can be sealed.
    expect(secretKeys({ PAYMENTS_SECRET_KEY_PREVIOUS: oldKey })).toMatchObject({ current: null, all: [Buffer.from(oldKey, 'hex')] });
  });
});

describe('school accounts', () => {
  it('lists what an account still needs', () => {
    expect(missingFields('EASYPAISA', { storeId: '1', username: 'u' }, { password: 'p' })).toEqual(['hashKey']);
    expect(missingFields('ONEBILL', {}, {})).toEqual(['billerPrefix', 'username', 'password']);
  });

  it("uses the school's own account over the server's", () => {
    const { config, sources } = withSchoolAccounts(platform, [jazz()]);
    expect(config.jazzcash).toMatchObject({ merchantId: 'SCHOOL9', password: 'sp', integritySalt: 'ss' });
    expect(sources).toEqual({ JAZZCASH: 'school', EASYPAISA: null, ONEBILL: null });
    // The server's own settings are untouched.
    expect(platform.jazzcash.merchantId).toBe('PLATFORM1');
  });

  it("keeps the server's account while the school's is half filled in, and none once switched off", () => {
    const half = withSchoolAccounts(platform, [jazz({ secrets: { password: 'sp' } })]);
    expect(half.config.jazzcash.merchantId).toBe('PLATFORM1');
    expect(half.sources.JAZZCASH).toBe('platform');
    const off = withSchoolAccounts(platform, [jazz({ enabled: false })]);
    expect(off.sources.JAZZCASH).toBeNull();
    expect(enabledProviders(off.config).JAZZCASH).toBe(false);
  });

  it('ignores school accounts in mock mode', () => {
    const mock = gatewayConfig({});
    expect(withSchoolAccounts(mock, [jazz()]).config.jazzcash.merchantId).toBe('MOCK00001');
  });
});

describe('go-live checks', () => {
  it('needs public https addresses and the secret key', () => {
    const live = gatewayConfig({ PAYMENTS_MODE: 'live' });
    expect(goLiveProblems(live, {})).toEqual([
      'API_PUBLIC_URL is not set, so gateways would call back to localhost.',
      'WEB_PUBLIC_URL must be the public https address of the portal.',
      'PAYMENTS_SECRET_KEY is not set (or shorter than 32 characters), so schools cannot save their own merchant accounts.',
    ]);
    const env = {
      PAYMENTS_MODE: 'live',
      API_PUBLIC_URL: 'https://api.schoolsyncer.pk',
      WEB_PUBLIC_URL: 'https://app.schoolsyncer.pk',
      PAYMENTS_SECRET_KEY: 'x'.repeat(40),
    };
    expect(goLiveProblems(gatewayConfig(env), env)).toEqual([]);
    expect(goLiveProblems(gatewayConfig({ ...env, API_PUBLIC_URL: 'http://api.schoolsyncer.pk' }), env)).toEqual([
      'API_PUBLIC_URL must use https for live payments.',
    ]);
    expect(goLiveProblems(gatewayConfig({}), {})).toEqual([]);
  });
});
