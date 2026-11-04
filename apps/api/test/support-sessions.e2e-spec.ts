import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Support sessions (view only or edit, ended early by the owner) and the contact log.
describe('Support sessions and contact log (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const adminEmail = `contacts-admin+${run}@schoolsyncer.test`;
  let admin: Record<string, string>;
  let owner: Record<string, string>;
  let schoolId: string;
  let slug: string;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const startSupport = (body: Record<string, unknown>) =>
    request(server).post(`/api/platform/schools/${schoolId}/support-login`).set(admin).send({ reason: 'Owner asked for help with fees', ...body });
  const report = (as: Record<string, string>) =>
    request(server).post('/api/problem-reports').set(as).send({ message: 'Something is wrong here', page: '/dashboard' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await prisma.platformAdmin.create({
      data: { email: adminEmail, name: 'Contacts Admin', role: 'SUPPORT', passwordHash: await bcrypt.hash('password123', 4) },
    });
    admin = bearer((await request(server).post('/api/platform/auth/login').send({ email: adminEmail, password: 'password123' }).expect(200)).body.accessToken);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Support ${run}`, ownerName: 'Owner', email: `support${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolId = reg.body.user.schoolId;
    slug = reg.body.schoolSlug;
    owner = bearer(reg.body.accessToken);
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: adminEmail } } });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('opens view only by default: it can read but not change anything', async () => {
    const res = await startSupport({}).expect(201);
    expect(res.body.scope).toBe('view');
    const support = bearer(res.body.accessToken);
    await request(server).get('/api/problem-reports').set(support).expect(200);
    const denied = await report(support).expect(403);
    expect(JSON.stringify(denied.body)).toMatch(/view only/);
  });

  it('lets an edit session change things, and tells the school about it', async () => {
    const res = await startSupport({ scope: 'edit' }).expect(201);
    await report(bearer(res.body.accessToken)).expect(201);
    const sub = (await request(server).get('/api/subscription').set(owner).expect(200)).body;
    expect(sub.notices.some((n: { kind: string; body: string }) => n.kind === 'support.session' && /can make changes/.test(n.body))).toBe(true);
  });

  it('lets only the owner list and end sessions, and an ended session stops working', async () => {
    const res = await startSupport({ scope: 'edit' }).expect(201);
    const support = bearer(res.body.accessToken);
    const open = (await request(server).get('/api/support-sessions').set(owner).expect(200)).body;
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect(open[0]).toMatchObject({ adminName: 'Contacts Admin', scope: 'EDIT' });
    // Not from inside the session.
    await request(server).post(`/api/support-sessions/${open[0].id}/end`).set(support).expect(403);
    await request(server).post(`/api/support-sessions/${open[0].id}/end`).set(owner).expect(201);
    await request(server).post(`/api/support-sessions/${open[0].id}/end`).set(owner).expect(404);
    await request(server).get('/api/support-sessions').set(owner).expect(200).expect((r) => expect(r.body).toHaveLength(open.length - 1));
    // The newest session is the one just ended; its token is refused (the status cache was cleared).
    await request(server).get('/api/problem-reports').set(support).expect(401);
  });

  it('keeps a contact log with follow-ups, and lists what is due', async () => {
    const today = localToday();
    const url = `/api/platform/schools/${schoolId}/contacts`;
    await request(server).post(url).set(admin).send({ kind: 'CALL', note: 'Rang the owner', followUpOn: daysBefore(today, 1) }).expect(400);
    await request(server).post(url).set(admin).send({ kind: 'CALL', note: 'Rang the owner', promisedAmount: 500 }).expect(400);
    await request(server).post(url).set(admin).send({ kind: 'NOTE', note: 'x' }).expect(400);
    await request(server).post('/api/platform/schools/nope/contacts').set(admin).send({ kind: 'NOTE', note: 'Lost school' }).expect(404);

    const promise = (await request(server).post(url).set(admin).send({ kind: 'PROMISE_TO_PAY', note: 'Will pay on Friday', promisedAmount: 9000, followUpOn: today }).expect(201)).body;
    expect(promise).toMatchObject({ kind: 'PROMISE_TO_PAY', promisedAmount: 9000, adminName: 'Contacts Admin', doneAt: null });
    await request(server).post(url).set(admin).send({ kind: 'VISIT', note: 'Visited the campus' }).expect(201);
    expect((await request(server).get(url).set(admin).expect(200)).body).toHaveLength(2);

    const due = (await request(server).get('/api/platform/follow-ups').set(admin).expect(200)).body;
    expect(due.find((c: { id: string }) => c.id === promise.id)).toMatchObject({ overdue: false, school: { id: schoolId } });
    expect(due.every((c: { followUpOn: string | null }) => c.followUpOn)).toBe(true);

    await request(server).post(`/api/platform/contacts/${promise.id}/done`).set(admin).expect(201).expect((r) => expect(r.body.doneAt).toBeTruthy());
    const after = (await request(server).get('/api/platform/follow-ups').set(admin).expect(200)).body;
    expect(after.find((c: { id: string }) => c.id === promise.id)).toBeUndefined();
    await request(server).post('/api/platform/contacts/nope/done').set(admin).expect(404);
    await request(server).get(url).expect(401);
  });
});
