import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACCOUNT_FIELDS,
  ACCOUNT_PROVIDERS,
  goLiveProblems,
  missingFields,
  sealSecrets,
  secretKey,
  type AccountProvider,
} from './gateways/school-accounts.js';
import { OnlinePaymentsService } from './online-payments.service.js';

const text = (max: number, pattern?: RegExp, message?: string) => {
  const base = z.string().trim().max(max);
  return (pattern ? base.regex(pattern, message) : base).optional();
};

/** What each gateway's account form takes. Secrets left out keep their saved value. */
const SCHEMAS = {
  JAZZCASH: z.object({
    enabled: z.boolean(),
    settings: z.object({ merchantId: text(30, /^[A-Za-z0-9]*$/, 'The merchant ID is letters and digits only') }).default({}),
    secrets: z.object({ password: text(100), integritySalt: text(100) }).default({}),
  }),
  EASYPAISA: z.object({
    enabled: z.boolean(),
    settings: z
      .object({
        storeId: text(20, /^\d*$/, 'The store ID is digits only'),
        username: text(100),
        accountNum: text(30, /^\d*$/, 'The account number is digits only'),
      })
      .default({}),
    secrets: z
      .object({ password: text(100), hashKey: text(16, /^(.{16})?$/, 'The hash key is exactly 16 characters') })
      .default({}),
  }),
  ONEBILL: z.object({
    enabled: z.boolean(),
    settings: z
      .object({ billerPrefix: text(8, /^(\d{3,8})?$/, 'The biller prefix is 3 to 8 digits from 1LINK'), username: text(100) })
      .default({}),
    secrets: z.object({ password: text(100) }).default({}),
  }),
} as const;

const provider = (value: string): AccountProvider => {
  const p = value.toUpperCase() as AccountProvider;
  if (!ACCOUNT_PROVIDERS.includes(p)) throw new BadRequestException('Unknown gateway');
  return p;
};

/** Fees from every campus land in these accounts, so a campus-limited admin cannot change them. */
const NOT_WIDE = 'Only school-wide administrators can change where fees are paid';

/**
 * A school's own JazzCash, Easypaisa and 1Bill merchant accounts, so parents'
 * payments settle straight to the school. Secrets go in, never come out.
 */
@Controller('school/payment-accounts')
@Roles(...SETUP_ROLES)
@Permission('settings')
@RequiresFeature('online_payments')
export class PaymentAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly online: OnlinePaymentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const [rows, { sources }] = await Promise.all([
      this.prisma.schoolPaymentGateway.findMany({ where: { schoolId: user.schoolId } }),
      this.online.configFor(user.schoolId),
    ]);
    const accounts = await this.online.schoolAccounts(user.schoolId);
    const api = `${this.online.config.apiUrl}/api/payments`;
    return {
      mode: this.online.config.mode,
      canSaveSecrets: Boolean(secretKey()),
      problems: goLiveProblems(this.online.config),
      /** Addresses to give each gateway when the account is set up. */
      urls: {
        JAZZCASH: { returnUrl: `${api}/return/jazzcash`, ipnUrl: `${api}/ipn/jazzcash` },
        EASYPAISA: { postBackUrl: `${api}/return/easypaisa`, ipnUrl: `${api}/ipn/easypaisa` },
        ONEBILL: { billInquiryUrl: `${api}/1bill/bill-inquiry`, billPaymentUrl: `${api}/1bill/bill-payment` },
      },
      gateways: ACCOUNT_PROVIDERS.map((p) => {
        const row = rows.find((r) => r.provider === p);
        const account = accounts.find((a) => a.provider === p);
        return {
          provider: p,
          /** Where payments go now: the school's own account, the server's, or nowhere. */
          source: sources[p],
          ownAccount: row
            ? {
                enabled: row.enabled,
                settings: row.settings as Record<string, string>,
                secretsSet: Object.fromEntries(ACCOUNT_FIELDS[p].secrets.map((k) => [k, Boolean(account?.secrets[k])])),
                missing: missingFields(p, (row.settings ?? {}) as Record<string, string>, account?.secrets ?? {}),
                updatedAt: row.updatedAt.toISOString(),
              }
            : null,
        };
      }),
    };
  }

  @Put(':provider')
  async save(@CurrentUser() user: AuthUser, @Param('provider') raw: string, @Body() body: unknown) {
    assertSchoolWide(user, NOT_WIDE);
    const p = provider(raw);
    const input = new ZodValidationPipe(SCHEMAS[p] as z.ZodType).transform(body) as {
      enabled: boolean;
      settings: Record<string, string | undefined>;
      secrets: Record<string, string | undefined>;
    };
    const key = secretKey();
    const newSecrets = Object.entries(input.secrets).filter(([, v]) => v);
    if (newSecrets.length && !key) {
      throw new BadRequestException('The server has no PAYMENTS_SECRET_KEY yet, so merchant secrets cannot be stored safely. Ask your SchoolSyncer administrator.');
    }
    const settings = Object.fromEntries(Object.entries(input.settings).filter(([, v]) => v !== undefined)) as Record<string, string>;
    if (p === 'ONEBILL' && settings.billerPrefix) {
      const clash = await this.prisma.schoolPaymentGateway.findFirst({
        where: { provider: PaymentMethod.ONEBILL, schoolId: { not: user.schoolId }, settings: { path: ['billerPrefix'], equals: settings.billerPrefix } },
      });
      if (clash || settings.billerPrefix === this.online.config.onebill.billerPrefix) {
        throw new ConflictException('Another biller already uses this prefix. Check the prefix 1LINK gave you.');
      }
    }

    const existing = (await this.online.schoolAccounts(user.schoolId)).find((a) => a.provider === p);
    const secrets = { ...existing?.secrets, ...Object.fromEntries(newSecrets) } as Record<string, string>;
    const sealed = key && Object.keys(secrets).length ? sealSecrets(secrets, key) : '';
    const data = { enabled: input.enabled, settings, secrets: sealed, updatedById: user.sub };
    await this.prisma.schoolPaymentGateway.upsert({
      where: { schoolId_provider: { schoolId: user.schoolId, provider: p } },
      create: { schoolId: user.schoolId, provider: p, ...data },
      update: data,
    });
    this.online.forget(user.schoolId);
    await this.audit.record(user, 'payments.account.save', 'SchoolPaymentGateway', p, {
      // Which secrets changed, never their values.
      after: { enabled: input.enabled, settings, secretsChanged: newSecrets.map(([k]) => k) },
    });
    return this.list(user);
  }

  /** Removes the school's own account; the server's account (if any) takes over. */
  @Delete(':provider')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('provider') raw: string) {
    assertSchoolWide(user, NOT_WIDE);
    const p = provider(raw);
    await this.prisma.schoolPaymentGateway.deleteMany({ where: { schoolId: user.schoolId, provider: p } });
    this.online.forget(user.schoolId);
    await this.audit.record(user, 'payments.account.remove', 'SchoolPaymentGateway', p);
    return this.list(user);
  }
}
