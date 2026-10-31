import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// A problem report is a support ticket: staff assign it and reply, and the school reads the reply.
describe('Support tickets (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const adminEmail = `ticket-admin+${run}@schoolsyncer.test`;
  let admin: Record<string, string>;
  let adminId: string;
  let owner: Record<string, string>;
  let schoolId: string;
  let slug: string;
  let reportId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    adminId = (await prisma.platformAdmin.create({ data: { email: adminEmail, name: 'Ticket Admin', role: 'SUPPORT', passwordHash: await bcrypt.hash('password123', 4) } })).id;
    admin = { Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email: adminEmail, password: 'password123' }).expect(200)).body.accessToken}` };
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Tickets ${run}`, ownerName: 'Owner', email: `ticket${run}@test.pk`, password: 'password123' })
      .expect(201);
    slug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: adminEmail } } });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('lists staff a ticket can go to, and files by who looks after it', async () => {
    reportId = (await request(server).post('/api/problem-reports').set(owner).send({ message: 'Fee screen shows a blank page', page: '/fees' }).expect(201)).body.id;
    expect((await request(server).get('/api/platform/problem-reports/assignees').set(admin).expect(200)).body).toContainEqual({ id: adminId, name: 'Ticket Admin' });
    const unassigned = (await request(server).get(`/api/platform/problem-reports?assigned=none&schoolId=${schoolId}`).set(admin).expect(200)).body;
    expect(unassigned.items.map((r: { id: string }) => r.id)).toContain(reportId);

    await request(server).patch(`/api/platform/problem-reports/${reportId}/assign`).set(admin).send({ adminId: 'nobody' }).expect(404);
    const assigned = (await request(server).patch(`/api/platform/problem-reports/${reportId}/assign`).set(admin).send({ adminId }).expect(200)).body;
    expect(assigned.assignedTo).toEqual({ id: adminId, name: 'Ticket Admin' });
    const mine = (await request(server).get(`/api/platform/problem-reports?assigned=${adminId}`).set(admin).expect(200)).body;
    expect(mine.items.map((r: { id: string }) => r.id)).toEqual([reportId]);
    const none = (await request(server).get(`/api/platform/problem-reports?assigned=none&schoolId=${schoolId}`).set(admin).expect(200)).body;
    expect(none.items).toHaveLength(0);
    const back = (await request(server).patch(`/api/platform/problem-reports/${reportId}/assign`).set(admin).send({ adminId: null }).expect(200)).body;
    expect(back.assignedTo).toBeNull();
  });

  it('shows the school a reply, not the internal notes, and emails the reporter', async () => {
    await request(server).post(`/api/platform/problem-reports/${reportId}/replies`).set(admin).send({ reply: '  ' }).expect(400);
    await request(server).post(`/api/platform/problem-reports/${reportId}/notes`).set(admin).send({ note: 'Looks like the cache' }).expect(201);
    await request(server).post(`/api/platform/problem-reports/${reportId}/replies`).set(admin).send({ reply: 'Fixed, please refresh the page.' }).expect(201);

    const school = (await request(server).get(`/api/problem-reports/${reportId}`).set(owner).expect(200)).body;
    expect(school.replies).toMatchObject([{ reply: 'Fixed, please refresh the page.' }]);
    expect(JSON.stringify(school)).not.toContain('Looks like the cache');
    expect(JSON.stringify(school)).not.toContain('Ticket Admin');

    const consoleView = (await request(server).get(`/api/platform/problem-reports/${reportId}`).set(admin).expect(200)).body;
    expect(consoleView.activity.map((a: { reply: string | null }) => a.reply).filter(Boolean)).toEqual(['Fixed, please refresh the page.']);
    const mail = await prisma.notificationLog.findFirstOrThrow({ where: { schoolId, channel: 'EMAIL', template: 'platform.support' } });
    expect(mail.body).toContain('Fixed, please refresh the page.');
    expect(await prisma.platformAuditLog.count({ where: { action: { in: ['problem_report.assign', 'problem_report.reply'] }, admin: { email: adminEmail } } })).toBe(3);
  });
});
