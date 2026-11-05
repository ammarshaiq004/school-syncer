import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { cleanApiKey, defaultMonthlyTokens, monthlyBudget, startOfMonth } from '../assistant/aon-rules.js';
import { AssistantModel } from '../assistant/assistant-model.service.js';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { sealSecrets, secretKeys } from '../fees/gateways/school-accounts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

const keySchema = z.object({ key: z.string().max(400) });
const limitSchema = z.object({ monthlyTokens: z.number().int().min(0).max(1_000_000_000).nullable() });

/**
 * AI and Aon in the console: which API key is in use (the saved key never
 * comes back, only its last four characters), what each school has used this
 * month, and the monthly token budget per school. Owners change things;
 * every change is in the console's audit log.
 */
@Controller('platform/ai')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformAiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly model: AssistantModel,
  ) {}

  @Get()
  async overview() {
    const [{ source }, row, usage] = await Promise.all([
      this.model.keySource(),
      this.prisma.platformAiKey.findUnique({ where: { id: 'default' }, select: { hint: true, updatedAt: true } }),
      this.prisma.assistantUsage.groupBy({
        by: ['schoolId'],
        where: { createdAt: { gte: startOfMonth(new Date()) } },
        _sum: { inputTokens: true, outputTokens: true },
        _count: true,
      }),
    ]);
    const defaultLimit = defaultMonthlyTokens(process.env.ASSISTANT_MONTHLY_TOKENS);
    const schools = await this.prisma.school.findMany({
      where: { OR: [{ id: { in: usage.map((u) => u.schoolId) } }, { aiMonthlyTokens: { not: null } }, { aonEnabled: false }] },
      select: { id: true, name: true, slug: true, aonEnabled: true, aiMonthlyTokens: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const used = new Map(usage.map((u) => [u.schoolId, { tokens: (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0), requests: u._count }]));
    return {
      /** Where the key in use comes from: the console, the server's environment, or nowhere. */
      source,
      consoleKey: row ?? null,
      model: this.model.model,
      defaultMonthlyTokens: defaultLimit,
      schools: schools
        .map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          aonEnabled: s.aonEnabled,
          monthlyTokens: s.aiMonthlyTokens,
          limit: monthlyBudget(s.aiMonthlyTokens, defaultLimit),
          tokensUsed: used.get(s.id)?.tokens ?? 0,
          requests: used.get(s.id)?.requests ?? 0,
        }))
        .sort((a, b) => b.tokensUsed - a.tokensUsed),
    };
  }

  @Put('key')
  @PlatformOwnerOnly()
  async setKey(@CurrentAdmin() admin: PlatformUser, @Body(new ZodValidationPipe(keySchema)) body: z.infer<typeof keySchema>) {
    const key = cleanApiKey(body.key);
    if (!key) throw new BadRequestException('That does not look like an Anthropic API key (it starts with sk-).');
    const sealKey = secretKeys().current;
    if (!sealKey) throw new BadRequestException('PAYMENTS_SECRET_KEY is not set on the server, so the key cannot be stored safely.');
    const data = { sealed: sealSecrets({ key }, sealKey), hint: key.slice(-4), setById: admin.sub };
    await this.prisma.platformAiKey.upsert({ where: { id: 'default' }, create: data, update: data });
    this.model.refresh();
    await logPlatform(this.prisma, admin, 'ai.key.set', null, { hint: data.hint });
    return this.overview();
  }

  @Delete('key')
  @PlatformOwnerOnly()
  @HttpCode(200)
  async clearKey(@CurrentAdmin() admin: PlatformUser) {
    await this.prisma.platformAiKey.deleteMany({ where: { id: 'default' } });
    this.model.refresh();
    await logPlatform(this.prisma, admin, 'ai.key.clear', null, {});
    return this.overview();
  }

  /** A school's monthly token budget; null returns it to the server default, 0 stops its AI. */
  @Patch('schools/:id')
  @PlatformOwnerOnly()
  async setLimit(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(limitSchema)) body: z.infer<typeof limitSchema>,
  ) {
    const school = await this.prisma.school.findUnique({ where: { id }, select: { aiMonthlyTokens: true } });
    if (!school) throw new BadRequestException('No such school');
    await this.prisma.school.update({ where: { id }, data: { aiMonthlyTokens: body.monthlyTokens } });
    await logPlatform(this.prisma, admin, 'ai.limit.set', id, { from: school.aiMonthlyTokens, to: body.monthlyTokens });
    return this.overview();
  }
}
