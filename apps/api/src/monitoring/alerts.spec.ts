import { Logger } from '@nestjs/common';
import type { JobsService } from '../jobs/jobs.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { alertText, planAlerts, type AlertState, type Problem } from './alerts.js';
import { alertSlot, AlertsService } from './alerts.service.js';
import { monitoringSettings } from './settings.js';
import type { Readiness, SystemHealthService } from './system-health.service.js';

const HOUR = 3_600_000;
const t0 = new Date('2026-10-15T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const problem = (key: string, summary = `${key} is wrong`): Problem => ({ key, severity: 'warning', summary });
const state = (key: string, extra: Partial<AlertState> = {}): AlertState => ({ key, summary: `${key} was wrong`, lastNotifiedAt: t0, resolvedAt: null, ...extra });

describe('planAlerts', () => {
  it('announces a new problem at once', () => {
    expect(planAlerts([], [problem('jobs.failed')], t0, 6 * HOUR).open).toEqual([{ problem: problem('jobs.failed'), isNew: true, notify: true }]);
  });

  it('does not repeat an open problem inside the window, and repeats it after', () => {
    const states = [state('jobs.failed')];
    expect(planAlerts(states, [problem('jobs.failed')], at(5 * 60_000), 6 * HOUR).open[0]).toMatchObject({ isNew: false, notify: false });
    expect(planAlerts(states, [problem('jobs.failed')], at(6 * HOUR - 1), 6 * HOUR).open[0].notify).toBe(false);
    expect(planAlerts(states, [problem('jobs.failed')], at(6 * HOUR), 6 * HOUR).open[0]).toMatchObject({ isNew: false, notify: true });
    // Open but never delivered (every channel failed): tried again.
    expect(planAlerts([state('jobs.failed', { lastNotifiedAt: null })], [problem('jobs.failed')], at(60_000), 6 * HOUR).open[0].notify).toBe(true);
  });

  it('resolves open alerts the run no longer finds, once', () => {
    const plan = planAlerts([state('jobs.failed'), state('old', { resolvedAt: t0 })], [], at(60_000), HOUR);
    expect(plan.resolved.map((r) => r.key)).toEqual(['jobs.failed']);
    expect(plan.open).toEqual([]);
  });

  it('treats a problem that comes back after being resolved as new', () => {
    const plan = planAlerts([state('jobs.failed', { resolvedAt: at(60_000) })], [problem('jobs.failed')], at(2 * 60_000), 6 * HOUR);
    expect(plan.open[0]).toMatchObject({ isNew: true, notify: true });
  });
});

describe('alertText', () => {
  it('lists what admins should hear, and nothing when there is nothing to say', () => {
    const plan = {
      open: [
        { problem: { ...problem('readiness.database', 'The database does not answer'), severity: 'critical' as const }, isNew: true, notify: true },
        { problem: { ...problem('jobs.failed', '6 jobs failed'), detail: 'Queues: x' }, isNew: false, notify: true },
        { problem: problem('quiet'), isNew: false, notify: false },
      ],
      resolved: [state('messages.failing')],
    };
    expect(alertText(plan, 'production')).toBe(
      '*SchoolSyncer alerts* (production)\n• CRITICAL: The database does not answer\n• Warning (still open): 6 jobs failed\n    Queues: x\n• Resolved: messages.failing was wrong',
    );
    expect(alertText({ open: [{ problem: problem('quiet'), isNew: false, notify: false }], resolved: [] }, 'x')).toBeNull();
  });
});

describe('alertSlot and settings', () => {
  it('runs once per slot of ALERT_EVERY_MINUTES', () => {
    expect(alertSlot(5, new Date('2026-10-15T10:07:59Z'))).toBe('2026-10-15T10:05');
    expect(alertSlot(15, new Date('2026-10-15T10:59:00Z'))).toBe('2026-10-15T10:45');
  });

  it('has defaults for everything and ignores bad values', () => {
    const s = monitoringSettings({});
    expect(s).toMatchObject({ failedJobs: 5, messageFailurePercent: 20, repeatMs: 360 * 60_000, everyMinutes: 5, webhookUrl: null, maxJobLagMs: 900_000 });
    expect(monitoringSettings({ ALERT_REPEAT_MINUTES: '30', ALERT_FAILED_JOBS: 'lots', ALERT_EVERY_MINUTES: '500' })).toMatchObject({ repeatMs: 30 * 60_000, failedJobs: 5, everyMinutes: 60 });
    expect(monitoringSettings({ ALERT_EVERY_MINUTES: 'off', ALERT_WEBHOOK_URL: ' https://hooks.slack.com/x ' })).toMatchObject({ everyMinutes: null, webhookUrl: 'https://hooks.slack.com/x' });
  });
});

/** PlatformAlert rows in memory, with the queries AlertsService makes. */
function fakePrisma(admins: { phone: string | null }[] = []) {
  const rows = new Map<string, Record<string, unknown> & AlertState>();
  const keysOf = (where: { key?: { in: string[] }; resolvedAt?: null }) =>
    [...rows.values()].filter((r) => (!where.key || where.key.in.includes(r.key)) && (where.resolvedAt !== null || r.resolvedAt === null));
  const prisma = {
    platformAlert: {
      findMany: async ({ where }: { where: { OR: [{ resolvedAt: null }, { key: { in: string[] } }] } }) =>
        [...rows.values()].filter((r) => r.resolvedAt === null || where.OR[1].key.in.includes(r.key)),
      upsert: async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const row = rows.get(where.key);
        rows.set(where.key, row ? { ...row, ...update } : ({ lastNotifiedAt: null, resolvedAt: null, notifications: 0, ...create } as never));
      },
      updateMany: async ({ where, data }: { where: { key: { in: string[] }; resolvedAt?: null }; data: Record<string, unknown> }) => {
        for (const r of keysOf(where)) {
          const inc = data.notifications as { increment: number } | undefined;
          rows.set(r.key, { ...r, ...data, ...(inc && { notifications: (r.notifications as number) + inc.increment }) } as never);
        }
      },
    },
    platformAdmin: { findMany: async () => admins },
  };
  return { prisma: prisma as unknown as PrismaService, rows };
}

