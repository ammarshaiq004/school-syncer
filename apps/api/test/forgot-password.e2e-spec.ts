import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { RESET_MAX_ATTEMPTS, RESET_PER_PHONE } from '../src/auth/password-reset.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { DELIVER_QUEUE } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

describe('Forgot password (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let schoolSlug: string;
  let owner: Record<string, string>;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  // A unique mobile number per run: 03 + 9 digits.
  const digits = run.slice(-9).padStart(9, '7');
  const teacherPhone = `03${digits}`;
  const teacherIntl = `923${digits}`;
  const savedKey = process.env.PAYMENTS_SECRET_KEY;
  let sent: { to: string; code: string }[] = [];

  const forgot = (phone: string, slug = schoolSlug) =>
    request(server).post('/api/auth/forgot-password').send({ schoolSlug: slug, phone });
  const reset = (phone: string, code: string, newPassword = 'new-pass-123') =>
    request(server).post('/api/auth/reset-password').send({ schoolSlug, phone, code, newPassword });
  const login = (loginId: string, password: string) =>
    request(server).post('/api/auth/login').send({ schoolSlug, login: loginId, password });
  /** Delivers queued messages and returns the codes WhatsApp was asked to send. */
  const deliver = async () => {
    const jobs = app.get(JobsService);
    while ((await jobs.runOnce({ queues: [DELIVER_QUEUE], limit: 200 })) > 0);
    return sent;
  };

  beforeAll(async () => {
    process.env.PAYMENTS_SECRET_KEY = 'e2e-forgot-password-key-at-least-32-chars';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Forgot ${run}`, ownerName: 'Owner', email: `forgot+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      if (body.template?.name === 'password_reset') {
        sent.push({ to: body.to, code: body.template.components[0].parameters[0].text });
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.x' }] }), { status: 200 });
    });
  });

  afterAll(async () => {
    process.env.PAYMENTS_SECRET_KEY = savedKey;
    vi.restoreAllMocks();
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('tells the user to ask the office when the school cannot send messages', async () => {
    const res = await forgot(teacherPhone).expect(200);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  it('resets the password with a code sent to the phone, ending old sessions', async () => {
    await request(server)
      .put('/api/school/messaging')
      .set(owner)
      .send({ enabled: true, phoneNumberId: '5550001', token: 'school-token' })
      .expect(200);
    const created = await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: 'Phone Teacher', phone: teacherPhone, roles: [{ role: 'TEACHER' }] })
      .expect(201);
    const first = await login(teacherPhone, created.body.temporaryPassword).expect(200);
    expect(first.body.user.mustChangePassword).toBe(true);
    const oldSession = { Authorization: `Bearer ${first.body.accessToken}` };

    // The same answer for a number without an account, and an unknown school.
    expect((await forgot('03009999999').expect(200)).body).toEqual({ status: 'sent' });
    expect((await forgot(teacherPhone, `no-such-school-${run}`).expect(200)).body).toEqual({ status: 'sent' });
    sent = [];
    // Typed differently from how it was saved.
    expect((await forgot(`+92 ${teacherPhone.slice(1)}`).expect(200)).body).toEqual({ status: 'sent' });
    const [message] = await deliver();
    expect(message.to).toBe(teacherIntl);
    expect(message.code).toMatch(/^\d{6}$/);

    // Only the hash is stored, and the message log masks the code.
    const row = await prisma.passwordResetCode.findFirstOrThrow({ where: { phone: teacherIntl }, orderBy: { createdAt: 'desc' } });
    expect(row.codeHash).not.toContain(message.code);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { to: teacherIntl, template: 'password.reset' } });
    expect(log.body).not.toContain(message.code);
    expect(log.status).toBe('SENT');

    const wrong = message.code === '000000' ? '111111' : '000000';
    await reset(teacherPhone, wrong).expect(400);
    await reset(teacherPhone, message.code, 'short').expect(400);
    await reset(teacherPhone, message.code).expect(200, { ok: true });
    // A code works once.
    await reset(teacherPhone, message.code).expect(400);

    await request(server).get('/api/auth/me').set(oldSession).expect(401);
    await login(teacherPhone, created.body.temporaryPassword).expect(401);
    const fresh = await login(teacherPhone, 'new-pass-123').expect(200);
    expect(fresh.body.user.mustChangePassword).toBe(false);
  });

  it(`refuses the right code after ${RESET_MAX_ATTEMPTS} wrong tries, and expired codes`, async () => {
    sent = [];
    await forgot(teacherPhone).expect(200);
    const [{ code }] = await deliver();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) await reset(teacherPhone, wrong).expect(400);
    const res = await reset(teacherPhone, code).expect(400);
    expect(res.body.message).toMatch(/Too many wrong codes/);

    sent = [];
    await forgot(teacherPhone).expect(429);
    // Past the per-phone limit (RESET_PER_PHONE an hour): expire the window to go on.
    expect(RESET_PER_PHONE).toBe(3);
    await prisma.rateLimitCounter.deleteMany({ where: { key: { contains: `reset-phone|${schoolSlug}|${teacherIntl}` } } });
    await forgot(teacherPhone).expect(200);
    const [{ code: later }] = await deliver();
    await prisma.passwordResetCode.updateMany({ where: { phone: teacherIntl, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await reset(teacherPhone, later).expect(400);
  });
});
