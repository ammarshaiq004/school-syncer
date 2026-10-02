import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// SchoolSyncer's own console, and what a school's plan lets it do.
describe('Platform and plans (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const adminEmail = `ops+${run}@schoolsyncer.test`;
  const tinyPlan = `tiny-${run}`;
  // Far enough ahead that it never collides with real bills.
  const billPeriod = '2099-01';
  const today = localToday();

  let admin: Record<string, string>;
  let owner: Record<string, string>;
  let schoolId: string;
  let schoolSlug: string;
  let sectionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await prisma.platformAdmin.create({
      data: {
        email: adminEmail,
        name: 'Ops',
        passwordHash: await bcrypt.hash('password123', 4),
      },
    });
    await prisma.plan.create({
      data: {
        code: tinyPlan,
        name: 'Tiny',
        pricePerStudent: 10,
        minimumMonthly: 100,
        maxStudents: 1,
        maxCampuses: 1,
        features: ['fees'],
        isPublic: false,
      },
    });
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({
        schoolName: `Platform ${run}`,
        ownerName: 'Owner',
        email: `plat+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    const login = await request(server)
      .post('/api/platform/auth/login')
      .send({ email: adminEmail, password: 'password123' })
      .expect(200);
    admin = { Authorization: `Bearer ${login.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({
          name: 'This year',
          startsOn: `${today.slice(0, 4)}-01-01`,
          endsOn: `${today.slice(0, 4)}-12-31`,
          isCurrent: true,
        })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 3' })
        .expect(201)
    ).body.id;
    sectionId = (
      await request(server)
        .post(`/api/classes/${classId}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'A' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await prisma.platformInvoice.deleteMany({ where: { period: billPeriod } });
    await prisma.plan.deleteMany({ where: { code: tinyPlan } });
    await prisma.platformAuditLog.deleteMany({
      where: { admin: { email: adminEmail } },
    });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const addStudent = (firstName: string) =>
    request(server)
      .post('/api/students')
      .set(owner)
      .send({
        sectionId,
        firstName,
        gender: 'FEMALE',
        guardians: [
          {
            name: 'Parent',
            phone: `035${run.slice(-7)}${firstName.length}`,
            relation: 'Mother',
          },
        ],
      });

  it('keeps console and school logins apart', async () => {
    await request(server)
      .post('/api/platform/auth/login')
      .send({ email: adminEmail, password: 'wrong' })
      .expect(401);
    await request(server).get('/api/students').set(admin).expect(401);
    await request(server).get('/api/platform/overview').set(owner).expect(401);
    const overview = await request(server)
      .get('/api/platform/overview')
      .set(admin)
      .expect(200);
    expect(overview.body.schools).toBeGreaterThan(0);
  });

  it('starts new schools on a trial with every module', async () => {
    const me = await request(server).get('/api/auth/me').set(owner).expect(200);
    expect(me.body.plan).toMatchObject({ status: 'TRIAL', access: 'full' });
    expect(me.body.plan.features).toContain('timetable');
    const detail = await request(server)
      .get(`/api/platform/schools/${schoolId}`)
      .set(admin)
      .expect(200);
    expect(detail.body.subscription).toMatchObject({
      status: 'TRIAL',
      plan: { code: 'growth' },
    });
  });

  it('switches modules and limits with the plan', async () => {
    await request(server)
      .patch(`/api/platform/schools/${schoolId}/subscription`)
      .set(admin)
      .send({ planCode: tinyPlan, status: 'ACTIVE' })
      .expect(200);
    const blocked = await request(server)
      .get('/api/timetable/periods')
      .set(owner)
      .expect(403);
    expect(blocked.body.message).toMatch(/not part of the Tiny plan/);
    await request(server).get('/api/fees/heads').set(owner).expect(200);

    await addStudent('Ayesha').expect(201);
    const full = await addStudent('Zainab').expect(409);
    expect(full.body.message).toMatch(/allows 1 students/);
  });

  it('makes a school read-only when its trial runs out, until it picks a plan', async () => {
    await request(server)
      .patch(`/api/platform/schools/${schoolId}/subscription`)
      .set(admin)
      .send({ planCode: 'growth', status: 'TRIAL', trialEndsAt: '2020-01-01' })
      .expect(200);
    await request(server).get('/api/students').set(owner).expect(200);
    const res = await addStudent('Hira').expect(402);
    expect(res.body.message).toMatch(/trial has ended/);

    const sub = await request(server)
      .get('/api/subscription')
      .set(owner)
      .expect(200);
    expect(sub.body.access).toBe('read_only');
    await request(server)
      .post('/api/subscription/plan')
      .set(owner)
      .send({ planCode: tinyPlan })
      .expect(404); // not public
    await request(server)
      .post('/api/subscription/plan')
      .set(owner)
      .send({ planCode: 'starter' })
      .expect(201);
    await addStudent('Hira').expect(201);
  });

  it('locks out a suspended school entirely', async () => {
    await request(server)
      .patch(`/api/platform/schools/${schoolId}/subscription`)
      .set(admin)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await request(server).get('/api/students').set(owner).expect(403);
    await request(server)
      .post('/api/auth/login')
      .send({
        schoolSlug,
        login: `plat+${run}@test.pk`,
        password: 'password123',
      })
      .expect(403);
    await request(server)
      .patch(`/api/platform/schools/${schoolId}/subscription`)
      .set(admin)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(server).get('/api/students').set(owner).expect(200);
  });

  it('lets support sign in as the owner, on the record', async () => {
    const res = await request(server)
      .post(`/api/platform/schools/${schoolId}/support-login`)
      .set(admin)
      .expect(201);
    const me = await request(server)
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${res.body.accessToken}` })
      .expect(200);
    expect(me.body.name).toMatch(/SchoolSyncer support: Ops/);
    const logged = await prisma.auditLog.count({
      where: { schoolId, action: 'platform.support_login' },
    });
    expect(logged).toBe(1);
  });

  it('bills paying schools and marks bills paid', async () => {
    const gen = await request(server)
      .post('/api/platform/invoices/generate')
      .set(admin)
      .send({ period: billPeriod })
      .expect(201);
    expect(gen.body.created).toBeGreaterThan(0);
    const again = await request(server)
      .post('/api/platform/invoices/generate')
      .set(admin)
      .send({ period: billPeriod })
      .expect(201);
    expect(again.body.created).toBe(0);

    const mine = await prisma.platformInvoice.findUniqueOrThrow({
      where: { schoolId_period: { schoolId, period: billPeriod } },
    });
    // Starter: two students at 49 is below the 5,000 minimum.
    expect(mine).toMatchObject({
      planName: 'Starter',
      students: 2,
      amount: 5000,
      status: 'UNPAID',
    });

    await request(server)
      .post(`/api/platform/invoices/${mine.id}/pay`)
      .set(admin)
      .send({ method: 'Bank transfer', reference: 'T1' })
      .expect(201);
    await request(server)
      .post(`/api/platform/invoices/${mine.id}/void`)
      .set(admin)
      .expect(409);
    const sub = await request(server)
      .get('/api/subscription')
      .set(owner)
      .expect(200);
    expect(sub.body.invoices[0]).toMatchObject({
      period: billPeriod,
      status: 'PAID',
    });
  });

  it('treats a long-overdue bill as read-only', async () => {
    await prisma.platformInvoice.create({
      data: {
        number: `SS-TEST-${run}`,
        schoolId,
        period: '2000-01',
        planName: 'Starter',
        students: 2,
        amount: 5000,
        dueDate: new Date('2000-01-10'),
      },
    });
    app.get(SubscriptionService).forget(schoolId);
    await addStudent('Maryam').expect(402);
  });
});
