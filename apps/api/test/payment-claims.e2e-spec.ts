import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { BillingService } from '../src/platform/billing/billing.service.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// A school says it paid SchoolSyncer and attaches the slip; the console checks
// it and approves (recording the payment and receipt) or rejects it.
describe('Payment claims with proof (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const adminEmail = `claims-admin+${run}@schoolsyncer.test`;
  const storageDir = mkdtempSync(join(tmpdir(), 'claims-'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const slugs: string[] = [];

  let admin: Record<string, string>;
  let owner: Record<string, string>;
  let other: Record<string, string>;
  let schoolId: string;

  const register = async (name: string) => {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email: `${name.replace(/\W/g, '').toLowerCase()}@test.pk`, password: 'password123' })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return { schoolId: reg.body.user.schoolId as string, auth: { Authorization: `Bearer ${reg.body.accessToken}` } };
  };
  const proof = async (as: Record<string, string>) =>
    (await request(server).post('/api/subscription/payment-claims/proof').set(as).attach('file', png, 'slip.png').expect(201)).body.id as string;
  const claim = (as: Record<string, string>, body: Record<string, unknown>) =>
    request(server).post('/api/subscription/payment-claims').set(as).send({ amount: 5000, method: 'Bank transfer', paidOn: localToday(), ...body });

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = storageDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await prisma.platformAdmin.create({
      data: { email: adminEmail, name: 'Claims Admin', role: 'SUPPORT', passwordHash: await bcrypt.hash('password123', 4) },
    });
    admin = {
      Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email: adminEmail, password: 'password123' }).expect(200)).body.accessToken}`,
    };
    const school = await register(`Claims ${run}`);
    schoolId = school.schoolId;
    owner = school.auth;
    other = (await register(`Other Claims ${run}`)).auth;
    // Make it a paying school with one open bill of Rs 10,000.
    await request(server).post('/api/subscription/plan').set(owner).send({ planCode: 'starter' }).expect(201);
    await prisma.platformInvoice.create({
      data: { number: `SS-209901-${run.slice(-4)}`, schoolId, period: '2099-01', planName: 'Starter', students: 0, amount: 10_000, dueDate: new Date('2099-01-10') },
    });
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: adminEmail } } });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('refuses a bad proof file and a claim with neither proof nor transaction number', async () => {
    await request(server).post('/api/subscription/payment-claims/proof').set(owner).attach('file', Buffer.from('not a png'), 'slip.png').expect(400);
    const res = await claim(owner, {}).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/transaction number or upload the proof/);
    await claim(owner, { reference: 'TRX1', paidOn: '2099-01-01' }).expect(400);
    await claim(owner, { reference: 'TRX1', proofId: 'nope' }).expect(400);
  });

  it("will not take another school's proof, and shows a school only its own claims", async () => {
    const theirs = await proof(other);
    await claim(owner, { proofId: theirs }).expect(400);
    expect((await request(server).get('/api/subscription/payment-claims').set(other).expect(200)).body).toEqual([]);
  });

  it('approves a claim into a payment with a receipt, once', async () => {
    const proofId = await proof(owner);
    const made = (await claim(owner, { reference: 'MZN-1', proofId, note: 'Paid at the branch' }).expect(201)).body;
    expect(made).toMatchObject({ status: 'PENDING', amount: 5000, reference: 'MZN-1', proof: { filename: 'slip.png' } });
    expect(made.proof.url).toMatch(/^http/);
    // The slip is now attached to the claim and cannot be reused.
    await claim(owner, { proofId }).expect(400);

    const queue = (await request(server).get('/api/platform/payment-claims').set(admin).expect(200)).body;
    expect(queue.find((c: { id: string }) => c.id === made.id)).toMatchObject({ school: { id: schoolId } });
    expect((await request(server).get('/api/platform/payment-claims/counts').set(admin).expect(200)).body.PENDING).toBeGreaterThanOrEqual(1);

    // The bank showed Rs 4,800, so staff correct the amount.
    const approved = (await request(server).post(`/api/platform/payment-claims/${made.id}/approve`).set(admin).send({ amount: 4800 }).expect(201)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', reviewedBy: 'Claims Admin', receipt: { number: expect.stringMatching(/^SR-/) } });
    await request(server).post(`/api/platform/payment-claims/${made.id}/approve`).set(admin).send({}).expect(409);
    await request(server).post(`/api/platform/payment-claims/${made.id}/reject`).set(admin).send({ reason: 'Too late to say no' }).expect(409);

    const payment = await prisma.platformPayment.findUniqueOrThrow({ where: { id: (await prisma.paymentClaim.findUniqueOrThrow({ where: { id: made.id } })).paymentId! } });
    expect(payment).toMatchObject({ amount: 4800, method: 'Bank transfer', reference: 'MZN-1', recordedBy: 'Claims Admin' });
    const sub = (await request(server).get('/api/subscription').set(owner).expect(200)).body;
    expect(sub.outstanding).toBe(5200);
    expect(sub.notices.some((n: { kind: string }) => n.kind === 'payment.received')).toBe(true);
  });

  it('rejects a claim with a reason the school is told', async () => {
    const made = (await claim(owner, { reference: 'FAKE-1', amount: 9000 }).expect(201)).body;
    await request(server).post(`/api/platform/payment-claims/${made.id}/reject`).set(admin).send({ reason: 'no' }).expect(400);
    const rejected = (await request(server).post(`/api/platform/payment-claims/${made.id}/reject`).set(admin).send({ reason: 'No such transfer in our bank statement.' }).expect(201)).body;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'No such transfer in our bank statement.', receipt: null });
    const sub = (await request(server).get('/api/subscription').set(owner).expect(200)).body;
    expect(sub.outstanding).toBe(5200);
    const notice = sub.notices.find((n: { kind: string }) => n.kind === 'payment.rejected');
    expect(notice.body).toContain('No such transfer in our bank statement.');
    const mine = (await request(server).get('/api/subscription/payment-claims').set(owner).expect(200)).body;
    expect(mine.map((c: { status: string }) => c.status)).toEqual(['REJECTED', 'APPROVED']);
  });

  it('puts the claim back in the queue when recording the payment fails', async () => {
    const made = (await claim(owner, { reference: 'RETRY-1' }).expect(201)).body;
    const billing = app.get(BillingService);
    const spy = vi.spyOn(billing, 'recordPayment').mockRejectedValueOnce(new Error('db down'));
    await request(server).post(`/api/platform/payment-claims/${made.id}/approve`).set(admin).send({}).expect(500);
    spy.mockRestore();
    expect(await prisma.paymentClaim.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ status: 'PENDING', reviewedBy: null, paymentId: null });
    await request(server).post(`/api/platform/payment-claims/${made.id}/approve`).set(admin).send({}).expect(201);
  });

  it('limits how many claims wait at once, and works while the school is read-only', async () => {
    await prisma.subscription.update({ where: { schoolId }, data: { status: 'TRIAL', trialEndsAt: new Date('2020-01-01') } });
    app.get(SubscriptionService).forget(schoolId);
    await request(server).post('/api/students').set(owner).send({}).expect(402);
    for (let i = 0; i < 10; i++) await claim(owner, { reference: `Q${i}` }).expect(201);
    await claim(owner, { reference: 'Q10' }).expect(409);
  });
});
