import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStatus, NotificationStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { RECONCILE_QUEUE } from '../src/fees/reconciliation/reconciliation.scheduler.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { AlertsService } from '../src/monitoring/alerts.service.js';
import { monitoringSettings } from '../src/monitoring/settings.js';
import { DELIVER_QUEUE } from '../src/notifications/notifications.service.js';
import { ApiErrorCounter } from '../src/observability/api-errors.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Request ids, readiness, the console's System health page (and job retry)
// and the alert check against a real database.
describe('Monitoring (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const queue = `e2e-${run}-monitor`;
  const env = { ...process.env };
  let owner: Record<string, string>;
  let support: Record<string, string>;
  let supportId = '';
  let schoolOwner: Record<string, string>;
  let schoolId = '';
  let schoolSlug = '';
  const handled: unknown[] = [];

  beforeAll(async () => {
    // The shared test database keeps jobs from other suites and earlier runs
    // (some on queues nothing handles any more): only this suite's jobs may
    // fail readiness. Reconciliation is switched on per test.
    Object.assign(process.env, { READY_MAX_JOB_LAG_SECONDS: String(10 * 365 * 86_400), READY_MAX_JOB_BACKLOG: '1000000', RECONCILE_AT: 'off' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    app.get(JobsService).register(queue, { run: async (p) => void handled.push(p) });

    const passwordHash = await bcrypt.hash('password123', 4);
    await prisma.platformAdmin.create({ data: { email: `owner+${run}@monitor.test`, name: 'Owner', role: 'OWNER', passwordHash } });
    supportId = (await prisma.platformAdmin.create({ data: { email: `support+${run}@monitor.test`, name: 'Support', role: 'SUPPORT', passwordHash } })).id;
    const login = async (email: string) =>
      ({ Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken}` });
    owner = await login(`owner+${run}@monitor.test`);
    support = await login(`support+${run}@monitor.test`);

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Monitor ${run}`, ownerName: 'Owner', email: `school+${run}@monitor.test`, password: 'password123' })
      .expect(201);
    schoolId = reg.body.user.schoolId;
    schoolSlug = reg.body.schoolSlug;
    schoolOwner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    process.env = env;
    await prisma.job.deleteMany({ where: { OR: [{ queue }, { queue: RECONCILE_QUEUE, lastError: { startsWith: `e2e ${run}` } }] } });
    await prisma.platformAlert.deleteMany({ where: { key: { in: ['jobs.failed', 'messages.failing', 'readiness.jobs', 'reconciliation.stale'] } } });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: { endsWith: '@monitor.test' } } } });
    await prisma.platformAdmin.deleteMany({ where: { email: { endsWith: '@monitor.test' } } });
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  describe('request ids', () => {
    it('keeps an incoming X-Request-Id and puts it in error bodies', async () => {
      const res = await request(server).get('/api/students').set('X-Request-Id', `edge-${run}`).expect(401);
      expect(res.headers['x-request-id']).toBe(`edge-${run}`);
      expect(res.body).toMatchObject({ statusCode: 401, requestId: `edge-${run}` });
    });

    it('makes one up when there is none, or it is not a plain id', async () => {
      const plain = await request(server).get('/api/health').expect(200);
      expect(plain.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const odd = await request(server).get('/api/nope').set('X-Request-Id', 'bad id\twith tabs').expect(404);
      expect(odd.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(odd.body.requestId).toBe(odd.headers['x-request-id']);
    });
  });

  describe('readiness', () => {
    it('is ready with the database, job queue and reconciliation checked', async () => {
      await request(server).get('/api/health').expect(200, { status: 'ok' });
      const res = await request(server).get('/api/health/ready').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        checks: {
          database: { ok: true },
          jobs: { ok: true, due: expect.any(Number), lagSeconds: expect.any(Number) },
          reconciliation: { ok: true, enabled: false },
        },
      });
    });

    it('is not ready while a due job waits too long, and says why', async () => {
      const stuck = await prisma.job.create({ data: { queue: `e2e-${run}-nobody`, payload: {}, runAt: new Date(0) } });
      try {
        const res = await request(server).get('/api/health/ready').expect(503);
        expect(res.body.status).toBe('error');
        expect(res.body.checks.jobs).toMatchObject({ ok: false, detail: expect.stringContaining('JOBS_WORKER') });
        // Liveness is unaffected: load balancers keep the API in rotation.
        await request(server).get('/api/health').expect(200);
      } finally {
        await prisma.job.delete({ where: { id: stuck.id } });
      }
    });

    it('is not ready when the nightly reconciliation failed after its last success', async () => {
      Object.assign(process.env, { RECONCILE_AT: '02:00', PAYMENTS_MODE: 'mock' });
      const failed = await prisma.job.create({
        data: { queue: RECONCILE_QUEUE, payload: {}, status: JobStatus.FAILED, lastError: `e2e ${run}`, finishedAt: new Date(Date.now() + 60_000) },
      });
      try {
        const res = await request(server).get('/api/health/ready').expect(503);
        expect(res.body.checks.reconciliation).toMatchObject({ ok: false, enabled: true, detail: expect.stringContaining('has not succeeded since') });
      } finally {
        await prisma.job.delete({ where: { id: failed.id } });
        process.env.RECONCILE_AT = 'off';
      }
    });
  });

  describe('System health page', () => {
    it('is for console staff only', async () => {
      await request(server).get('/api/platform/system-health').expect(401);
      await request(server).get('/api/platform/system-health').set(schoolOwner).expect(401);
      await request(server).get('/api/platform/system-health').set(support).expect(200);
    });

    it('shows the job queue, dead jobs, message failures by school, server errors and reconciliation', async () => {
      const dead = await prisma.job.create({
        data: { queue, payload: { n: 1 }, status: JobStatus.FAILED, attempts: 5, lastError: 'gateway said no to 03001234567', finishedAt: new Date() },
      });
      await prisma.job.create({ data: { queue, payload: { n: 2 }, runAt: new Date(Date.now() + 3_600_000) } });
      await prisma.notificationLog.createMany({
        data: [
          ...Array.from({ length: 3 }, () => ({ schoolId, channel: 'WHATSAPP' as const, to: '+923001234567', template: 'fee.reminder', body: 'x', status: NotificationStatus.FAILED, error: 'Recipient +923001234567 is not on WhatsApp' })),
          { schoolId, channel: 'WHATSAPP' as const, to: '+923001234567', template: 'fee.reminder', body: 'x', status: NotificationStatus.SENT },
        ],
      });
      await app.get(ApiErrorCounter).record(500);

      const res = await request(server).get('/api/platform/system-health').set(owner).expect(200);
      const body = res.body;
      expect(body.readiness.status).toBe('ok');
      expect(body.queues.find((q: { queue: string }) => q.queue === queue)).toMatchObject({ dead: 1, dead24h: 1, scheduled: 1, due: 0 });
      const row = body.deadJobs.find((j: { id: string }) => j.id === dead.id);
      expect(row).toMatchObject({ queue, attempts: 5, retryable: true, lastError: 'gateway said no to [phone]' });
      const school = body.messages.bySchool.find((s: { schoolId: string }) => s.schoolId === schoolId);
      expect(school).toMatchObject({ schoolName: `Monitor ${run}`, failed: 3, sent: 1, total: 4, lastError: 'Recipient [phone] is not on WhatsApp' });
      expect(body.apiErrors.hours).toHaveLength(24);
      expect(body.apiErrors.total).toBeGreaterThanOrEqual(1);
      expect(body.reconciliation.gateways.map((g: { provider: string }) => g.provider)).toEqual(['JAZZCASH', 'EASYPAISA', 'ONEBILL']);
      expect(body.reconciliation).toHaveProperty('failedRuns24h');
      expect(JSON.stringify(body)).not.toContain('03001234567');
    });

    it('retries a dead job once, with a fresh set of attempts, and records who did it', async () => {
      const dead = await prisma.job.create({ data: { queue, payload: { n: 3 }, status: JobStatus.FAILED, attempts: 5, finishedAt: new Date(), lastError: 'boom' } });
      await request(server).post(`/api/platform/system-health/jobs/${dead.id}/retry`).set(schoolOwner).expect(401);
      await request(server).post(`/api/platform/system-health/jobs/${dead.id}/retry`).set(support).expect(200, { id: dead.id, status: 'PENDING' });
      expect(await prisma.job.findUniqueOrThrow({ where: { id: dead.id } })).toMatchObject({ status: JobStatus.PENDING, attempts: 0, finishedAt: null });
      await request(server).post(`/api/platform/system-health/jobs/${dead.id}/retry`).set(support).expect(409);
      await app.get(JobsService).runOnce({ queues: [queue] });
      expect(handled).toContainEqual({ n: 3 });
      expect(await prisma.job.findUniqueOrThrow({ where: { id: dead.id } })).toMatchObject({ status: JobStatus.DONE });
      expect(await prisma.platformAuditLog.count({ where: { adminId: supportId, action: 'job.retry' } })).toBe(1);
    });

    it('refuses to retry what cannot run again', async () => {
      await request(server).post('/api/platform/system-health/jobs/missing/retry').set(owner).expect(404);
      // Message deliveries drop their contents when they finish.
      const message = await prisma.job.create({ data: { queue: DELIVER_QUEUE, payload: {}, status: JobStatus.FAILED, finishedAt: new Date(), lastError: `e2e ${run}` } });
      try {
        const res = await request(server).post(`/api/platform/system-health/jobs/${message.id}/retry`).set(owner).expect(409);
        expect(res.body.message).toContain('Send it again');
      } finally {
        await prisma.job.delete({ where: { id: message.id } });
      }
    });

    it('lets owners give staff a phone for alerts', async () => {
      const res = await request(server).patch(`/api/platform/staff/${supportId}`).set(owner).send({ phone: '0300 1234567' }).expect(200);
      expect(res.body.phone).toBe('03001234567');
      await request(server).patch(`/api/platform/staff/${supportId}`).set(owner).send({ phone: 'not a phone' }).expect(400);
      const cleared = await request(server).patch(`/api/platform/staff/${supportId}`).set(owner).send({ phone: '' }).expect(200);
      expect(cleared.body.phone).toBeNull();
    });
  });

  describe('alerts', () => {
    it('raises an alert for failed jobs once, shows it in the console, and resolves it', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const alerts = app.get(AlertsService);
      const posts: string[] = [];
      alerts.fetch = async (_url, init) => {
        posts.push(JSON.parse(init.body as string).text);
        return { ok: true, status: 200 };
      };
      await prisma.platformAlert.deleteMany({ where: { key: 'jobs.failed' } });
      // Only this suite's failures count: a threshold above what other suites leave behind.
      const before = await prisma.job.count({ where: { status: JobStatus.FAILED, finishedAt: { gte: new Date(Date.now() - 3_600_000) } } });
      const settings = { ...monitoringSettings(), failedJobs: before + 2, messageMinCount: 1_000_000, webhookUrl: 'https://hooks.example.pk/alerts' };
      const now = new Date(Date.now() + 1000);
      expect((await alerts.run(now, settings)).open.find((o) => o.problem.key === 'jobs.failed')).toBeUndefined();

      await prisma.job.createMany({
        data: Array.from({ length: 2 }, (_, n) => ({ queue, payload: { n }, status: JobStatus.FAILED, attempts: 5, finishedAt: new Date(), lastError: 'down' })),
      });
      await alerts.run(now, settings);
      await alerts.run(new Date(now.getTime() + 5 * 60_000), settings);
      expect(posts.filter((p) => p.includes('background jobs failed'))).toHaveLength(1);
      expect(await prisma.platformAlert.findUniqueOrThrow({ where: { key: 'jobs.failed' } })).toMatchObject({ notifications: 1, resolvedAt: null });

      const page = await request(server).get('/api/platform/system-health').set(owner).expect(200);
      expect(page.body.alerts.map((a: { key: string }) => a.key)).toContain('jobs.failed');

      await alerts.run(new Date(now.getTime() + 10 * 60_000), { ...settings, failedJobs: 1_000_000 });
      expect(posts.at(-1)).toContain('Resolved:');
      expect((await prisma.platformAlert.findUniqueOrThrow({ where: { key: 'jobs.failed' } })).resolvedAt).not.toBeNull();
      vi.restoreAllMocks();
    });
  });
});
