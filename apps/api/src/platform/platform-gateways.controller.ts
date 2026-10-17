import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GatewayChecksService, platformMissing } from '../fees/gateway-checks.service.js';
import { GatewayTestsService, TEST_AMOUNT } from '../fees/gateway-tests.service.js';
import { enabledProviders } from '../fees/gateways/gateway-config.js';
import { ACCOUNT_PROVIDERS, goLiveProblems, type AccountProvider } from '../fees/gateways/school-accounts.js';
import { ONLINE_PROVIDERS, OnlinePaymentsService } from '../fees/online-payments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

const startSchema = z.object({
  schoolId: z.string().min(1),
  provider: z.enum(ONLINE_PROVIDERS),
  amount: z.number().int().min(1).max(TEST_AMOUNT.max, `A test payment is at most Rs ${TEST_AMOUNT.max}`).default(TEST_AMOUNT.default),
});
const simulateSchema = z.object({ approve: z.boolean() });

const provider = (value: string): AccountProvider => {
  const p = value.toUpperCase() as AccountProvider;
  if (!ACCOUNT_PROVIDERS.includes(p)) throw new BadRequestException('Unknown gateway');
  return p;
};

/**
 * The server's own gateway accounts in the console (SCHOOL-149): what is set,
 * "Test connection", and the guided small live test with its history. Any
 * console staff member may use it; every check and run is in the console's
 * audit log.
 */
@Controller('platform/gateways')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformGatewaysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly online: OnlinePaymentsService,
    private readonly checks: GatewayChecksService,
    private readonly tests: GatewayTestsService,
  ) {}

  /** The server's accounts: which gateways are set, what is missing, and the addresses to register. */
  @Get()
  overview() {
    const c = this.online.config;
    const enabled = enabledProviders(c);
    const api = `${c.apiUrl}/api/payments`;
    return {
      mode: c.mode,
      problems: goLiveProblems(c),
      testAmount: TEST_AMOUNT,
      gateways: ACCOUNT_PROVIDERS.map((p) => ({
        provider: p,
        configured: enabled[p],
        missing: c.mode === 'mock' || c.mode === 'off' ? [] : platformMissing(c, p),
        /** Identifiers only, never secrets. */
        account:
          p === 'JAZZCASH'
            ? { merchantId: c.jazzcash.merchantId }
            : p === 'EASYPAISA'
              ? { storeId: c.easypaisa.storeId, username: c.easypaisa.username, accountNum: c.easypaisa.accountNum }
              : { billerPrefix: c.onebill.billerPrefix, username: c.onebill.username },
        urls:
          p === 'JAZZCASH'
            ? { returnUrl: `${api}/return/jazzcash`, ipnUrl: `${api}/ipn/jazzcash` }
            : p === 'EASYPAISA'
              ? { postBackUrl: `${api}/return/easypaisa`, ipnUrl: `${api}/ipn/easypaisa` }
              : { billInquiryUrl: `${api}/1bill/bill-inquiry`, billPaymentUrl: `${api}/1bill/bill-payment` },
      })),
    };
  }

  @Post(':provider/check')
  @HttpCode(200)
  async check(@CurrentAdmin() admin: PlatformUser, @Param('provider') raw: string) {
    const result = await this.checks.checkPlatform(admin.sub, provider(raw));
    await logPlatform(this.prisma, admin, 'payments.gateway.check', null, {
      provider: result.provider,
      mode: result.mode,
      ok: result.ok,
      code: result.code,
    });
    return result;
  }

  @Get('runs')
  runs(@Query('schoolId') schoolId?: string) {
    return this.tests.list({ schoolId: schoolId || undefined });
  }

  @Post('runs')
  start(@CurrentAdmin() admin: PlatformUser, @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>) {
    return this.tests.start(admin, body);
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.tests.get(id);
  }

  @Post('runs/:id/refresh')
  @HttpCode(200)
  refresh(@Param('id') id: string) {
    return this.tests.refresh(id);
  }

  @Post('runs/:id/simulate')
  @HttpCode(200)
  simulate(@Param('id') id: string, @Body(new ZodValidationPipe(simulateSchema)) body: z.infer<typeof simulateSchema>) {
    return this.tests.simulate(id, body.approve);
  }

  @Post('runs/:id/reverse')
  @HttpCode(200)
  reverse(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    return this.tests.reverse(admin, id);
  }

  @Post('runs/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    return this.tests.cancel(admin, id);
  }
}
