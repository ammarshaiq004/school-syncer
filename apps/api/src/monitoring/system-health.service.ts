import { Injectable, Logger } from '@nestjs/common';
import { JobStatus, NotificationStatus, ReconciliationIssueStatus, ReconciliationStatus } from '@prisma/client';
import { gatewayConfig } from '../fees/gateways/gateway-config.js';
import { ACCOUNT_PROVIDERS } from '../fees/gateways/school-accounts.js';
import { RECONCILE_QUEUE, reconcileAt } from '../fees/reconciliation/reconciliation.scheduler.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ApiErrorCounter } from '../observability/api-errors.js';
import { scrubText } from '../observability/scrub.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monitoringSettings, type MonitoringSettings } from './settings.js';

/** How long the database may take to answer before the API counts as down. */
const DB_TIMEOUT_MS = 3000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface Check {
  ok: boolean;
  /** One line for people: what is wrong, or what was checked. */
  detail: string;
}

export interface JobsCheck extends Check {
  due: number;
  /** Seconds the oldest due job has waited. */
  lagSeconds: number;
}

export interface ReconciliationCheck extends Check {
  /** Off when RECONCILE_AT=off or PAYMENTS_MODE=off: nothing to reconcile. */
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface Readiness {
  status: 'ok' | 'error';
  checks: { database: Check; jobs?: JobsCheck; reconciliation?: ReconciliationCheck };
}

/** One queue's jobs right now (dead = failed for good, retrying = failed an attempt, due again later). */
export interface QueueStats {
  queue: string;
  due: number;
  scheduled: number;
  running: number;
  retrying: number;
  dead: number;
  dead24h: number;
  done24h: number;
  oldestDueAt: string | null;
}

const ago = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
};

