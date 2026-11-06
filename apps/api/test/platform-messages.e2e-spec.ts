import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Console staff write to schools: shown in the app and queued by email, to the right schools only.
describe('Messages to schools (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const emails = { owner: `msg-owner+${run}@schoolsyncer.test`, support: `msg-support+${run}@schoolsyncer.test` };
  const slugs: string[] = [];
  let owner: Record<string, string>;
  let support: Record<string, string>;
  const schools: { id: string; auth: Record<string, string> }[] = [];

  const login = async (email: string) =>
    ({ Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken}` });
  const notices = async (i: number) => (await request(server).get('/api/subscription/notices/unread').set(schools[i].auth).expect(200)).body as { kind: string; title: string; severity: string }[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash('password123', 4);
    await prisma.platformAdmin.create({ data: { email: emails.owner, name: 'Msg Owner', role: 'OWNER', passwordHash } });
    await prisma.platformAdmin.create({ data: { email: emails.support, name: 'Msg Support', role: 'SUPPORT', passwordHash } });
    owner = await login(emails.owner);
    support = await login(emails.support);
    for (const name of ['Alpha', 'Beta']) {
      const reg = await request(server)
        .post('/api/auth/register-school')
        .send({ schoolName: `Msg ${name} ${run}`, ownerName: 'Owner', email: `msg${name}${run}@test.pk`, password: 'password123' })
        .expect(201);
      slugs.push(reg.body.schoolSlug);
      schools.push({ id: reg.body.user.schoolId, auth: { Authorization: `Bearer ${reg.body.accessToken}` } });
    }
  });

  afterAll(async () => {
    await prisma.platformMessage.deleteMany({ where: { sentBy: { in: ['Msg Owner', 'Msg Support'] } } });
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: { in: Object.values(emails) } } } });
    await prisma.platformAdmin.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
  });

  it('checks the message and says who it would reach before sending', async () => {
    const chosen = { target: 'CHOSEN', audience: 'OWNERS', schoolIds: [schools[0].id] };
    const preview = (q: string) => request(server).get(`/api/platform/messages/preview?${q}`).set(support);
    expect((await preview(`target=CHOSEN&audience=OWNERS&schoolIds=${schools[0].id}`).expect(200)).body).toEqual({ schools: 1, people: 1 });
    await preview('target=CHOSEN&audience=OWNERS').expect(400);
    await request(server).post('/api/platform/messages').set(support).send({ ...chosen, severity: 'INFO', title: 'Hi', body: 'short' }).expect(400);
    await request(server).post('/api/platform/messages').set(support).send({ ...chosen, schoolIds: ['nope'], severity: 'INFO', title: 'Hello', body: 'Nobody matches.' }).expect(400);
    await request(server).get('/api/platform/messages/preview?target=ALL&audience=OWNERS').expect(401);
  });

  it('sends to the chosen school only, in the app and by email, and records it', async () => {
    const sent = (
      await request(server)
        .post('/api/platform/messages')
        .set(support)
        .send({ target: 'CHOSEN', audience: 'OWNERS', schoolIds: [schools[0].id], severity: 'WARNING', title: `Maintenance ${run}`, body: 'We will be offline on Friday night.' })
        .expect(201)
    ).body;
    expect(sent).toMatchObject({ schools: 1, sentBy: 'Msg Support', target: 'CHOSEN' });
    expect((await notices(0)).find((n) => n.kind === 'message')).toMatchObject({ title: `Maintenance ${run}`, severity: 'WARNING' });
    expect((await notices(1)).some((n) => n.kind === 'message')).toBe(false);
    const mail = await prisma.notificationLog.findFirstOrThrow({ where: { schoolId: schools[0].id, channel: 'EMAIL' } });
    expect(mail.body).toContain(`Maintenance ${run}`);
    expect(await prisma.notificationLog.count({ where: { schoolId: schools[1].id, channel: 'EMAIL' } })).toBe(0);
    expect((await request(server).get('/api/platform/messages').set(support).expect(200)).body[0].id).toBe(sent.id);
    expect(await prisma.platformAuditLog.count({ where: { action: 'message.send', admin: { email: emails.support } } })).toBe(1);
  });

  it('reaches only past-due schools, and only an owner can message everyone', async () => {
    await prisma.subscription.update({ where: { schoolId: schools[1].id }, data: { status: 'PAST_DUE' } });
    const overdue = { target: 'OVERDUE', audience: 'STAFF', severity: 'URGENT', title: `Overdue ${run}`, body: 'Please pay your bill today.' };
    const res = (await request(server).post('/api/platform/messages').set(support).send(overdue).expect(201)).body;
    expect(res.schools).toBeGreaterThanOrEqual(1);
    expect((await notices(1)).some((n) => n.title === `Overdue ${run}`)).toBe(true);
    expect((await notices(0)).some((n) => n.title === `Overdue ${run}`)).toBe(false);

    const all = { target: 'ALL', audience: 'OWNERS', severity: 'INFO', title: `News ${run}`, body: 'A new feature is out.' };
    await request(server).post('/api/platform/messages').set(support).send(all).expect(403);
    await request(server).post('/api/platform/messages').set(owner).send(all).expect(201);
    // An info message is not a banner; it is listed under Plan and billing.
    expect((await notices(0)).some((n) => n.title === `News ${run}`)).toBe(false);
    const sub = (await request(server).get('/api/subscription').set(schools[0].auth).expect(200)).body;
    expect(sub.notices.some((n: { title: string }) => n.title === `News ${run}`)).toBe(true);
  });
});
