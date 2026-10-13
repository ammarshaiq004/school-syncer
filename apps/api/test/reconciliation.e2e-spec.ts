import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday, startOfLocalDay } from '../src/common/dates.js';
import { gatewayConfig } from '../src/fees/gateways/gateway-config.js';
import { jazzcashHash } from '../src/fees/gateways/jazzcash.js';
import { OnlinePaymentsService } from '../src/fees/online-payments.service.js';
import { ReconciliationService } from '../src/fees/reconciliation/reconciliation.service.js';
import { NotificationsService, type OutgoingMessage } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// The nightly check of online payments against the gateways (SCHOOL-78), in mock mode.
describe('Payment reconciliation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let reconciliation: ReconciliationService;
  const sent: OutgoingMessage[] = [];
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const today = localToday();
  const yesterday = daysBefore(today, 1);
  const period = today.slice(0, 7);

  let owner: Record<string, string>;
  let parent: Record<string, string>;
  let schoolSlug: string;
  let schoolId: string;
  const voucher: Record<string, string> = {};
  /** Checkout txnRef by child's first name. */
  const ref: Record<string, string> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    reconciliation = app.get(ReconciliationService);

    const notifications = app.get(NotificationsService);
    const original = notifications.send.bind(notifications);
    vi.spyOn(notifications, 'send').mockImplementation(async (schoolId, messages) => {
      sent.push(...messages);
      return original(schoolId, messages);
    });

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Reconcile ${run}`, ownerName: 'Owner', email: `recon+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = (await prisma.school.findUniqueOrThrow({ where: { slug: schoolSlug } })).id;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 4' }).expect(201)).body.id;
    const sectionId = (
      await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)
    ).body.id;
    let firstStudent = '';
    for (const name of ['Ali', 'Sana', 'Omar', 'Zara']) {
      const s = await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId, firstName: name, lastName: 'Khan', gender: 'MALE', guardians: [{ name: 'Imran Khan', phone: phone(1), relation: 'Father' }] })
        .expect(201);
      firstStudent ||= s.body.id;
    }
    const head = await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition' }).expect(201);
    await request(server)
      .put('/api/fees/structures')
      .set(owner)
      .send({ classId, feeHeadId: head.body.id, academicYearId: yearId, amount: 4500 })
      .expect(200);
    await request(server).post('/api/fees/invoices/generate').set(owner).send({ period }).expect(201);
    const invoices = await request(server).get(`/api/fees/invoices?period=${period}`).set(owner).expect(200);
    for (const i of invoices.body) voucher[i.student.firstName] = i.id;
    // Due in the future, so no late fine moves the amounts.
    await prisma.invoice.updateMany({ where: { id: { in: Object.values(voucher) } }, data: { dueDate: new Date('2099-01-10') } });

    const student = await request(server).get(`/api/students/${firstStudent}`).set(owner);
    await request(server)
      .post(`/api/students/${firstStudent}/guardians/${student.body.guardians[0].guardianId}/invite`)
      .set(owner)
      .expect(201);
    const invite = sent.find((m) => m.template === 'parent.invite')!;
    const login = await request(server).post('/api/auth/login').send({ schoolSlug, login: phone(1), password: invite.params.password }).expect(200);
    await keepIssuedPassword(app, login.body);
    parent = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  /** Starts a checkout and, unless left open, settles it in the mock gateway; then moves it to yesterday. */
  async function checkout(name: string, provider: string, approve?: boolean) {
    const start = await request(server).post(`/api/parent/invoices/${voucher[name]}/checkout`).set(parent).send({ provider }).expect(201);
    const id = start.body.checkout.id;
    ref[name] = start.body.checkout.txnRef;
    if (approve !== undefined) await request(server).post(`/api/parent/payments/${id}/mock`).set(parent).send({ approve }).expect(200);
    const at = new Date(startOfLocalDay(yesterday).getTime() + 10 * 3_600_000);
    const c = await prisma.onlinePayment.update({ where: { id }, data: { createdAt: at, expiresAt: new Date(at.getTime() + 3_600_000) } });
    if (c.paymentId) await prisma.payment.update({ where: { id: c.paymentId }, data: { receivedAt: new Date(at.getTime() + 60_000) } });
    return c;
  }

  const issues = async (status = 'OPEN') =>
    (await request(server).get(`/api/fees/reconciliation/issues?status=${status}`).set(owner).expect(200)).body as {
      id: string;
      kind: string;
      reference: string;
      date: string;
    }[];
  const kinds = async () => (await issues()).map((i) => `${i.kind}:${i.reference}`).sort();

  const statement = (rows: string[][]) =>
    request(server)
      .post('/api/fees/reconciliation/statements')
      .set(owner)
      .send({ provider: 'JAZZCASH', fileName: 'jazzcash.csv', grid: [['Txn Ref No', 'Transaction Date', 'Amount (PKR)', 'Status'], ...rows] });

  it('settles abandoned checkouts and lists money held for review', async () => {
    await checkout('Ali', 'JAZZCASH', true);
    await checkout('Zara', 'JAZZCASH', true);
    await checkout('Sana', 'EASYPAISA');
    await checkout('Omar', 'EASYPAISA', undefined);
    // Omar's voucher is paid at the counter, then Easypaisa confirms too: held for review.
    await request(server).post(`/api/fees/invoices/${voucher.Omar}/payments`).set(owner).send({ amount: 4500, method: 'CASH' }).expect(201);
    const omar = await prisma.onlinePayment.findUniqueOrThrow({ where: { txnRef: ref.Omar } });
    await prisma.onlinePayment.update({ where: { id: omar.id }, data: { expiresAt: new Date(Date.now() + 3_600_000) } });
    await request(server).post(`/api/parent/payments/${omar.id}/mock`).set(parent).send({ approve: true }).expect(200);

    const res = await request(server).post('/api/fees/reconciliation/run').set(owner).send({ date: yesterday }).expect(200);
    expect(res.body).toMatchObject({ status: 'ISSUES', checked: 4, settled: 1, openIssues: 1, trigger: 'manual' });
    expect(res.body.totals.JAZZCASH).toEqual({ books: { count: 2, amount: 9000 }, statement: null });
    expect((await prisma.onlinePayment.findUniqueOrThrow({ where: { txnRef: ref.Sana } })).status).toBe('FAILED');
    expect(await kinds()).toEqual([`NEEDS_REVIEW:${ref.Omar}`]);
  });

  it('matches a gateway statement both ways', async () => {
    const res = await statement([
      [ref.Ali, yesterday.split('-').reverse().join('/'), '4,500.00', 'Success'],
      ['T00UNKNOWN', `${yesterday} 18:20:00`, '3000', 'Completed'],
      ['T00DECLINED', yesterday, '2000', 'Failed'],
    ]).expect(201);
    expect(res.body).toMatchObject({ fromDate: yesterday, toDate: yesterday, rows: 2, matched: 1, skipped: 1, errorCount: 0 });
    expect(await kinds()).toEqual([`NEEDS_REVIEW:${ref.Omar}`, 'NOT_IN_BOOKS:T00UNKNOWN', `NOT_IN_STATEMENT:${ref.Zara}`].sort());

    const overview = await request(server).get('/api/fees/reconciliation').set(owner).expect(200);
    expect(overview.body.days[0]).toMatchObject({ date: yesterday, status: 'ISSUES', openIssues: 3, trigger: 'statement' });
    expect(overview.body.days[0].totals.JAZZCASH.statement).toEqual({ count: 2, amount: 7500 });
    expect(overview.body.openByKind.NOT_IN_BOOKS).toEqual({ count: 1, amount: 3000 });
  });

  it('replaces the lines of a corrected statement and clears what it fixes', async () => {
    await statement([
      [ref.Ali, yesterday, '4500', 'Success'],
      [ref.Zara, yesterday, '4500', 'Success'],
    ]).expect(201);
    expect(await kinds()).toEqual([`NEEDS_REVIEW:${ref.Omar}`]);
    expect(await prisma.gatewayStatementLine.count({ where: { schoolId } })).toBe(2);
    const cleared = (await issues('RESOLVED')).map((i) => i.kind).sort();
    expect(cleared).toEqual(['NOT_IN_BOOKS', 'NOT_IN_STATEMENT']);
  });

  it('flags an amount the statement disagrees with', async () => {
    await statement([
      [ref.Ali, yesterday, '4000', 'Success'],
      [ref.Zara, yesterday, '4500', 'Success'],
    ]).expect(201);
    expect(await kinds()).toEqual([`AMOUNT_MISMATCH:${ref.Ali}`, `NEEDS_REVIEW:${ref.Omar}`].sort());
    await statement([
      [ref.Ali, yesterday, '4500', 'Success'],
      [ref.Zara, yesterday, '4500', 'Success'],
    ]).expect(201);
  });

  it('keeps an issue the fee office resolved closed', async () => {
    const [review] = await issues();
    await request(server).post(`/api/fees/reconciliation/issues/${review.id}/resolve`).set(owner).send({ note: '' }).expect(400);
    await request(server)
      .post(`/api/fees/reconciliation/issues/${review.id}/resolve`)
      .set(owner)
      .send({ note: 'Refunded Rs 4,500 to the parent from the Easypaisa portal.' })
      .expect(200);
    const overview = await request(server).get('/api/fees/reconciliation').set(owner).expect(200);
    expect(overview.body.days[0]).toMatchObject({ status: 'CLEAN', openIssues: 0 });
    const again = await request(server).post('/api/fees/reconciliation/run').set(owner).send({ date: yesterday }).expect(200);
    expect(again.body).toMatchObject({ status: 'CLEAN', openIssues: 0 });
    const resolved = await issues('RESOLVED');
    expect(resolved.find((i) => i.id === review.id)).toMatchObject({ kind: 'NEEDS_REVIEW' });
  });

  it('runs nightly once per school and day', async () => {
    // As if yesterday had not been looked at yet.
    await prisma.paymentReconciliation.deleteMany({ where: { schoolId } });
    await reconciliation.runDue();
    const runs = await prisma.paymentReconciliation.findMany({ where: { schoolId } });
    // Days before the school's first online payment have nothing to check.
    expect(runs.map((r) => [r.date.toISOString().slice(0, 10), r.trigger, r.status])).toEqual([[yesterday, 'auto', 'CLEAN']]);
    await reconciliation.runDue();
    expect(await prisma.paymentReconciliation.count({ where: { schoolId } })).toBe(1);
  });

  it('refuses unfinished days, unreadable statements and parents', async () => {
    await request(server).post('/api/fees/reconciliation/run').set(owner).send({ date: today }).expect(400);
    const bad = await request(server)
      .post('/api/fees/reconciliation/statements')
      .set(owner)
      .send({ provider: 'EASYPAISA', fileName: 'x.csv', grid: [['Name', 'Value'], ['a', 'b']] })
      .expect(400);
    expect(bad.body.message).toContain('order or transaction reference');
    await request(server).get('/api/fees/reconciliation').set(parent).expect(403);
  });

  it('asks JazzCash about a checkout whose return never arrived (sandbox)', async () => {
    const online = app.get(OnlinePaymentsService);
    const mock = online.config;
    const sandbox = gatewayConfig({
      PAYMENTS_MODE: 'sandbox',
      JAZZCASH_MERCHANT_ID: 'MC1',
      JAZZCASH_PASSWORD: 'pw',
      JAZZCASH_INTEGRITY_SALT: 'salt',
    });
    await checkout('Sana', 'JAZZCASH');
    const asked: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      asked.push([url, JSON.parse(String(init?.body))]);
      const answer: Record<string, string> = {
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'Successfully Inquired',
        pp_PaymentResponseCode: '121',
        pp_PaymentResponseMessage: 'Transaction has been completed.',
        pp_RetreivalReferenceNo: '261006123456',
        pp_TxnRefNo: ref.Sana,
      };
      answer.pp_SecureHash = jazzcashHash(answer, 'salt');
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    Object.assign(online, { config: sandbox });
    online.forget(schoolId);
    try {
      expect(await reconciliation.sweep(schoolId)).toBe(1);
    } finally {
      Object.assign(online, { config: mock });
      online.forget(schoolId);
      fetchSpy.mockRestore();
    }
    expect(asked[0]).toEqual([sandbox.jazzcash.inquiryUrl, expect.objectContaining({ pp_TxnRefNo: ref.Sana, pp_MerchantID: 'MC1' })]);
    const sana = await prisma.onlinePayment.findUniqueOrThrow({ where: { txnRef: ref.Sana }, include: { payment: true } });
    expect(sana).toMatchObject({ status: 'PAID', providerRef: '261006123456', payment: { amount: 4500, method: 'JAZZCASH' } });
  });
});
