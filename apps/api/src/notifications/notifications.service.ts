import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { openSecrets, sealSecrets, secretKey, secretKeys } from '../fees/gateways/school-accounts.js';
import { JobsService, PermanentJobError, type JobInfo } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeliveryError } from './drivers.js';
import { maskPhone, maskPhonesIn, toInternational } from './phone.js';
import { MessagingSenders } from './senders.js';
import { loggableText, secretParams, TEMPLATES, type TemplateKey } from './templates.js';

export interface OutgoingMessage {
  to: string;
  template: TemplateKey;
  params: Record<string, string>;
}

export const DELIVER_QUEUE = 'notifications.deliver';
/** Attempts before a message is marked FAILED: about 15 minutes of retries in all. */
export const DELIVERY_ATTEMPTS = 5;

/** What a delivery job carries. Secret parameters are sealed when PAYMENTS_SECRET_KEY is set. */
interface DeliverPayload {
  logId: string;
  params: Record<string, string>;
  sealed?: string;
  secrets?: Record<string, string>;
}

/**
 * Logs every outbound message and delivers it through the job queue. Each
 * message is a NotificationLog row (QUEUED) plus a delivery job; the row
 * becomes SENT only when the provider accepts it, FAILED (with the error)
 * once the retries are used up, or LOGGED when no provider is configured,
 * which means nothing reached the recipient. See MessagingSenders for which
 * number or gateway sends a school's messages.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly senders: MessagingSenders,
  ) {}

  onModuleInit() {
    this.jobs.register<DeliverPayload>(DELIVER_QUEUE, {
      run: (payload, job) => this.deliver(payload, job),
      failed: (payload, job, error) => this.markFailed(payload.logId, job, error),
      // Delivered or failed messages keep no parameters (passwords, reset codes) in the queue.
      scrub: (payload) => ({ logId: payload.logId }),
      backoffMs: 30_000,
    });
  }

  /**
   * Queues messages for delivery; returns the queued count. `urgent` puts
   * them ahead of bulk sends (a password reset code ahead of fee vouchers).
   */
  async send(schoolId: string, messages: OutgoingMessage[], opts: { urgent?: boolean } = {}): Promise<number> {
    const unique = [
      ...new Map(
        messages
          .filter((m) => m.to)
          .map((m) => [`${toInternational(m.to)}|${m.template}|${JSON.stringify(m.params)}`, m]),
      ).values(),
    ];
    if (!unique.length) return 0;
    const sender = await this.senders.forSchool(schoolId);
    const key = secretKey();
    const rows = unique.map((m) => ({
      id: randomUUID(),
      schoolId,
      channel: sender.driver.channel,
      sender: sender.source,
      to: toInternational(m.to),
      template: m.template,
      body: loggableText(m.template, m.params),
    }));
    const payloads = unique.map((m, i): DeliverPayload => {
      const secret = secretParams(m.template);
      const params = Object.fromEntries(Object.entries(m.params).filter(([k]) => !secret.includes(k)));
      const hidden = Object.fromEntries(Object.entries(m.params).filter(([k]) => secret.includes(k)));
      if (!Object.keys(hidden).length) return { logId: rows[i].id, params };
      return key ? { logId: rows[i].id, params, sealed: sealSecrets(hidden, key) } : { logId: rows[i].id, params, secrets: hidden };
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.notificationLog.createMany({ data: rows });
      await this.jobs.enqueueMany(DELIVER_QUEUE, payloads as unknown as Record<string, unknown>[], {
        tx,
        maxAttempts: DELIVERY_ATTEMPTS,
        priority: opts.urgent ? 10 : 0,
      });
    });
    this.jobs.onEnqueue?.();
    return rows.length;
  }

  /** Delivers one message; throws to have the job retried. */
  async deliver(payload: DeliverPayload, job: JobInfo) {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: payload.logId } });
    // Gone with its school, or already settled by an earlier attempt.
    if (!log || log.status !== NotificationStatus.QUEUED) return;
    const template = log.template as TemplateKey;
    if (!(template in TEMPLATES)) throw new PermanentJobError(`Unknown template ${log.template}`);
    const keys = secretKeys().all;
    const params = {
      ...payload.params,
      ...payload.secrets,
      ...(payload.sealed && keys.length ? openSecrets(payload.sealed, keys) : {}),
    };
    const sender = await this.senders.forSchool(log.schoolId);
    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: { attempts: job.attempt, channel: sender.driver.channel, sender: sender.source },
    });
    const masked = maskPhone(log.to);
    let result;
    try {
      result = await sender.driver.send({ to: log.to, template, params, text: TEMPLATES[template].text(params) });
    } catch (e) {
      const message = maskPhonesIn((e as Error).message);
      this.logger.warn(`Attempt ${job.attempt}/${job.maxAttempts} of ${log.template} to ${masked} failed: ${message}`);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { error: (e as Error).message.slice(0, 500) } });
      throw e instanceof DeliveryError && e.permanent ? new PermanentJobError((e as Error).message) : e;
    }
    if (sender.source === 'log') {
      this.logger.log(`[${log.template}] not delivered (no provider configured) to ${masked}: ${log.body}`);
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: NotificationStatus.LOGGED, error: null },
      });
      return;
    }
    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        error: null,
        providerMessageId: result.providerMessageId ?? null,
      },
    });
  }

  private async markFailed(logId: string, job: JobInfo, error: Error) {
    await this.prisma.notificationLog.updateMany({
      where: { id: logId, status: NotificationStatus.QUEUED },
      data: { status: NotificationStatus.FAILED, attempts: job.attempt, error: error.message.slice(0, 500) },
    });
  }
}
