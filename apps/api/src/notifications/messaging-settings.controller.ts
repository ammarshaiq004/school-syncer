import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { sealSecrets, secretKey } from '../fees/gateways/school-accounts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { smsGatewayConfig } from './drivers.js';
import { MessagingSenders } from './senders.js';

const senderSchema = z.object({
  enabled: z.boolean(),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{0,30}$/, 'The phone number ID is the long number Meta shows under WhatsApp > API setup')
    .optional(),
  /** Left out (or empty) keeps the saved token. */
  token: z.string().trim().max(1000).optional(),
});
type SenderInput = z.infer<typeof senderSchema>;

/** Every campus's messages go out from this number, so a campus-limited admin cannot change it. */
const NOT_WIDE = 'Only school-wide administrators can change how messages are sent';

/**
 * A school's own WhatsApp Cloud API number, so parents get messages from the
 * school rather than the platform's number. The access token is encrypted
 * like merchant secrets (PAYMENTS_SECRET_KEY) and never sent back.
 */
@Controller('school/messaging')
@Roles(...SETUP_ROLES)
@Permission('settings')
export class MessagingSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: MessagingSenders,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const [row, own, active] = await Promise.all([
      this.prisma.schoolMessagingSender.findUnique({ where: { schoolId: user.schoolId } }),
      this.senders.schoolSender(user.schoolId),
      this.senders.forSchool(user.schoolId),
    ]);
    const env = process.env;
    const driver = env.NOTIFY_DRIVER?.trim().toLowerCase();
    return {
      canSaveSecrets: Boolean(secretKey()),
      /** Who sends now: "school", "platform" or "log" (nothing is delivered). */
      active: { source: active.source, channel: active.driver.kind === 'log' ? null : active.driver.channel },
      platform: {
        whatsapp: driver === 'whatsapp' && Boolean(env.WHATSAPP_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
        sms: driver === 'sms' && Boolean(smsGatewayConfig(env)),
      },
      ownSender: row
        ? {
            enabled: row.enabled,
            phoneNumberId: row.phoneNumberId,
            tokenSet: Boolean(own?.token),
            updatedAt: row.updatedAt.toISOString(),
          }
        : null,
    };
  }

  @Put()
  async save(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(senderSchema)) input: SenderInput) {
    assertSchoolWide(user, NOT_WIDE);
    const key = secretKey();
    if (input.token && !key) {
      throw new BadRequestException(
        'The server has no PAYMENTS_SECRET_KEY yet, so the WhatsApp token cannot be stored safely. Ask your SchoolSyncer administrator.',
      );
    }
    const existing = await this.senders.schoolSender(user.schoolId);
    const token = input.token || existing?.token || '';
    const phoneNumberId = input.phoneNumberId ?? existing?.phoneNumberId ?? '';
    if (input.enabled && (!phoneNumberId || !token)) {
      throw new BadRequestException('Enter the phone number ID and the access token to send from your own number.');
    }
    const data = {
      enabled: input.enabled,
      phoneNumberId,
      secrets: key && token ? sealSecrets({ token }, key) : '',
      updatedById: user.sub,
    };
    await this.prisma.schoolMessagingSender.upsert({
      where: { schoolId: user.schoolId },
      create: { schoolId: user.schoolId, ...data },
      update: data,
    });
    this.senders.forget(user.schoolId);
    await this.audit.record(user, 'messaging.sender.save', 'SchoolMessagingSender', user.schoolId, {
      // Whether the token changed, never its value.
      after: { enabled: input.enabled, phoneNumberId, tokenChanged: Boolean(input.token) },
    });
    return this.get(user);
  }

  /** Removes the school's own number; the platform sender (if any) takes over. */
  @Delete()
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser) {
    assertSchoolWide(user, NOT_WIDE);
    await this.prisma.schoolMessagingSender.deleteMany({ where: { schoolId: user.schoolId } });
    this.senders.forget(user.schoolId);
    await this.audit.record(user, 'messaging.sender.remove', 'SchoolMessagingSender', user.schoolId);
    return this.get(user);
  }
}
