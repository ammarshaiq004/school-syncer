import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { toInternational } from './phone.js';
import { loggableText, TEMPLATES, type TemplateKey } from './templates.js';

export interface OutgoingMessage {
  to: string;
  template: TemplateKey;
  params: Record<string, string>;
}

/**
 * Logs every outbound message and delivers it. With NOTIFY_DRIVER=whatsapp and
 * WhatsApp Cloud API credentials set, messages go to WhatsApp; otherwise
 * (the default, "log") they are only written to the log, for development.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Queues messages and delivers them in the background; returns the queued count. */
  async send(schoolId: string, messages: OutgoingMessage[]): Promise<number> {
    const unique = new Map(
      messages
        .filter((m) => m.to)
        .map((m) => [`${toInternational(m.to)}|${m.template}|${JSON.stringify(m.params)}`, m]),
    );
    const logs = await Promise.all(
      [...unique.values()].map((m) =>
        this.prisma.notificationLog.create({
          data: {
            schoolId,
            channel: Channel.WHATSAPP,
            to: toInternational(m.to),
            template: m.template,
            body: loggableText(m.template, m.params),
          },
        }),
      ),
    );
    const byId = new Map([...unique.values()].map((m, i) => [logs[i].id, m]));
    void Promise.all(
      logs.map((log) => this.deliver(log.id, log.to, byId.get(log.id)!)),
    );
    return logs.length;
  }

  private async deliver(logId: string, to: string, message: OutgoingMessage) {
    try {
      if (this.config.get('NOTIFY_DRIVER', 'log') === 'whatsapp') {
        await this.sendWhatsApp(to, message);
      } else {
        this.logger.log(`[${message.template}] to ${to}: ${loggableText(message.template, message.params)}`);
      }
      await this.prisma.notificationLog.update({
        where: { id: logId },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(`Delivery failed for ${logId}: ${(error as Error).message}`);
      await this.prisma.notificationLog
        .update({
          where: { id: logId },
          data: { status: NotificationStatus.FAILED, error: (error as Error).message.slice(0, 500) },
        })
        .catch(() => undefined);
    }
  }

  private async sendWhatsApp(to: string, message: OutgoingMessage) {
    const token = this.config.getOrThrow<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    const template = TEMPLATES[message.template];
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: template.whatsapp,
            language: { code: this.config.get('WHATSAPP_LANGUAGE', 'en') },
            components: [
              {
                type: 'body',
                parameters: template.params.map((key) => ({
                  type: 'text',
                  text: message.params[key] ?? '',
                })),
              },
            ],
          },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
    }
  }
}
