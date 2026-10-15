import { Injectable, Logger } from '@nestjs/common';
import { openSecrets, secretKeys } from '../fees/gateways/school-accounts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpSmsDriver, LogDriver, smsGatewayConfig, WhatsAppDriver, type MessageDriver } from './drivers.js';

/** Whose account sends a school's messages. */
export type SenderSource = 'school' | 'platform' | 'log';

export interface Sender {
  source: SenderSource;
  driver: MessageDriver;
}

/** A school's own WhatsApp sender, decrypted. */
export interface SchoolSender {
  enabled: boolean;
  phoneNumberId: string;
  token: string;
}

/**
 * Who delivers a school's messages, first match wins:
 * 1. the school's own WhatsApp Cloud API number (System settings > Messaging), when enabled and complete;
 * 2. the platform WhatsApp number (NOTIFY_DRIVER=whatsapp with WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID);
 * 3. the platform SMS gateway (NOTIFY_DRIVER=sms with SMS_GATEWAY_URL);
 * 4. nobody: messages are only logged (status LOGGED, not delivered).
 */
export function chooseSender(env: Record<string, string | undefined>, own: SchoolSender | null): Sender {
  const language = env.WHATSAPP_LANGUAGE?.trim() || 'en';
  if (own?.enabled && own.phoneNumberId && own.token) {
    return { source: 'school', driver: new WhatsAppDriver({ token: own.token, phoneNumberId: own.phoneNumberId, language }) };
  }
  const driver = env.NOTIFY_DRIVER?.trim().toLowerCase();
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (driver === 'whatsapp' && token && phoneNumberId) {
    return { source: 'platform', driver: new WhatsAppDriver({ token, phoneNumberId, language }) };
  }
  const sms = smsGatewayConfig(env);
  if (driver === 'sms' && sms) return { source: 'platform', driver: new HttpSmsDriver(sms) };
  return { source: 'log', driver: new LogDriver() };
}

/** Resolves (and caches for a minute) each school's sender. */
@Injectable()
export class MessagingSenders {
  private readonly logger = new Logger(MessagingSenders.name);
  private cache = new Map<string, { at: number; value: Promise<Sender> }>();

  constructor(private readonly prisma: PrismaService) {}

  /** The school's own sender with its token decrypted; null when it has none (or it cannot be read). */
  async schoolSender(schoolId: string): Promise<SchoolSender | null> {
    const row = await this.prisma.schoolMessagingSender.findUnique({ where: { schoolId } });
    if (!row) return null;
    const keys = secretKeys().all;
    try {
      if (row.secrets && !keys.length) throw new Error('PAYMENTS_SECRET_KEY is not set');
      const secrets = keys.length && row.secrets ? openSecrets(row.secrets, keys) : {};
      return { enabled: row.enabled, phoneNumberId: row.phoneNumberId, token: secrets.token ?? '' };
    } catch (error) {
      this.logger.error(`Cannot read the WhatsApp sender of school ${schoolId}: ${(error as Error).message}`);
      return { enabled: false, phoneNumberId: row.phoneNumberId, token: '' };
    }
  }

  forSchool(schoolId: string): Promise<Sender> {
    const hit = this.cache.get(schoolId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    if (this.cache.size > 5_000) this.cache.clear();
    const value = this.schoolSender(schoolId).then((own) => chooseSender(process.env, own));
    this.cache.set(schoolId, { at: Date.now(), value });
    value.catch(() => this.cache.delete(schoolId));
    return value;
  }

  /** After a school changes its sender. */
  forget(schoolId: string) {
    this.cache.delete(schoolId);
  }
}
