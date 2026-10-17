import { HttpException } from '@nestjs/common';
import type { CounterStore } from '../jobs/counter-store.js';
import { CHECK_LIMIT, GatewayChecksService, platformMissing } from './gateway-checks.service.js';
import { gatewayConfig, type GatewayConfig } from './gateways/gateway-config.js';
import { jazzcashHash } from './gateways/jazzcash.js';
import type { SchoolAccount } from './gateways/school-accounts.js';
import type { OnlinePaymentsService } from './online-payments.service.js';

function counters(): CounterStore {
  const counts = new Map<string, number>();
  return {
    increment: async (key, windowMs, now) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { count: counts.get(key)!, resetAt: now + windowMs };
    },
    get: async () => null,
    delete: async () => {},
    sweep: async () => 0,
  };
}

function service(config: GatewayConfig, accounts: SchoolAccount[] = []) {
  const online = {
    config,
    schoolAccounts: async () => accounts,
    onebillAuthorised: async (_n: string, u: string, p: string) => u === 'school-1link' && p === 'school-pass',
    onebillInquiry: async () => ({ response_Code: '01' }),
    onebillPayment: async () => ({ response_Code: '01' }),
  } as unknown as OnlinePaymentsService;
  return new GatewayChecksService(online, counters());
}

const sandbox = gatewayConfig({ PAYMENTS_MODE: 'sandbox', API_PUBLIC_URL: 'https://api.example.pk' });
const jazzcash: SchoolAccount = {
  provider: 'JAZZCASH',
  enabled: true,
  settings: { merchantId: 'MCSCHOOL' },
  secrets: { password: 'school-pw', integritySalt: 'school-salt' },
};

describe('GatewayChecksService', () => {
  it('checks the school account against the gateway with its own credentials', async () => {
    const s = service(sandbox, [jazzcash]);
    let sent: Record<string, string> = {};
    s.fetch = async (_url, init) => {
      sent = JSON.parse(String(init.body));
      const reply = { pp_ResponseCode: '110', pp_ResponseMessage: 'Transaction not found.' };
      return new Response(JSON.stringify({ ...reply, pp_SecureHash: jazzcashHash(reply, 'school-salt') }));
    };
    const result = await s.checkSchool('school-1', 'JAZZCASH');
    expect(result).toMatchObject({ ok: true, provider: 'JAZZCASH', account: 'school', mode: 'sandbox', simulated: false });
    expect(sent.pp_MerchantID).toBe('MCSCHOOL');
    expect(JSON.stringify(result)).not.toContain('school-pw');
    expect(JSON.stringify(result)).not.toContain('school-salt');
  });

  it('asks for a saved, complete account first', async () => {
    await expect(service(sandbox).checkSchool('s', 'EASYPAISA')).rejects.toThrow(/Save your Easypaisa account first/);
    const half = { ...jazzcash, secrets: { password: 'x' } };
    await expect(service(sandbox, [half]).checkSchool('s', 'JAZZCASH')).rejects.toThrow(/integritySalt/);
    const off: SchoolAccount = { provider: 'ONEBILL', enabled: false, settings: { billerPrefix: '91111', username: 'u' }, secrets: { password: 'p' } };
    await expect(service(sandbox, [off]).checkSchool('s', 'ONEBILL')).rejects.toThrow(/Switch 1Bill on/);
  });

  it('runs the 1Bill self-test and returns what 1LINK needs, without the password', async () => {
    vi.stubEnv('API_PUBLIC_URL', 'https://api.example.pk');
    const onebill: SchoolAccount = {
      provider: 'ONEBILL',
      enabled: true,
      settings: { billerPrefix: '91111', username: 'school-1link' },
      secrets: { password: 'school-pass' },
    };
    const result = await service(sandbox, [onebill]).checkSchool('s', 'ONEBILL');
    expect(result.ok).toBe(true);
    expect(result.setup).toEqual({
      billInquiryUrl: 'https://api.example.pk/api/payments/1bill/bill-inquiry',
      billPaymentUrl: 'https://api.example.pk/api/payments/1bill/bill-payment',
      billerPrefix: '91111',
      username: 'school-1link',
    });
    expect(JSON.stringify(result)).not.toContain('school-pass');
    vi.unstubAllEnvs();
  });

  it('simulates a pass in mock mode and refuses in off mode', async () => {
    const mock = await service(gatewayConfig({ PAYMENTS_MODE: 'mock' })).checkPlatform('admin', 'EASYPAISA');
    expect(mock).toMatchObject({ ok: true, simulated: true, account: 'platform' });
    await expect(service(gatewayConfig({ PAYMENTS_MODE: 'off' })).checkPlatform('admin', 'JAZZCASH')).rejects.toThrow(/switched off/);
  });

  it('names the missing environment variables for the server account', async () => {
    await expect(service(sandbox).checkPlatform('admin', 'JAZZCASH')).rejects.toThrow(/JAZZCASH_MERCHANT_ID/);
    expect(platformMissing(sandbox, 'ONEBILL')).toEqual(['ONEBILL_BILLER_PREFIX', 'ONEBILL_USERNAME', 'ONEBILL_PASSWORD']);
  });

  it('is rate-limited per account holder', async () => {
    const s = service(gatewayConfig({ PAYMENTS_MODE: 'mock' }));
    for (let i = 0; i < CHECK_LIMIT.max; i++) await s.checkPlatform('admin', 'ONEBILL');
    const error = await s.checkPlatform('admin', 'ONEBILL').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    // Another staff member has their own allowance.
    await expect(s.checkPlatform('other', 'ONEBILL')).resolves.toMatchObject({ ok: true });
  });
});
