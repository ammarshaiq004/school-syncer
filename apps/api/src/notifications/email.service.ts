import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Channel, NotificationStatus } from '@prisma/client';
import { createTransport, type Transporter } from 'nodemailer';
import { JobsService, PermanentJobError, type JobInfo } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DELIVERY_ATTEMPTS } from './notifications.service.js';

export const EMAIL_QUEUE = 'email.deliver';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** What the delivery log calls it, e.g. "platform.billing". */
  template: string;
}

/** SMTP settings from EMAIL_SMTP_URL and EMAIL_FROM; null when email is not set up. */
export function emailConfig(env: Record<string, string | undefined> = process.env) {
  const url = env.EMAIL_SMTP_URL?.trim();
  const from = env.EMAIL_FROM?.trim();
  return url && from ? { url, from } : null;
}

/**
 * Email through any SMTP provider (EMAIL_SMTP_URL, e.g.
 * smtps://user:pass@smtp.example.com:465, and EMAIL_FROM). Like SMS, each
 * email is a NotificationLog row (channel EMAIL) delivered by a retried job:
 * SENT once the server accepts it, FAILED after the last attempt, or LOGGED
 * when no SMTP server is configured, which means nothing was sent.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transport: { url: string; transporter: Transporter } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register<{ logId: string; subject: string; text: string }>(EMAIL_QUEUE, {
      run: (payload, job) => this.deliver(payload, job),
      failed: (payload, job, error) => this.markFailed(payload.logId, job, error),
      scrub: (payload) => ({ logId: payload.logId }),
      backoffMs: 60_000,
    });
  }

  /** Queues emails for a school's delivery log; returns how many were queued. */
  async send(schoolId: string, emails: OutgoingEmail[]): Promise<number> {
    const unique = [...new Map(emails.filter((e) => e.to.includes('@')).map((e) => [`${e.to.toLowerCase()}|${e.subject}`, e])).values()];
    for (const e of unique) {
      const log = await this.prisma.notificationLog.create({
        data: {
          schoolId,
          channel: Channel.EMAIL,
          sender: emailConfig() ? 'platform' : 'log',
          to: e.to.toLowerCase(),
          template: e.template,
          body: `${e.subject}\n${e.text}`.slice(0, 2000),
        },
      });
      await this.jobs.enqueue(EMAIL_QUEUE, { logId: log.id, subject: e.subject, text: e.text }, { maxAttempts: DELIVERY_ATTEMPTS });
    }
    return unique.length;
  }

  async deliver(payload: { logId: string; subject: string; text: string }, job: JobInfo) {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: payload.logId } });
    if (!log || log.status !== NotificationStatus.QUEUED) return;
    await this.prisma.notificationLog.update({ where: { id: log.id }, data: { attempts: job.attempt } });
    const config = emailConfig();
    if (!config) {
      this.logger.log(`[${log.template}] email not sent (no SMTP server configured) to ${log.to}: ${payload.subject}`);
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { status: NotificationStatus.LOGGED, sender: 'log' } });
      return;
    }
    let info;
    try {
      info = await this.transporter(config.url).sendMail({ from: config.from, to: log.to, subject: payload.subject, text: payload.text });
    } catch (e) {
      const err = e as Error & { responseCode?: number };
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { error: err.message.slice(0, 500) } });
      // 5xx SMTP replies (bad address, rejected) will not succeed on retry.
      throw err.responseCode && err.responseCode >= 500 ? new PermanentJobError(err.message) : err;
    }
    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: NotificationStatus.SENT, sentAt: new Date(), error: null, sender: 'platform', providerMessageId: info.messageId ?? null },
    });
  }

  private transporter(url: string): Transporter {
    if (this.transport?.url !== url) this.transport = { url, transporter: createTransport(url) };
    return this.transport.transporter;
  }

  private async markFailed(logId: string, job: JobInfo, error: Error) {
    await this.prisma.notificationLog.updateMany({
      where: { id: logId, status: NotificationStatus.QUEUED },
      data: { status: NotificationStatus.FAILED, attempts: job.attempt, error: error.message.slice(0, 500) },
    });
  }
}
