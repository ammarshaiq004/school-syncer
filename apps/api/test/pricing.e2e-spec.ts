import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// An agreed price per school and discounts on its SchoolSyncer bill.
describe('Pricing flexibility (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ownerEmail = `pricing-owner+${run}@schoolsyncer.test`;
  const supportEmail = `pricing-support+${run}@schoolsyncer.test`;
  const slugs: string[] = [];
  let owner: Record<string, string>;
  let support: Record<string, string>;
  let schoolId: string;

  const login = async (email: string) =>
    ({ Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash('password123', 4);
    await prisma.platformAdmin.create({ data: { email: ownerEmail, name: 'Pricing Owner', role: 'OWNER', passwordHash } });
    await prisma.platformAdmin.create({ data: { email: supportEmail, name: 'Pricing Support', role: 'SUPPORT', passwordHash } });
    owner = await login(ownerEmail);
    support = await login(supportEmail);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Priced ${run}`, ownerName: 'Owner', email: `priced${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolId = reg.body.user.schoolId;
    slugs.push(reg.body.schoolSlug);
    const plan = await prisma.plan.findFirstOrThrow({ where: { minimumMonthly: { gt: 0 } } });
    await prisma.subscription.update({ where: { schoolId }, data: { status: 'ACTIVE', planId: plan.id, billedFrom: null } });
  });

  afterAll(async () => {
    await prisma.platformDiscount.deleteMany({ where: { createdBy: 'Pricing Owner' } });
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: { in: [ownerEmail, supportEmail] } } } });
    await prisma.platformAdmin.deleteMany({ where: { email: { in: [ownerEmail, supportEmail] } } });
    await app.close();
  });

  it('lets only an owner set an agreed price, and uses it in the monthly figure', async () => {
    await request(server).patch(`/api/platform/schools/${schoolId}/subscription`).set(support).send({ agreedMinimumMonthly: 1_000 }).expect(403);
    await request(server)
      .patch(`/api/platform/schools/${schoolId}/subscription`)
      .set(owner)
      .send({ agreedPricePerStudent: 10, agreedMinimumMonthly: 5_000, agreedNote: 'Chain deal' })
      .expect(200);
    const detail = (await request(server).get(`/api/platform/schools/${schoolId}`).set(owner).expect(200)).body;
    expect(detail.subscription).toMatchObject({ agreedPricePerStudent: 10, agreedMinimumMonthly: 5_000, agreedNote: 'Chain deal', monthly: 5_000 });
  });

  it('refuses a bad discount and keeps creating them to owners', async () => {
    const body = { name: 'Launch', kind: 'PERCENT', value: 20, startsOn: localToday(), schoolId };
    await request(server).post('/api/platform/discounts').set(support).send(body).expect(403);
    await request(server).post('/api/platform/discounts').set(owner).send({ ...body, value: 150 }).expect(400);
    await request(server).post('/api/platform/discounts').set(owner).send({ ...body, endsOn: '2000-01-01' }).expect(400);
    await request(server).post('/api/platform/discounts').set(owner).send({ ...body, schoolId: 'nope' }).expect(400);
  });

  it('takes a discount off the school bill once, and a switched-off discount nothing', async () => {
    const off = (await request(server).post('/api/platform/discounts').set(owner).send({ name: 'Old', kind: 'FIXED', value: 4_000, startsOn: localToday(), schoolId }).expect(201)).body;
    await request(server).patch(`/api/platform/discounts/${off.id}`).set(owner).send({ isActive: false }).expect(200);
    const made = (await request(server).post('/api/platform/discounts').set(owner).send({ name: 'Launch', kind: 'PERCENT', value: 20, startsOn: localToday(), schoolId }).expect(201)).body;

    const bill = (await request(server).post(`/api/platform/schools/${schoolId}/bill-now`).set(owner).expect(201)).body;
    // The agreed minimum Rs 5,000 less 20%.
    expect(bill).toMatchObject({ discountAmount: 1_000, discountName: 'Launch', amount: 4_000 });

    const listed = (await request(server).get('/api/platform/discounts').set(support).expect(200)).body;
    expect(listed.find((d: { id: string }) => d.id === made.id)).toMatchObject({ timesUsed: 1, totalTaken: 1_000, schoolName: expect.any(String) });
    expect(listed.find((d: { id: string }) => d.id === off.id)).toMatchObject({ timesUsed: 0, isActive: false });

    // A later month's bill finds the discount already used.
    const next = (await request(server).post('/api/platform/invoices/generate').set(owner).send({ period: '2099-01' }).expect(201)).body;
    expect(next.created).toBeGreaterThanOrEqual(1);
    const second = await prisma.platformInvoice.findFirstOrThrow({ where: { schoolId, period: '2099-01' } });
    expect(second).toMatchObject({ discountAmount: 0, amount: 5_000 });
  });
});