function fakeHealth() {
  const health = {
    readiness: { status: 'ok', checks: { database: { ok: true, detail: 'ok' }, jobs: { ok: true, detail: 'ok', due: 0, lagSeconds: 0 } } } as Readiness,
    dead: 0,
    messages: { sent: 0, failed: 0, bySchool: [] as { schoolName: string; sent: number; failed: number }[] },
  };
  const service = {
    readiness: async () => health.readiness,
    deadSince: async () => health.dead,
    problemJobs: async () => ({ dead: [{ queue: 'reports.render' }, { queue: 'reports.render' }, { queue: 'fees.vouchers' }], retrying: [] }),
    messages: async () => health.messages,
  };
  return { health, service: service as unknown as SystemHealthService };
}

describe('AlertsService', () => {
  const settings = { ...monitoringSettings({}), repeatMs: 6 * HOUR, webhookUrl: 'https://hooks.example.pk/alerts' };
  const jobs = { register: vi.fn(), schedule: vi.fn() } as unknown as JobsService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const { prisma, rows } = fakePrisma();
    const { health, service } = fakeHealth();
    const alerts = new AlertsService(prisma, jobs, service);
    const posts: string[] = [];
    alerts.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(init.body as string).text);
      return { ok: true, status: 200 };
    });
    return { alerts, rows, health, posts };
  }

  it('registers a recurring check on the job queue', () => {
    const { alerts } = setup();
    alerts.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith('monitoring.alerts', expect.anything());
    expect(jobs.schedule).toHaveBeenCalledWith(expect.objectContaining({ name: 'alerts', queue: 'monitoring.alerts' }));
  });

  it('finds failed jobs, failing messages, stale reconciliation and readiness problems', async () => {
    const { alerts, health } = setup();
    health.dead = 7;
    health.messages = { sent: 60, failed: 40, bySchool: [{ schoolName: 'Beacon', sent: 10, failed: 30 }] };
    health.readiness = {
      status: 'error',
      checks: {
        database: { ok: true, detail: 'ok' },
        jobs: { ok: false, detail: 'Job queue: waited 20 min', due: 3, lagSeconds: 1200 },
        reconciliation: { ok: false, detail: 'last succeeded 40 h ago', enabled: true, lastSuccessAt: null, lastFailureAt: null },
      },
    };
    const problems = await alerts.findProblems(t0, settings);
    expect(problems.map((p) => p.key)).toEqual(['readiness.jobs', 'reconciliation.stale', 'jobs.failed', 'messages.failing']);
    expect(problems[2].detail).toBe('Queues: reports.render, fees.vouchers');
    expect(problems[3]).toMatchObject({ summary: '40% of messages failed in the last hour (40 of 100)', detail: 'Most failures: Beacon 30/40' });
  });

  it('stays quiet below the thresholds, and stops at a database outage', async () => {
    const { alerts, health } = setup();
    health.dead = 4;
    health.messages = { sent: 5, failed: 5, bySchool: [] };
    expect(await alerts.findProblems(t0, settings)).toEqual([]);
    health.readiness = { status: 'error', checks: { database: { ok: false, detail: 'The database does not answer' } } };
    expect(await alerts.findProblems(t0, settings)).toEqual([{ key: 'readiness.database', severity: 'critical', summary: 'The database does not answer' }]);
  });

  it('alerts once per window for the same open problem, then once when it is resolved', async () => {
    const { alerts, rows, health, posts } = setup();
    health.dead = 9;

    expect(await alerts.run(t0, settings)).toMatchObject({ notified: true });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('9 background jobs failed for good');
    expect(rows.get('jobs.failed')).toMatchObject({ notifications: 1, lastNotifiedAt: t0, resolvedAt: null });

    // Every five minutes for the next six hours: recorded, not repeated.
    for (let m = 5; m < 360; m += 5) await alerts.run(at(m * 60_000), settings);
    expect(posts).toHaveLength(1);
    expect(rows.get('jobs.failed')).toMatchObject({ notifications: 1, lastSeenAt: at(355 * 60_000) });

    await alerts.run(at(6 * HOUR), settings);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain('(still open)');

    health.dead = 0;
    await alerts.run(at(6 * HOUR + 5 * 60_000), settings);
    expect(posts[2]).toContain('Resolved: 9 background jobs failed');
    expect(rows.get('jobs.failed')!.resolvedAt).toEqual(at(6 * HOUR + 5 * 60_000));
    await alerts.run(at(6 * HOUR + 10 * 60_000), settings);
    expect(posts).toHaveLength(3);

    // It comes back: a new alert straight away.
    health.dead = 6;
    await alerts.run(at(6 * HOUR + 15 * 60_000), settings);
    expect(posts).toHaveLength(4);
    expect(rows.get('jobs.failed')).toMatchObject({ notifications: 1, resolvedAt: null, openedAt: at(6 * HOUR + 15 * 60_000) });
  });

  it('tries again next run when the webhook did not take the alert', async () => {
    const { alerts, rows, health } = setup();
    health.dead = 9;
    alerts.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(await alerts.run(t0, settings)).toMatchObject({ notified: false });
    expect(rows.get('jobs.failed')).toMatchObject({ notifications: 0, lastNotifiedAt: null });
    alerts.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await alerts.run(at(5 * 60_000), settings)).toMatchObject({ notified: true });
    expect(rows.get('jobs.failed')).toMatchObject({ notifications: 1 });
  });

  it('counts the log as delivered when no channel is configured', async () => {
    const { alerts, health } = setup();
    health.dead = 9;
    expect(await alerts.run(t0, { ...settings, webhookUrl: null })).toMatchObject({ notified: true });
    expect(alerts.fetch).not.toHaveBeenCalled();
  });

  it('messages admins with a phone through the platform sender', async () => {
    const { prisma } = fakePrisma([{ phone: '03001234567' }, { phone: 'not a phone' }]);
    const { health, service } = fakeHealth();
    health.dead = 9;
    const alerts = new AlertsService(prisma, jobs, service);
    const sent: unknown[] = [];
    const env = { ...process.env };
    Object.assign(process.env, { NOTIFY_DRIVER: 'sms', SMS_GATEWAY_URL: 'https://sms.example.pk/send' });
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
        sent.push(init?.body);
        return new Response('{}', { status: 200 });
      });
      expect(await alerts.run(t0, { ...settings, webhookUrl: null })).toMatchObject({ notified: true });
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(String(sent[0])).toContain('9 background jobs failed for good');
    } finally {
      process.env = env;
    }
  });
});
