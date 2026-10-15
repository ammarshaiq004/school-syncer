import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { maskPhone, toInternational } from '../notifications/phone.js';
import { chooseSender } from '../notifications/senders.js';
import { TEMPLATES } from '../notifications/templates.js';
import { scrubText } from '../observability/scrub.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { alertText, planAlerts, type AlertPlan, type Problem } from './alerts.js';
import { monitoringSettings, type MonitoringSettings } from './settings.js';
import { SystemHealthService } from './system-health.service.js';

export const ALERTS_QUEUE = 'monitoring.alerts';
const HOUR_MS = 3_600_000;

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/** The run slot of the alert check: every `every` minutes (UTC). */
export function alertSlot(every: number, now: Date): string {
  const minutes = Math.floor(now.getUTCMinutes() / every) * every;
  return `${now.toISOString().slice(0, 13)}:${String(minutes).padStart(2, '0')}`;
}

/**
 * The recurring alert check (every ALERT_EVERY_MINUTES, 5 by default, on the
 * job queue). It looks for problems (jobs failing for good, messages
 * failing, reconciliation not running, readiness failing), keeps each one in
 * PlatformAlert, and tells platform admins about new problems, still-open
 * ones every ALERT_REPEAT_MINUTES, and resolved ones once. Admins hear
 * through ALERT_WEBHOOK_URL (Slack-compatible JSON) and, for those with a
 * phone number, the platform WhatsApp or SMS sender. With neither, alerts
 * are written to the log and shown in the console.
 */
@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name);
  /** Replaced in tests. */
  fetch: Fetch = (url, init) => fetch(url, init);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly health: SystemHealthService,
  ) {}

  onModuleInit() {
    this.jobs.register(ALERTS_QUEUE, { run: () => this.run().then(() => undefined), backoffMs: 60_000 });
    const every = monitoringSettings().everyMinutes;
    if (every) this.jobs.schedule({ name: 'alerts', queue: ALERTS_QUEUE, slot: (now) => alertSlot(every, now), maxAttempts: 2 });
  }

  /** Every problem the system has right now. */
  async findProblems(now = new Date(), settings: MonitoringSettings = monitoringSettings()): Promise<Problem[]> {
    const problems: Problem[] = [];
    const readiness = await this.health.readiness(now, settings);
    const { database, jobs, reconciliation } = readiness.checks;
    if (!database.ok) problems.push({ key: 'readiness.database', severity: 'critical', summary: database.detail });
    if (jobs && !jobs.ok) problems.push({ key: 'readiness.jobs', severity: 'critical', summary: jobs.detail });
    if (reconciliation && !reconciliation.ok) problems.push({ key: 'reconciliation.stale', severity: 'warning', summary: reconciliation.detail });
    if (!database.ok) return problems;

    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const dead = await this.health.deadSince(hourAgo);
    if (dead >= settings.failedJobs) {
      const { dead: recent } = await this.health.problemJobs(5);
      const queues = [...new Set(recent.map((j) => j.queue))].join(', ');
      problems.push({ key: 'jobs.failed', severity: 'warning', summary: `${dead} background jobs failed for good in the last hour`, detail: `Queues: ${queues}` });
    }

    const messages = await this.health.messages(hourAgo);
    const attempted = messages.sent + messages.failed;
    const percent = attempted ? (messages.failed / attempted) * 100 : 0;
    if (attempted >= settings.messageMinCount && percent >= settings.messageFailurePercent) {
      const worst = messages.bySchool
        .slice(0, 3)
        .map((s) => `${s.schoolName} ${s.failed}/${s.sent + s.failed}`)
        .join(', ');
      problems.push({
        key: 'messages.failing',
        severity: 'warning',
        summary: `${Math.round(percent)}% of messages failed in the last hour (${messages.failed} of ${attempted})`,
        detail: worst ? `Most failures: ${worst}` : undefined,
      });
    }
    return problems;
  }

  /** One alert check: finds problems, records them and notifies; returns what it decided. */
  async run(now = new Date(), settings: MonitoringSettings = monitoringSettings()): Promise<AlertPlan & { notified: boolean }> {
    const problems = await this.findProblems(now, settings);
    const states = await this.prisma.platformAlert.findMany({
      where: { OR: [{ resolvedAt: null }, { key: { in: problems.map((p) => p.key) } }] },
    });
    const plan = planAlerts(states, problems, now, settings.repeatMs);

    for (const { problem, isNew } of plan.open) {
      const fields = { severity: problem.severity, summary: problem.summary, detail: problem.detail ?? '', lastSeenAt: now };
      await this.prisma.platformAlert.upsert({
        where: { key: problem.key },
        create: { key: problem.key, ...fields, openedAt: now },
        update: isNew ? { ...fields, openedAt: now, resolvedAt: null, lastNotifiedAt: null, notifications: 0 } : fields,
      });
    }
    if (plan.resolved.length) {
      await this.prisma.platformAlert.updateMany({ where: { key: { in: plan.resolved.map((r) => r.key) }, resolvedAt: null }, data: { resolvedAt: now } });
    }

    const text = alertText(plan, process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development');
    if (!text) return { ...plan, notified: false };
    const delivered = await this.notify(text, plan, settings);
    // Not marked when every channel failed, so the next run tries again.
    if (delivered) {
      const keys = plan.open.filter((o) => o.notify).map((o) => o.problem.key);
      if (keys.length) {
        await this.prisma.platformAlert.updateMany({ where: { key: { in: keys } }, data: { lastNotifiedAt: now, notifications: { increment: 1 } } });
      }
    }
    return { ...plan, notified: delivered };
  }

  /**
   * Sends one round to the webhook and to admins' phones. True when at least
   * one channel took it, or when none is configured (the log is the channel).
   */
  private async notify(text: string, plan: AlertPlan, settings: MonitoringSettings): Promise<boolean> {
    this.logger.warn(text.replace(/\n/g, ' | '));
    let tried = 0;
    let delivered = 0;
    if (settings.webhookUrl) {
      tried++;
      try {
        const res = await this.fetch(settings.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        delivered++;
      } catch (error) {
        this.logger.error(`Alert webhook failed: ${(error as Error).message}`);
      }
    }

    const sender = chooseSender(process.env, null);
    if (sender.source !== 'log') {
      const admins = await this.prisma.platformAdmin.findMany({ where: { isActive: true, phone: { not: null } }, select: { phone: true } });
      // One line per problem keeps the WhatsApp template's single parameter short.
      const summary = scrubText(
        [...plan.open.filter((o) => o.notify).map((o) => o.problem.summary), ...plan.resolved.map((r) => `resolved: ${r.summary}`)].join('; '),
      ).slice(0, 900);
      for (const { phone } of admins) {
        const to = toInternational(phone!);
        if (!to) continue;
        tried++;
        try {
          await sender.driver.send({ to, template: 'platform.alert', params: { summary }, text: TEMPLATES['platform.alert'].text({ summary }) });
          delivered++;
        } catch (error) {
          this.logger.error(`Alert to ${maskPhone(to)} failed: ${(error as Error).message}`);
        }
      }
    }
    return tried === 0 || delivered > 0;
  }
}
