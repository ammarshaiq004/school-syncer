import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { dayStart, daysBefore, localToday } from '../src/common/dates.js';
import { UsageSnapshotsService } from '../src/platform/usage-snapshots.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// The nightly snapshot of each school, the health score and the console's history.
describe('School usage snapshots (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const adminEmail = `watch-admin+${run}@schoolsyncer.test`;
  let admin: Record<string, string>;
  let schoolId: string;
  let slug: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await prisma.platformAdmin.create({
      data: { email: adminEmail, name: 'Watch Admin', role: 'SUPPORT', passwordHash: await bcrypt.hash('password123', 4) },
    });
    admin = {
      Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email: adminEmail, password: 'password123' }).expect(200)).body.accessToken}`,
    };
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Watched ${run}`, ownerName: 'Owner', email: `watched${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolId = reg.body.user.schoolId;
    slug = reg.body.schoolSlug;
    await prisma.user.updateMany({ where: { schoolId }, data: { lastLoginAt: new Date() } });
    const plan = await prisma.plan.findFirstOrThrow({ where: { minimumMonthly: { gt: 0 } } });
    await prisma.subscription.update({ where: { schoolId }, data: { status: 'ACTIVE', planId: plan.id } });
  });

  afterAll(async () => {
    await prisma.schoolUsageSnapshot.deleteMany({ where: { schoolId } });
    await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: adminEmail } } });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('records what a school did today, and taking it again replaces the row', async () => {
    const snapshots = app.get(UsageSnapshotsService);
    // Only this school: writing every school's row would collide with other test files deleting theirs.
    expect(await snapshots.take(localToday(), schoolId)).toBe(1);
    await snapshots.take(localToday(), schoolId);
    const rows = await prisma.schoolUsageSnapshot.findMany({ where: { schoolId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ students: 0, staffActive7d: 1, parentsActive7d: 0, attendanceSessions: 0, feesCollected: 0 });
    expect(rows[0].mrr).toBeGreaterThan(0);
  });

  it("shows a new school's history and does not score it yet", async () => {
    const usage = (await request(server).get(`/api/platform/schools/${schoolId}/usage?days=30`).set(admin).expect(200)).body;
    expect(usage.health).toMatchObject({ score: null, label: 'new' });
    expect(usage.snapshots).toHaveLength(1);
    expect(usage.snapshots[0]).toMatchObject({ day: localToday(), staffActive7d: 1, storageBytes: 0 });
    await request(server).get('/api/platform/schools/nope/usage').set(admin).expect(404);
  });

  it('lists schools with their health, and totals revenue by month', async () => {
    const list = (await request(server).get('/api/platform/school-health').set(admin).expect(200)).body;
    expect(list.find((s: { schoolId: string }) => s.schoolId === schoolId)).toMatchObject({ slug, status: 'ACTIVE', label: 'new', score: null });
    const history = (await request(server).get('/api/platform/reports/history').set(admin).expect(200)).body;
    expect(history.at(-1)).toMatchObject({ month: localToday().slice(0, 7), mrr: expect.any(Number) });
    expect(history.at(-1).mrr).toBeGreaterThan(0);
  });

  it('compares each month with the one before for churn and retention', async () => {
    // Last month's snapshot: this school was paying then too.
    const lastMonth = new Date(Date.UTC(Number(localToday().slice(0, 4)), Number(localToday().slice(5, 7)) - 2, 15));
    await prisma.schoolUsageSnapshot.create({
      data: { schoolId, day: lastMonth, students: 0, staffActive7d: 0, parentsActive7d: 0, attendanceSessions: 0, feesCollected: 0, messagesSent: 0, storageBytes: 0, mrr: 10_000 },
    });
    const now = (await request(server).get('/api/platform/reports/history').set(admin).expect(200)).body.at(-1);
    expect(now.payingAtStart).toBeGreaterThanOrEqual(1);
    expect(now.churned).toBeLessThan(now.payingAtStart);
    expect(now.nrr).toEqual(expect.any(Number));
  });

  it("shows how many of the last 30 days each of a school's staff used the app", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { schoolId } });
    await prisma.userActivityDay.createMany({
      data: [0, 1, 40].map((d) => ({ userId: user.id, schoolId, date: dayStart(daysBefore(localToday(), d)), roles: ['OWNER'] })),
    });
    const people = (await request(server).get(`/api/platform/schools/${schoolId}/users`).set(admin).expect(200)).body;
    expect(people.find((p: { id: string }) => p.id === user.id)).toMatchObject({ activeDays30: 2 });
  });

  it('pages and searches the bills', async () => {
    const number = (i: number) => `SS-209${i}01-${run.slice(-4)}`;
    for (const i of [1, 2, 3]) {
      await prisma.platformInvoice.create({ data: { number: number(i), schoolId, period: `209${i}-01`, planName: 'Starter', students: 0, amount: 1000, dueDate: new Date(`209${i}-01-10`) } });
    }
    const first = (await request(server).get('/api/platform/invoices?search=Watched&pageSize=2').set(admin).expect(200)).body;
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.items.map((b: { number: string }) => b.number)).toEqual([number(3), number(2)]);
    const next = (await request(server).get('/api/platform/invoices?search=Watched&pageSize=2&page=2').set(admin).expect(200)).body;
    expect(next.items.map((b: { number: string }) => b.number)).toEqual([number(1)]);
    expect((await request(server).get(`/api/platform/invoices?search=${number(2)}`).set(admin).expect(200)).body.total).toBe(1);
  });

  it('is for console staff only', async () => {
    await request(server).get('/api/platform/school-health').expect(401);
  });
});
