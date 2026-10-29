import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
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
    expect(await snapshots.take(localToday())).toBeGreaterThanOrEqual(1);
    await snapshots.take(localToday());
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

  it('is for console staff only', async () => {
    await request(server).get('/api/platform/school-health').expect(401);
  });
});
