import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { tooManyRequests } from '../common/rate-limit.guard.js';
import { COUNTER_STORE, type CounterStore } from '../jobs/counter-store.js';
import {
  checkEasypaisa,
  checkJazzcash,
  checkOnebill,
  simulatedVerdict,
  type CheckVerdict,
} from './gateways/connection-check.js';
import type { GatewayConfig } from './gateways/gateway-config.js';
import { goLiveProblems, missingFields, withSchoolAccounts, type AccountProvider } from './gateways/school-accounts.js';
import { OnlinePaymentsService } from './online-payments.service.js';

/** Checks one account may run per window: enough to fix a typo and retry, not enough to hammer a gateway. */
export const CHECK_LIMIT = { max: 10, windowMs: 10 * 60_000 };

export interface ConnectionCheckResult extends CheckVerdict {
  provider: AccountProvider;
  /** Whose account was checked. */
  account: 'school' | 'platform';
  mode: GatewayConfig['mode'];
  /** True in mock mode: nothing was called. */
  simulated: boolean;
  ms: number;
  checkedAt: string;
  /** 1Bill: what to give 1LINK. Identifiers only; the password is never returned. */
  setup?: Record<string, string>;
}

const NAMES: Record<AccountProvider, string> = { JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', ONEBILL: '1Bill' };

/**
 * "Test connection" for the school's own merchant accounts and the server's
 * (see gateways/connection-check.ts for what each check proves). Rate-limited
 * per account holder; callers audit the result.
 */
@Injectable()
export class GatewayChecksService {
  /** Replaceable in tests, so no gateway is called. */
  fetch: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init);

  constructor(
    private readonly online: OnlinePaymentsService,
    @Inject(COUNTER_STORE) private readonly counters: CounterStore,
  ) {}

  /** Checks the school's own saved account for one gateway. */
  async checkSchool(schoolId: string, provider: AccountProvider): Promise<ConnectionCheckResult> {
    await this.limit(`school:${schoolId}`);
    assertOn(this.online.config);
    const account = (await this.online.schoolAccounts(schoolId)).find((a) => a.provider === provider);
    if (!account) throw new BadRequestException(`Save your ${NAMES[provider]} account first, then test it.`);
    const missing = missingFields(provider, account.settings, account.secrets);
    if (missing.length) throw new BadRequestException(`Fill in ${missing.join(', ')} first, then test the account.`);
    if (provider === 'ONEBILL' && !account.enabled && this.online.config.mode !== 'mock') {
      throw new BadRequestException("Switch 1Bill on and save first: 1LINK's calls are only matched to an account that is switched on.");
    }
    const { config } = withSchoolAccounts(this.online.config, [{ ...account, enabled: true }]);
    return this.run(provider, 'school', config);
  }

  /** Checks the server's own account from the environment. */
  async checkPlatform(adminId: string, provider: AccountProvider): Promise<ConnectionCheckResult> {
    await this.limit(`platform:${adminId}`);
    const config = this.online.config;
    assertOn(config);
    const missing = config.mode === 'mock' ? [] : platformMissing(config, provider);
    if (missing.length) throw new BadRequestException(`The server has no ${NAMES[provider]} account yet. Set ${missing.join(', ')}.`);
    return this.run(provider, 'platform', config);
  }

  private async limit(holder: string) {
    const now = Date.now();
    const counter = await this.counters.increment(`gateway-check|${holder}`, CHECK_LIMIT.windowMs, now);
    if (counter.count > CHECK_LIMIT.max) throw tooManyRequests(counter.resetAt - now);
  }

  private async run(provider: AccountProvider, account: 'school' | 'platform', config: GatewayConfig): Promise<ConnectionCheckResult> {
    const started = Date.now();
    const verdict =
      config.mode === 'mock'
        ? simulatedVerdict(provider)
        : provider === 'JAZZCASH'
          ? await checkJazzcash(config, this.fetch)
          : provider === 'EASYPAISA'
            ? await checkEasypaisa(config, this.fetch)
            : await checkOnebill(
                config,
                {
                  authorised: (n, u, p) => this.online.onebillAuthorised(n, u, p),
                  inquiry: (n) => this.online.onebillInquiry(n),
                  payment: (r) => this.online.onebillPayment(r),
                },
                goLiveProblems(config).filter((p) => p.startsWith('API_PUBLIC_URL')),
              );
    const api = `${config.apiUrl}/api/payments`;
    return {
      ...verdict,
      provider,
      account,
      mode: config.mode,
      simulated: config.mode === 'mock',
      ms: Date.now() - started,
      checkedAt: new Date().toISOString(),
      ...(provider === 'ONEBILL'
        ? {
            setup: {
              billInquiryUrl: `${api}/1bill/bill-inquiry`,
              billPaymentUrl: `${api}/1bill/bill-payment`,
              billerPrefix: config.onebill.billerPrefix,
              username: config.onebill.username,
            },
          }
        : {}),
    };
  }
}

function assertOn(config: GatewayConfig) {
  if (config.mode === 'off') {
    throw new BadRequestException('Online payments are switched off on this server (PAYMENTS_MODE=off), so there is nothing to test against.');
  }
}

/** The environment variables the server's account still needs for a gateway. */
export function platformMissing(c: GatewayConfig, provider: AccountProvider): string[] {
  const need: Record<AccountProvider, [string, string][]> = {
    JAZZCASH: [
      ['JAZZCASH_MERCHANT_ID', c.jazzcash.merchantId],
      ['JAZZCASH_PASSWORD', c.jazzcash.password],
      ['JAZZCASH_INTEGRITY_SALT', c.jazzcash.integritySalt],
    ],
    EASYPAISA: [
      ['EASYPAISA_STORE_ID', c.easypaisa.storeId],
      ['EASYPAISA_USERNAME', c.easypaisa.username],
      ['EASYPAISA_PASSWORD', c.easypaisa.password],
      ['EASYPAISA_HASH_KEY', c.easypaisa.hashKey],
    ],
    ONEBILL: [
      ['ONEBILL_BILLER_PREFIX', c.onebill.billerPrefix],
      ['ONEBILL_USERNAME', c.onebill.username],
      ['ONEBILL_PASSWORD', c.onebill.password],
    ],
  };
  return need[provider].filter(([, v]) => !v).map(([k]) => k);
}
