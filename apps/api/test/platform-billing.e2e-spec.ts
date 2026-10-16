import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { BillingService, nextPeriod } from '../src/platform/billing/billing.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// SchoolSyncer billing its schools: part payments, credit, voids, past-due
// status, reminders and what the school sees.
describe('Platform billing (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let billing: BillingService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ownerEmail = `bill-owner+${run}@schoolsyncer.test`;
  const supportEmail = `bill-support+${run}@schoolsyncer.test`;
  const today = localToday();

  let admin: Record<string, string>;
  let support: Record<string, string>;
  let owner: Record<string, string>;
  let otherOwner: Record<string, string>;
  let schoolId: string;
  let otherSchoolId: string;
  const slugs: string[] = [];
  let settingsBefore: unknown;

  const register = async (name: string) => {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email: `${name.replace(/\W/g, '').toLowerCase()}@test.pk`, password: 'password123' })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return { schoolId: reg.body.user.schoolId as string, auth: { Authorization: `Bearer ${reg.body.accessToken}` } };
  };

  const consoleLogin = async (email: string) =>
    ({
      Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken}`,
    });

  const bill = (period: string) => prisma.platformInvoice.findUniqueOrThrow({ where: { schoolId_period: { schoolId, period } } });
  const statement = async () => (await request(server).get(`/api/platform/schools/${schoolId}/statement`).set(admin).expect(200)).body;


  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    billing = app.get(BillingService);
    settingsBefore = await billing.settings();

    const hash = await bcrypt.hash('password123', 4);
    await prisma.platformAdmin.createMany({
      data: [
        { email: ownerEmail, name: 'Billing Owner', role: 'OWNER', passwordHash: hash },
        { email: supportEmail, name: 'Billing Support', role: 'SUPPORT', passwordHash: hash },
      ],
    });
    admin = await consoleLogin(ownerEmail);
    support = await consoleLogin(supportEmail);

    const school = await register(`Billing ${run}`);
    schoolId = school.schoolId;
    owner = school.auth;
    const other = await register(`Other Billing ${run}`);
    otherOwner = other.auth;
    otherSchoolId = other.schoolId;
  });

  afterAll(async () => {
    const { id: _id, updatedAt: _u, ...restore } = settingsBefore as Record<string, unknown>;
    await prisma.platformSettings.update({ where: { id: 'default' }, data: restore });
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: { in: [ownerEmail, supportEmail] } } } });
    await prisma.platformAdmin.deleteMany({ where: { email: { in: [ownerEmail, supportEmail] } } });
    await app.close();
  });

  it('starts billing a converted trial from next month', async () => {
    await request(server).post('/api/subscription/plan').set(owner).send({ planCode: 'starter' }).expect(201);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId } });
    expect(sub).toMatchObject({ status: 'ACTIVE', billedFrom: nextPeriod(today.slice(0, 7)) });
    const now = await request(server).post(`/api/platform/schools/${schoolId}/bill-now`).set(admin).expect(409);
    expect(now.body.message).toMatch(/next month/);
    // From here on the school is billed for any month the tests pick.
    await prisma.subscription.update({ where: { schoolId }, data: { billedFrom: null } });
  });

  it('applies part payments to the oldest bill and tells the owner', async () => {
    const issued = await billing.issueBills('2098-01', { schoolId });
    expect(issued.created).toBe(1);
    const jan = await bill('2098-01');
    // Starter with no students: the 5,000 minimum.
    expect(jan).toMatchObject({ amount: 5000, amountPaid: 0, status: 'UNPAID', taxAmount: 0, dueDate: new Date('2098-01-10') });
    expect(await prisma.platformNotice.count({ where: { schoolId, kind: 'bill.issued', invoiceId: jan.id } })).toBe(1);

    const first = await request(server)
      .post(`/api/platform/schools/${schoolId}/payments`)
      .set(support)
      .send({ amount: 3000, method: 'Bank transfer', reference: 'TRX-1', receivedOn: '2098-01-05' })
      .expect(201);
    expect(first.body.number).toBe('SR-209801-0001');
    expect(await bill('2098-01')).toMatchObject({ amountPaid: 3000, status: 'UNPAID', paidAt: null });
    expect((await statement()).outstanding).toBe(2000);

    await request(server)
      .post(`/api/platform/schools/${schoolId}/payments`)
      .set(support)
      .send({ amount: 4000, method: 'JazzCash', reference: 'JC-2', receivedOn: '2098-01-08' })
      .expect(201);
    expect(await bill('2098-01')).toMatchObject({ amountPaid: 5000, status: 'PAID', method: 'JazzCash', reference: 'JC-2' });
    const s = await statement();
    expect(s).toMatchObject({ outstanding: 0, credit: 2000, balance: -2000 });
    expect(s.entries[0]).toMatchObject({ kind: 'payment', credit: 4000, balance: -2000 });

    // Each payment is a receipt for the owner, in the app and by email.
    const notices = await prisma.platformNotice.findMany({ where: { schoolId, kind: 'payment.received' } });
    expect(notices).toHaveLength(2);
    expect(notices.map((n) => n.body).join(' ')).toMatch(/Rs 2,000 in credit/);
    expect(await prisma.notificationLog.count({ where: { schoolId, channel: 'EMAIL', template: 'platform.billing' } })).toBeGreaterThanOrEqual(3);
  });

  it('uses credit on the next bill', async () => {
    await billing.issueBills('2098-02', { schoolId });
    expect(await bill('2098-02')).toMatchObject({ amount: 5000, amountPaid: 2000, status: 'UNPAID' });
    const notice = await prisma.platformNotice.findFirstOrThrow({ where: { schoolId, kind: 'bill.issued', invoiceId: (await bill('2098-02')).id } });
    expect(notice.body).toMatch(/Rs 2,000 is covered by your credit/);
    expect((await statement()).outstanding).toBe(3000);
  });

  it('lets only an owner void a payment, and the bills it paid are owed again', async () => {
    const payment = await prisma.platformPayment.findFirstOrThrow({ where: { schoolId, reference: 'JC-2' } });
    await request(server).post(`/api/platform/payments/${payment.id}/void`).set(support).send({ reason: 'Entered twice' }).expect(403);
    await request(server).post(`/api/platform/payments/${payment.id}/void`).set(admin).send({ reason: 'x' }).expect(400);
    const voided = await request(server).post(`/api/platform/payments/${payment.id}/void`).set(admin).send({ reason: 'Recorded against the wrong school' }).expect(201);
    expect(voided.body).toMatchObject({ status: 'VOID', voidReason: 'Recorded against the wrong school' });
    expect(await bill('2098-01')).toMatchObject({ amountPaid: 3000, status: 'UNPAID', method: null });
    expect(await bill('2098-02')).toMatchObject({ amountPaid: 0 });
    expect((await statement()).outstanding).toBe(7000);
    await request(server).post(`/api/platform/payments/${payment.id}/void`).set(admin).send({ reason: 'Again, by mistake' }).expect(409);
  });

  it('turns money paid towards a voided bill into credit', async () => {
    const jan = await bill('2098-01');
    await request(server).post(`/api/platform/invoices/${jan.id}/void`).set(admin).send({ reason: 'Billed during the free month' }).expect(201);
    expect(await bill('2098-01')).toMatchObject({ status: 'VOID', voidReason: 'Billed during the free month', amountPaid: 0 });
    // The 3,000 paid in January now sits on February's bill.
    expect(await bill('2098-02')).toMatchObject({ amountPaid: 3000, status: 'UNPAID' });
  });

  it('pays the rest of a bill in one step', async () => {
    const feb = await bill('2098-02');
    const paid = await request(server)
      .post(`/api/platform/invoices/${feb.id}/pay`)
      .set(support)
      .send({ method: 'Cash', paidAt: '2098-02-01' })
      .expect(201);
    expect(paid.body).toMatchObject({ status: 'PAID', amountPaid: 5000, method: 'Cash' });
    expect(await prisma.platformPayment.count({ where: { schoolId, amount: 2000, method: 'Cash' } })).toBe(1);
    await request(server).post(`/api/platform/invoices/${feb.id}/pay`).set(support).send({ method: 'Cash' }).expect(409);
  });

  it('marks a school past due once a bill passes its due date, and clears it when paid', async () => {
    // The other school has no payments, so nothing covers an old bill.
    await prisma.subscription.update({ where: { schoolId: otherSchoolId }, data: { status: 'ACTIVE', trialEndsAt: null } });
    await billing.issueBills('2000-03', { schoolId: otherSchoolId });
    const otherStatus = async () => (await prisma.subscription.findUniqueOrThrow({ where: { schoolId: otherSchoolId } })).status;
    expect(await otherStatus()).toBe('PAST_DUE');
    const list = await request(server).get('/api/platform/schools?status=OVERDUE_30').set(admin).expect(200);
    const row = list.body.find((s: { id: string }) => s.id === otherSchoolId);
    // On the trial's Growth plan: its 10,000 minimum.
    expect(row).toMatchObject({ balanceDue: 10000 });
    expect(row.daysOverdue).toBeGreaterThan(30);
    expect(list.body.find((s: { id: string }) => s.id === schoolId)).toBeUndefined();
    // Read-only, but the owner can still read bills and receipts.
    await request(server).post('/api/campuses').set(otherOwner).send({ name: 'Second campus' }).expect(402);
    await request(server).get('/api/subscription').set(otherOwner).expect(200);

    await request(server)
      .post(`/api/platform/schools/${otherSchoolId}/payments`)
      .set(support)
      .send({ amount: 10000, method: 'Bank transfer', reference: 'LATE' })
      .expect(201);
    expect(await otherStatus()).toBe('ACTIVE');
    const paid = await prisma.platformInvoice.findUniqueOrThrow({ where: { schoolId_period: { schoolId: otherSchoolId, period: '2000-03' } } });
    expect(paid.status).toBe('PAID');
  });

  it('sends each reminder once, from the platform sender', async () => {
    const due = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000);
    const period = '2097-05';
    const inv = await prisma.platformInvoice.create({
      data: { number: `SS-REM-${run}`, schoolId, period, planName: 'Starter', students: 0, amount: 5000, dueDate: due },
    });
    expect(await billing.sendReminders(today)).toBeGreaterThanOrEqual(1);
    expect(await billing.sendReminders(today)).toBe(0);
    const notice = await prisma.platformNotice.findUniqueOrThrow({ where: { dedupeKey: `${inv.id}:bill.due_soon` } });
    expect(notice).toMatchObject({ severity: 'INFO', title: expect.stringMatching(/^Bill due on/) });
    await prisma.platformInvoice.update({ where: { id: inv.id }, data: { status: 'VOID' } });
  });

  it('shows the school its balance, receipts and messages, and nobody else', async () => {
    const sub = await request(server).get('/api/subscription').set(owner).expect(200);
    expect(sub.body).toMatchObject({ outstanding: 0 });
    expect(sub.body.payments).toHaveLength(3);
    expect(sub.body.notices.length).toBeGreaterThan(0);

    const receipt = sub.body.payments.find((p: { method: string }) => p.method === 'Cash');
    expect(receipt.bills).toEqual([(await bill('2098-02')).number]);
    const got = await request(server).get(`/api/subscription/payments/${receipt.id}`).set(owner).expect(200);
    expect(got.body.payment.allocations[0].invoice.period).toBe('2098-02');
    expect(got.body.settings.businessName).toBeTruthy();
    const feb = await bill('2098-02');
    await request(server).get(`/api/subscription/invoices/${feb.id}`).set(owner).expect(200);
    await request(server).get(`/api/subscription/invoices/${feb.id}`).set(otherOwner).expect(404);
    await request(server).get(`/api/subscription/payments/${receipt.id}`).set(otherOwner).expect(404);

    const warning = await prisma.platformNotice.create({
      data: { schoolId, kind: 'bill.overdue', severity: 'WARNING', title: 'Bill overdue', body: 'Please pay.', dedupeKey: `test-${run}` },
    });
    const unread = await request(server).get('/api/subscription/notices/unread').set(owner).expect(200);
    expect(unread.body.map((n: { id: string }) => n.id)).toContain(warning.id);
    expect((await request(server).post(`/api/subscription/notices/${warning.id}/read`).set(otherOwner).expect(201)).body.updated).toBe(0);
    expect((await request(server).post(`/api/subscription/notices/${warning.id}/read`).set(owner).expect(201)).body.updated).toBe(1);
    const after = await request(server).get('/api/subscription/notices/unread').set(owner).expect(200);
    expect(after.body.map((n: { id: string }) => n.id)).not.toContain(warning.id);
  });

  it('prints SchoolSyncer details and adds tax only once it is switched on', async () => {
    await request(server).patch('/api/platform/settings').set(support).send({ ntn: '1234567-8' }).expect(403);
    const updated = await request(server)
      .patch('/api/platform/settings')
      .set(admin)
      .send({ businessName: 'SchoolSyncer (Pvt) Ltd', ntn: '1234567-8', salesTaxPercent: 16, paymentInstructions: 'Meezan Bank 0123' })
      .expect(200);
    expect(updated.body).toMatchObject({ ntn: '1234567-8', salesTaxPercent: 16 });
    // Earlier bills keep their amounts; the next one carries the tax.
    expect((await bill('2098-02')).taxAmount).toBe(0);
    await billing.issueBills('2098-03', { schoolId });
    expect(await bill('2098-03')).toMatchObject({ amount: 5800, taxPercent: 16, taxAmount: 800 });
    const printed = await request(server).get(`/api/platform/invoices/${(await bill('2098-03')).id}`).set(support);
    expect(printed.status).toBe(200);
    expect(printed.body.settings).toMatchObject({ businessName: 'SchoolSyncer (Pvt) Ltd', paymentInstructions: 'Meezan Bank 0123' });
    const sub = await request(server).get('/api/subscription').set(owner).expect(200);
    expect(sub.body.paymentInstructions).toBe('Meezan Bank 0123');
    await request(server).patch('/api/platform/settings').set(admin).send({ salesTaxPercent: null }).expect(200);
  });

  it('records every billing action in the console audit log', async () => {
    const actions = (await prisma.platformAuditLog.findMany({ where: { schoolId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['payment.record', 'payment.void', 'invoice.void', 'invoice.pay']));
  });
});
