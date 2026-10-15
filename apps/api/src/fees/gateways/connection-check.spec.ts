import { gatewayConfig } from './gateway-config.js';
import {
  checkEasypaisa,
  checkJazzcash,
  checkOnebill,
  httpFailure,
  probeRef,
  simulatedVerdict,
  unreachable,
  type OnebillHandlers,
} from './connection-check.js';
import { jazzcashHash } from './jazzcash.js';
import { ONEBILL } from './onebill.js';

const config = gatewayConfig({
  PAYMENTS_MODE: 'sandbox',
  JAZZCASH_MERCHANT_ID: 'MC10010',
  JAZZCASH_PASSWORD: 'jc-password',
  JAZZCASH_INTEGRITY_SALT: 'jc-salt',
  EASYPAISA_STORE_ID: '12345',
  EASYPAISA_HASH_KEY: 'ABCDEFGHIJKLMNOP',
  EASYPAISA_USERNAME: 'api',
  EASYPAISA_PASSWORD: 'ep-password',
  ONEBILL_BILLER_PREFIX: '91234',
  ONEBILL_USERNAME: 'onelink',
  ONEBILL_PASSWORD: 'ob-password',
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('probeRef', () => {
  it('never looks like a checkout reference and fits JazzCash', () => {
    const ref = probeRef(new Date('2026-10-15T00:00:00Z'));
    expect(ref).toMatch(/^TCHK[0-9A-Z]+$/);
    expect(ref.length).toBeLessThanOrEqual(20);
  });
});

describe('checkJazzcash', () => {
  it('posts a signed Status Inquiry for a made-up reference and passes on a signed answer', async () => {
    const calls: { url: string; body: Record<string, string> }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const reply = { pp_ResponseCode: '110', pp_ResponseMessage: 'Transaction not found.' };
      return json({ ...reply, pp_SecureHash: jazzcashHash(reply, 'jc-salt') });
    };
    const verdict = await checkJazzcash(config, fetchImpl, new Date('2026-10-15T00:00:00Z'));
    expect(verdict.ok).toBe(true);
    expect(calls[0].url).toBe(config.jazzcash.inquiryUrl);
    expect(calls[0].body.pp_TxnRefNo).toMatch(/^TCHK/);
    expect(calls[0].body.pp_SecureHash).toBe(jazzcashHash(calls[0].body, 'jc-salt'));
    expect(JSON.stringify(verdict)).not.toContain('jc-password');
  });

  it('explains HTTP errors, timeouts, network failures and non-JSON replies', async () => {
    expect(await checkJazzcash(config, async () => json({}, 403))).toMatchObject({ ok: false, code: 'HTTP 403' });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(
      await checkJazzcash(config, async () => {
        throw timeout;
      }),
    ).toMatchObject({ ok: false, code: 'TIMEOUT' });
    const offline = await checkJazzcash(config, async () => {
      throw new TypeError('fetch failed');
    });
    expect(offline).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(offline.hint).toContain('sandbox.jazzcash.com.pk');
    expect((await checkJazzcash(config, async () => new Response('<html>', { status: 200 }))).ok).toBe(false);
  });
});

describe('checkEasypaisa', () => {
  it('sends the API credentials and passes on "order not found"', async () => {
    let headers: Record<string, string> = {};
    const verdict = await checkEasypaisa(config, async (_url, init) => {
      headers = init.headers as Record<string, string>;
      return json({ responseCode: '0003', responseDesc: 'INVALID ORDER ID' });
    });
    expect(verdict).toMatchObject({ ok: true, code: '0003' });
    expect(Buffer.from(headers.Credentials, 'base64').toString()).toBe('api:ep-password');
    expect(JSON.stringify(verdict)).not.toContain('ep-password');
  });

  it('fails on refusals', async () => {
    expect(await checkEasypaisa(config, async () => json({}, 401))).toMatchObject({ ok: false, code: 'HTTP 401' });
    expect(await checkEasypaisa(config, async () => json({ responseCode: '0005', responseDesc: 'NOT ACTIVE' }))).toMatchObject({
      ok: false,
      code: '0005',
    });
    expect(
      (
        await checkEasypaisa(config, async () => {
          throw new Error('getaddrinfo ENOTFOUND');
        })
      ).code,
    ).toBe('NETWORK');
  });
});

describe('httpFailure and unreachable', () => {
  it('gives a hint per status', () => {
    expect(httpFailure('JazzCash', 404).hint).toMatch(/no API at this address/);
    expect(httpFailure('JazzCash', 502).hint).toMatch(/on its side/);
    expect(httpFailure('Easypaisa', 400).hint).toMatch(/did not accept/);
    expect(unreachable('Easypaisa', 'not a url', new Error('x')).hint).toContain('not a url');
  });
});

describe('checkOnebill', () => {
  const handlers = (over: Partial<OnebillHandlers> = {}): OnebillHandlers => ({
    authorised: async (_n, u, p) => u === 'onelink' && p === 'ob-password',
    inquiry: async () => ({ response_Code: ONEBILL.NOT_FOUND }),
    payment: async () => ({ response_Code: ONEBILL.NOT_FOUND }),
    ...over,
  });

  it('passes when the handlers accept the credentials and refuse everything else', async () => {
    const seen: string[] = [];
    const verdict = await checkOnebill(
      config,
      handlers({
        inquiry: async (n) => {
          seen.push(n);
          return { response_Code: ONEBILL.NOT_FOUND };
        },
      }),
      [],
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.steps.every((s) => s.ok)).toBe(true);
    expect(seen[0]).toBe('912349999999999');
  });

  it('fails with the reason', async () => {
    expect((await checkOnebill(config, handlers({ authorised: async () => false }), [])).hint).toMatch(/did not accept/);
    expect((await checkOnebill(config, handlers({ authorised: async () => true }), [])).hint).toMatch(/wrong password was accepted/);
    const exists = await checkOnebill(config, handlers({ inquiry: async () => ({ response_Code: ONEBILL.OK }) }), []);
    expect(exists).toMatchObject({ ok: false, code: '00' });
    const local = await checkOnebill(config, handlers(), ['API_PUBLIC_URL is not set, so gateways would call back to localhost.']);
    expect(local.ok).toBe(false);
    expect(local.hint).toMatch(/cannot call them yet/);
  });
});

describe('simulatedVerdict', () => {
  it('passes without calling anything', () => {
    expect(simulatedVerdict('EASYPAISA')).toMatchObject({ ok: true, code: null });
    expect(simulatedVerdict('ONEBILL').hint).toContain('1Bill');
  });
});
