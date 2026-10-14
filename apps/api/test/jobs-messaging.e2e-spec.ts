import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStatus, NotificationStatus } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PgCounterStore } from '../src/jobs/counter-store.js';
import { JobsService, LOCK_TIMEOUT_MS } from '../src/jobs/jobs.service.js';
import { DELIVER_QUEUE, DELIVERY_ATTEMPTS, NotificationsService } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// The Postgres job runner, shared rate-limit counters and honest message delivery.
describe('Jobs and message delivery (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let jobs: JobsService;
  let notifications: NotificationsService;
  let schoolId: string;
  let schoolSlug: string;
  let owner: Record<string, string>;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const savedKey = process.env.PAYMENTS_SECRET_KEY;
  const later = (ms: number) => new Date(Date.now() + ms);

  /** Runs delivery jobs (this suite's and any other suite's left in the queue) until none are due. */
  const drain = async (now?: Date) => {
    while ((await jobs.runOnce({ queues: [DELIVER_QUEUE], limit: 200, now })) > 0);
  };
  const logOf = async (to: string) => prisma.notificationLog.findFirstOrThrow({ where: { schoolId, to } });

  beforeAll(async () => {
    process.env.PAYMENTS_SECRET_KEY = 'e2e-messaging-key-at-least-32-characters-long';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    jobs = app.get(JobsService);
    notifications = app.get(NotificationsService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Messaging ${run}`, ownerName: 'Owner', email: `msg+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    process.env.PAYMENTS_SECRET_KEY = savedKey;
    vi.restoreAllMocks();
    await prisma.job.deleteMany({ where: { queue: { startsWith: `e2e-${run}` } } });
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  describe('job runner', () => {
    it('runs each job once even with two workers polling at the same time', async () => {
      const queue = `e2e-${run}-once`;
      const second = new PrismaService();
      await second.$connect();
      const ran: string[] = [];
      const handler = {
        run: async (p: { n: number }) => {
          ran.push(String(p.n));
          await new Promise((r) => setTimeout(r, 5));
        },
      };
      const a = new JobsService(prisma);
      const b = new JobsService(second);
      a.register(queue, handler);
      b.register(queue, handler);
      await a.enqueueMany(queue, Array.from({ length: 40 }, (_, n) => ({ n })));
      const loop = async (w: JobsService) => {
        let total = 0;
        for (let n = await w.runOnce({ limit: 3 }); n > 0; n = await w.runOnce({ limit: 3 })) total += n;
        return total;
      };
      const [byA, byB] = await Promise.all([loop(a), loop(b)]);
      await second.$disconnect();
      expect(byA + byB).toBe(40);
      expect(byA).toBeGreaterThan(0);
      expect(byB).toBeGreaterThan(0);
      expect(new Set(ran).size).toBe(40);
      expect(ran).toHaveLength(40);
      expect(await prisma.job.count({ where: { queue, status: JobStatus.DONE } })).toBe(40);
    });

    it('retries with growing delays, then fails with the error', async () => {
      const queue = `e2e-${run}-retry`;
      const w = new JobsService(prisma);
      const failed = vi.fn(async () => undefined);
      w.register(queue, { run: async () => Promise.reject(new Error('provider down')), failed, backoffMs: 1000 });
      const id = (await w.enqueue(queue, {}, { maxAttempts: 3 }))!;

      expect(await w.runOnce()).toBe(1);
      const first = await prisma.job.findUniqueOrThrow({ where: { id } });
      expect(first).toMatchObject({ status: JobStatus.PENDING, attempts: 1, lastError: 'provider down', lockedBy: null });
      // Not due again straight away.
      expect(await w.runOnce()).toBe(0);
      expect(await w.runOnce({ now: later(1_500) })).toBe(1);
      const second = await prisma.job.findUniqueOrThrow({ where: { id } });
      expect(second.runAt.getTime() - first.runAt.getTime()).toBeGreaterThan(1_500);
      expect(failed).not.toHaveBeenCalled();
      expect(await w.runOnce({ now: later(60_000) })).toBe(1);
      expect(await prisma.job.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: JobStatus.FAILED,
        attempts: 3,
        lastError: 'provider down',
      });
      expect(failed).toHaveBeenCalledOnce();
      expect(await w.runOnce({ now: later(3_600_000) })).toBe(0);
    });

    it('enqueues each schedule slot once across servers', async () => {
      const queue = `e2e-${run}-schedule`;
      const servers = [new JobsService(prisma), new JobsService(prisma)];
      for (const s of servers) s.schedule({ name: `e2e-${run}`, queue, slot: (now) => now.toISOString().slice(0, 10) });
      await Promise.all(servers.map((s) => s.enqueueDue()));
      await servers[0].enqueueDue();
      expect(await prisma.job.count({ where: { queue } })).toBe(1);
      await servers[1].enqueueDue(later(86_400_000));
      expect(await prisma.job.count({ where: { queue } })).toBe(2);
    });

    it('puts back jobs whose worker died', async () => {
      const queue = `e2e-${run}-stale`;
      const w = new JobsService(prisma);
      w.register(queue, { run: async () => new Promise<void>(() => undefined) });
      const id = (await w.enqueue(queue, {}))!;
      await prisma.job.update({ where: { id }, data: { status: JobStatus.RUNNING, lockedBy: 'dead', lockedAt: new Date(), attempts: 1 } });
      await w.recoverStale(later(LOCK_TIMEOUT_MS + 60_000));
      expect(await prisma.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: JobStatus.PENDING, lockedBy: null });
    });
  });

  describe('shared rate-limit counters', () => {
    it('counts across instances and starts a new window when one ends', async () => {
      const a = new PgCounterStore(prisma);
      const b = new PgCounterStore(prisma);
      const key = `e2e-${run}-counter`;
      const now = Date.now();
      expect((await a.increment(key, 60_000, now)).count).toBe(1);
      const second = await b.increment(key, 60_000, now + 1_000);
      expect(second.count).toBe(2);
      expect(second.resetAt).toBe(now + 60_000);
      expect(await b.get(key, now + 2_000)).toMatchObject({ count: 2 });
      expect(await a.get(key, now + 60_000)).toBeNull();
      expect((await b.increment(key, 60_000, now + 61_000)).count).toBe(1);
      await a.delete(key);
      expect(await a.get(key, now)).toBeNull();
      await a.increment(key, 1_000, now - 10_000);
      expect(await a.sweep(now)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('message delivery', () => {
    it('marks messages LOGGED, not SENT, when no provider is configured', async () => {
      await request(server).get('/api/notifications/delivery').set(owner).expect(200, { source: 'log', channel: null, delivers: false });
      expect(await notifications.send(schoolId, [{ to: '0300-1110001', template: 'announcement', params: { schoolName: 'S', title: 'T', body: 'B' } }])).toBe(1);
      expect(await logOf('923001110001')).toMatchObject({ status: NotificationStatus.QUEUED, sender: 'log' });
      await drain();
      const log = await logOf('923001110001');
      expect(log).toMatchObject({ status: NotificationStatus.LOGGED, attempts: 1, sentAt: null });
    });

    it("sends from the school's own WhatsApp number once saved, and SENT means the provider accepted it", async () => {
      // The token is write-only and needs the encryption key.
      await request(server).put('/api/school/messaging').set(owner).send({ enabled: true, phoneNumberId: '1234567890' }).expect(400);
      const saved = await request(server)
        .put('/api/school/messaging')
        .set(owner)
        .send({ enabled: true, phoneNumberId: '1234567890', token: 'school-secret-token' })
        .expect(200);
      expect(saved.body).toMatchObject({ active: { source: 'school', channel: 'WHATSAPP' }, ownSender: { phoneNumberId: '1234567890', tokenSet: true } });
      expect(JSON.stringify(saved.body)).not.toContain('school-secret-token');
      const row = await prisma.schoolMessagingSender.findUniqueOrThrow({ where: { schoolId } });
      expect(row.secrets).toMatch(/^v1:/);
      expect(row.secrets).not.toContain('school-secret-token');

      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 }));
      await notifications.send(schoolId, [{ to: '03001110002', template: 'announcement', params: { schoolName: 'S', title: 'T', body: 'B' } }]);
      await drain();
      expect(await logOf('923001110002')).toMatchObject({ status: NotificationStatus.SENT, sender: 'school', providerMessageId: 'wamid.ok' });
      const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/1234567890/'));
      expect(calls).toHaveLength(1);
      expect((calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer school-secret-token' });
      fetchMock.mockRestore();
    });

    it('keeps a message QUEUED with the error while retrying, then FAILED', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('temporarily down', { status: 503 }));
      await notifications.send(schoolId, [{ to: '03001110003', template: 'announcement', params: { schoolName: 'S', title: 'T', body: 'B' } }]);
      await drain();
      expect(await logOf('923001110003')).toMatchObject({ status: NotificationStatus.QUEUED, attempts: 1, error: expect.stringContaining('503') });
      for (let i = 1; i < DELIVERY_ATTEMPTS; i++) await drain(later(i * 24 * 3_600_000));
      const log = await logOf('923001110003');
      expect(log).toMatchObject({ status: NotificationStatus.FAILED, attempts: DELIVERY_ATTEMPTS, sentAt: null });
      expect(log.error).toContain('WhatsApp API 503');
      fetchMock.mockRestore();
    });

    it('fails at once when the provider refuses the message for good', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"error":"invalid parameter"}', { status: 400 }));
      await notifications.send(schoolId, [{ to: '03001110004', template: 'announcement', params: { schoolName: 'S', title: 'T', body: 'B' } }]);
      await drain();
      expect(await logOf('923001110004')).toMatchObject({ status: NotificationStatus.FAILED, attempts: 1 });
      fetchMock.mockRestore();
    });

    it('keeps secrets out of the queue and the log', async () => {
      await notifications.send(schoolId, [
        { to: '03001110005', template: 'parent.invite', params: { schoolName: 'S', schoolCode: 's', login: 'x', password: 'Secret-pass-99' } },
      ]);
      const log = await logOf('923001110005');
      expect(log.body).not.toContain('Secret-pass-99');
      const job = await prisma.job.findFirstOrThrow({ where: { queue: DELIVER_QUEUE, payload: { path: ['logId'], equals: log.id } } });
      expect(JSON.stringify(job.payload)).not.toContain('Secret-pass-99');
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
      await drain();
      // The provider got the real password; the finished job keeps only the log id.
      expect(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body)).toContain('Secret-pass-99');
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).payload).toEqual({ logId: log.id });
      fetchMock.mockRestore();
    });

    it('shows the real status and error in the message log, and falls back when the school removes its number', async () => {
      const list = await request(server).get('/api/notifications').set(owner).expect(200);
      const statuses = list.body.map((l: { status: string }) => l.status);
      expect(statuses).toEqual(expect.arrayContaining(['LOGGED', 'SENT', 'FAILED']));
      expect(list.body.find((l: { status: string }) => l.status === 'FAILED').error).toBeTruthy();

      const removed = await request(server).delete('/api/school/messaging').set(owner).expect(200);
      expect(removed.body).toMatchObject({ active: { source: 'log' }, ownSender: null });
    });
  });
});