/**
 * What readiness, the console's System health page and the alert job know
 * about the running system: the database, the job queue, message delivery,
 * server errors and payment reconciliation. Read-only.
 */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiErrors: ApiErrorCounter,
    private readonly jobQueue: JobsService,
  ) {}

  /** Whether the database answers within DB_TIMEOUT_MS. */
  async database(): Promise<Check> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer in ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS);
        }),
      ]);
      return { ok: true, detail: 'The database answers' };
    } catch (error) {
      this.logger.error(`Database check failed: ${(error as Error).message}`);
      return { ok: false, detail: 'The database does not answer' };
    } finally {
      clearTimeout(timer);
    }
  }

  async jobs(now = new Date(), settings: MonitoringSettings = monitoringSettings()): Promise<JobsCheck> {
    const due = { status: JobStatus.PENDING, runAt: { lte: now } };
    const [count, oldest] = await Promise.all([
      this.prisma.job.count({ where: due }),
      this.prisma.job.aggregate({ where: due, _min: { runAt: true } }),
    ]);
    const lagMs = oldest._min.runAt ? Math.max(0, now.getTime() - oldest._min.runAt.getTime()) : 0;
    const problems = [
      ...(lagMs > settings.maxJobLagMs ? [`the oldest due job has waited ${ago(lagMs)}: is a worker running (JOBS_WORKER)?`] : []),
      ...(count > settings.maxJobBacklog ? [`${count} jobs are due at once`] : []),
    ];
    return {
      ok: problems.length === 0,
      detail: problems.length ? `Job queue: ${problems.join('; ')}` : `${count} job(s) due`,
      due: count,
      lagSeconds: Math.round(lagMs / 1000),
    };
  }

  /**
   * The nightly reconciliation: when it last succeeded (a finished job, or
   * the latest automatic run of any school, which outlives the job rows) and
   * whether it has failed since.
   */
  async reconciliation(now = new Date(), settings: MonitoringSettings = monitoringSettings()): Promise<ReconciliationCheck> {
    const enabled = reconcileAt() !== null && gatewayConfig().mode !== 'off';
    const [doneJob, failedJob, run] = await Promise.all([
      this.prisma.job.findFirst({ where: { queue: RECONCILE_QUEUE, status: JobStatus.DONE }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
      this.prisma.job.findFirst({ where: { queue: RECONCILE_QUEUE, status: JobStatus.FAILED }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
      this.prisma.paymentReconciliation.findFirst({
        where: { trigger: 'auto', status: { in: [ReconciliationStatus.CLEAN, ReconciliationStatus.ISSUES] }, finishedAt: { not: null } },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      }),
    ]);
    const times = [doneJob?.finishedAt, run?.finishedAt].filter((d): d is Date => !!d).map((d) => d.getTime());
    const success = times.length ? Math.max(...times) : null;
    const failure = failedJob?.finishedAt?.getTime() ?? null;
    const base = {
      enabled,
      lastSuccessAt: success ? new Date(success).toISOString() : null,
      lastFailureAt: failure ? new Date(failure).toISOString() : null,
    };
    if (!enabled) return { ...base, ok: true, detail: 'Nightly reconciliation is off (RECONCILE_AT or PAYMENTS_MODE)' };
    if (failure && (!success || failure > success)) {
      return { ...base, ok: false, detail: `The nightly reconciliation failed ${ago(now.getTime() - failure)} ago and has not succeeded since` };
    }
    if (!success) return { ...base, ok: true, detail: 'The nightly reconciliation has not run yet' };
    if (now.getTime() - success > settings.maxReconcileAgeMs) {
      return { ...base, ok: false, detail: `The nightly reconciliation last succeeded ${ago(now.getTime() - success)} ago` };
    }
    return { ...base, ok: true, detail: `Last succeeded ${ago(now.getTime() - success)} ago` };
  }

  /** Database, job queue and reconciliation; the database first, since the others need it. */
  async readiness(now = new Date(), settings: MonitoringSettings = monitoringSettings()): Promise<Readiness> {
    const database = await this.database();
    if (!database.ok) return { status: 'error', checks: { database } };
    try {
      const [jobs, reconciliation] = await Promise.all([this.jobs(now, settings), this.reconciliation(now, settings)]);
      return { status: jobs.ok && reconciliation.ok ? 'ok' : 'error', checks: { database, jobs, reconciliation } };
    } catch (error) {
      this.logger.error(`Readiness check failed: ${(error as Error).message}`);
      return { status: 'error', checks: { database: { ok: false, detail: 'The database answered but a check failed' } } };
    }
  }

  /** Per-queue counts: due, scheduled, running, retrying, dead (all and last 24h), done in 24h. */
  async queues(now = new Date()): Promise<QueueStats[]> {
    const since = new Date(now.getTime() - DAY_MS);
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT "queue",
        count(*) FILTER (WHERE "status" = 'PENDING' AND "runAt" <= ${now.toISOString()}::timestamp) AS "due",
        count(*) FILTER (WHERE "status" = 'PENDING' AND "runAt" > ${now.toISOString()}::timestamp) AS "scheduled",
        count(*) FILTER (WHERE "status" = 'RUNNING') AS "running",
        count(*) FILTER (WHERE "status" = 'PENDING' AND "attempts" > 0) AS "retrying",
        count(*) FILTER (WHERE "status" = 'FAILED') AS "dead",
        count(*) FILTER (WHERE "status" = 'FAILED' AND "finishedAt" >= ${since.toISOString()}::timestamp) AS "dead24h",
        count(*) FILTER (WHERE "status" = 'DONE' AND "finishedAt" >= ${since.toISOString()}::timestamp) AS "done24h",
        min("runAt") FILTER (WHERE "status" = 'PENDING' AND "runAt" <= ${now.toISOString()}::timestamp) AS "oldestDueAt"
      FROM "Job" GROUP BY "queue" ORDER BY "queue"`;
    return rows.map((r) => ({
      queue: r.queue as string,
      due: Number(r.due),
      scheduled: Number(r.scheduled),
      running: Number(r.running),
      retrying: Number(r.retrying),
      dead: Number(r.dead),
      dead24h: Number(r.dead24h),
      done24h: Number(r.done24h),
      oldestDueAt: r.oldestDueAt ? (r.oldestDueAt as Date).toISOString() : null,
    }));
  }

  /** Jobs that failed for good (newest first) and ones failing but still being retried. */
  async problemJobs(limit = 50) {
    const select = { id: true, queue: true, attempts: true, maxAttempts: true, lastError: true, runAt: true, createdAt: true, finishedAt: true } as const;
    const [dead, retrying] = await Promise.all([
      this.prisma.job.findMany({ where: { status: JobStatus.FAILED }, orderBy: { finishedAt: 'desc' }, take: limit, select }),
      this.prisma.job.findMany({ where: { status: JobStatus.PENDING, attempts: { gt: 0 } }, orderBy: { runAt: 'asc' }, take: limit, select }),
    ]);
    // Errors can quote a phone number or a provider's answer.
    const clean = <T extends { lastError: string | null }>(j: T) => ({ ...j, lastError: j.lastError ? scrubText(j.lastError) : null });
    return { dead: dead.map(clean), retrying: retrying.map(clean) };
  }

  /** Jobs that failed for good since `since`. */
  deadSince(since: Date) {
    return this.prisma.job.count({ where: { status: JobStatus.FAILED, finishedAt: { gte: since } } });
  }

  /**
   * Message delivery since `since`: totals, and per school the ones with
   * failures (most failures first), with the latest error.
   */
  async messages(since: Date) {
    const groups = await this.prisma.notificationLog.groupBy({ by: ['schoolId', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const bySchool = new Map<string, Record<NotificationStatus, number>>();
    for (const g of groups) {
      const counts = bySchool.get(g.schoolId) ?? { QUEUED: 0, SENT: 0, LOGGED: 0, FAILED: 0 };
      counts[g.status] = g._count._all;
      bySchool.set(g.schoolId, counts);
    }
    const failing = [...bySchool].filter(([, c]) => c.FAILED > 0).sort((a, b) => b[1].FAILED - a[1].FAILED);
    const ids = failing.slice(0, 50).map(([id]) => id);
    const [schools, errors] = await Promise.all([
      this.prisma.school.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }),
      Promise.all(
        ids.map((schoolId) =>
          this.prisma.notificationLog.findFirst({
            where: { schoolId, status: NotificationStatus.FAILED, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            select: { error: true },
          }),
        ),
      ),
    ]);
    const total = (c: Record<NotificationStatus, number>) => c.QUEUED + c.SENT + c.LOGGED + c.FAILED;
    const all = [...bySchool.values()];
    return {
      since: since.toISOString(),
      total: all.reduce((n, c) => n + total(c), 0),
      sent: all.reduce((n, c) => n + c.SENT, 0),
      failed: all.reduce((n, c) => n + c.FAILED, 0),
      bySchool: ids.map((id, i) => {
        const c = bySchool.get(id)!;
        const school = schools.find((s) => s.id === id);
        return {
          schoolId: id,
          schoolName: school?.name ?? 'Deleted school',
          slug: school?.slug ?? null,
          total: total(c),
          sent: c.SENT,
          failed: c.FAILED,
          queued: c.QUEUED,
          lastError: errors[i]?.error ? scrubText(errors[i]!.error!) : null,
        };
      }),
    };
  }

  /**
   * Per gateway: the latest finished reconciliation that covered it (any
   * school), failed runs in the last day, and open issues.
   */
  async gateways(now = new Date()) {
    const since = new Date(now.getTime() - DAY_MS);
    const [latest, issues, failed] = await Promise.all([
      this.prisma.$queryRaw<{ provider: string; finishedAt: Date; status: string; date: Date; trigger: string }[]>`
        SELECT DISTINCT ON (g."provider") g."provider", r."finishedAt", r."status"::text AS "status", r."date", r."trigger"
        FROM "PaymentReconciliation" r CROSS JOIN LATERAL jsonb_object_keys(r."totals") AS g("provider")
        WHERE r."finishedAt" IS NOT NULL AND jsonb_typeof(r."totals") = 'object'
        ORDER BY g."provider", r."finishedAt" DESC`,
      this.prisma.reconciliationIssue.groupBy({ by: ['provider'], where: { status: ReconciliationIssueStatus.OPEN }, _count: { _all: true } }),
      this.prisma.paymentReconciliation.count({ where: { status: ReconciliationStatus.FAILED, startedAt: { gte: since } } }),
    ]);
    return {
      failedRuns24h: failed,
      gateways: ACCOUNT_PROVIDERS.map((provider) => {
        const run = latest.find((r) => r.provider === provider);
        return {
          provider,
          lastRunAt: run?.finishedAt.toISOString() ?? null,
          lastStatus: run?.status ?? null,
          lastDate: run ? run.date.toISOString().slice(0, 10) : null,
          lastTrigger: run?.trigger ?? null,
          openIssues: issues.find((i) => i.provider === provider)?._count._all ?? 0,
        };
      }),
    };
  }

  /** Everything the console's System health page shows. */
  async overview(now = new Date()) {
    const settings = monitoringSettings();
    const [readiness, queues, jobs, messages, apiErrors, reconciliation, alerts] = await Promise.all([
      this.readiness(now, settings),
      this.queues(now),
      this.problemJobs(),
      this.messages(new Date(now.getTime() - DAY_MS)),
      this.apiErrors.recent(now.getTime()),
      this.gateways(now),
      this.prisma.platformAlert.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: 'desc' } }),
    ]);
    return {
      generatedAt: now.toISOString(),
      readiness,
      queues,
      deadJobs: jobs.dead.map((j) => ({ ...j, retryable: this.jobQueue.canRetry(j.queue) })),
      retryingJobs: jobs.retrying,
      messages,
      apiErrors: { total: apiErrors.reduce((n, h) => n + h.count, 0), hours: apiErrors },
      reconciliation: { ...reconciliation, nightly: readiness.checks.reconciliation ?? null },
      alerts,
    };
  }
}
