import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { jazzcashMockReturn } from '../src/fees/gateways/jazzcash.js';
import { OnlinePaymentsService } from '../src/fees/online-payments.service.js';
import { NotificationsService, type OutgoingMessage } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// A parent paying vouchers online through the mock gateways, and the fee office seeing it.
describe('Online fee payments (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let online: OnlinePaymentsService;
  const sent: OutgoingMessage[] = [];
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `035${run.slice(-7)}${n}`;
  const today = localToday();
  const period = today.slice(0, 7);
  const onebillAuth = { username: 'mock-1link', password: 'mock-1link' };

  let owner: Record<string, string>;
  let parent: Record<string, string>;
  let schoolSlug: string;
  // Voucher id by child's first name.
  const voucher: Record<string, string> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    online = app.get(OnlinePaymentsService);

    const notifications = app.get(NotificationsService);
    const original = notifications.send.bind(notifications);
    vi.spyOn(notifications, 'send').mockImplementation(async (schoolId, messages) => {
      sent.push(...messages);
      return original(schoolId, messages);
    });

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Online pay ${run}`, ownerName: 'Owner', email: `pay+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
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
    for (const name of ['Ali', 'Sana', 'Omar']) {
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
    parent = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('offers all three gateways in mock mode, to parents only', async () => {
    const options = await request(server).get('/api/parent/payment-options').set(parent).expect(200);
    expect(options.body).toEqual({ mode: 'mock', providers: ['JAZZCASH', 'EASYPAISA', 'ONEBILL'] });
    await request(server).post(`/api/parent/invoices/${voucher.Ali}/checkout`).set(owner).send({ provider: 'JAZZCASH' }).expect(403);
  });

  it('pays a voucher with JazzCash: verified, receipted, and in the cash book once', async () => {
    const start = await request(server).post(`/api/parent/invoices/${voucher.Ali}/checkout`).set(parent).send({ provider: 'JAZZCASH' }).expect(201);
    expect(start.body.action).toEqual({ kind: 'mock' });
    expect(start.body.checkout).toMatchObject({ provider: 'JAZZCASH', amount: 4500, status: 'PENDING' });
    const id = start.body.checkout.id;

    const done = await request(server).post(`/api/parent/payments/${id}/mock`).set(parent).send({ approve: true }).expect(200);
    expect(done.body).toMatchObject({ status: 'PAID', amount: 4500, invoice: { id: voucher.Ali, balance: 0 }, student: { name: 'Ali Khan' } });
    expect(done.body.receipt.receiptNo).toMatch(/^R-/);
    expect(sent.some((m) => m.template === 'fees.paid' && m.params.receiptNo === done.body.receipt.receiptNo)).toBe(true);

    // JazzCash posting the same signed result again changes nothing.
    const replay = jazzcashMockReturn(online.config, { txnRef: done.body.txnRef, amount: 4500, approve: true, at: new Date() });
    const back = await request(server).post('/api/payments/return/jazzcash').type('form').send(replay).expect(303);
    expect(back.headers.location).toBe(`http://localhost:3000/parent/invoices/${voucher.Ali}?payment=${id}`);
    const payments = await prisma.payment.findMany({ where: { invoiceId: voucher.Ali } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: 'JAZZCASH', amount: 4500 });

    const detail = await request(server).get(`/api/parent/invoices/${voucher.Ali}`).set(parent).expect(200);
    expect(detail.body.displayStatus).toBe('PAID');
    const book = await request(server).get(`/api/accounts/cashbook?from=${today}&to=${today}`).set(owner).expect(200);
    expect(book.body.rows).toContainEqual(expect.objectContaining({ source: 'FEES', method: 'JAZZCASH', amount: 4500 }));

    // Nothing more can be started on a settled voucher.
    await request(server).post(`/api/parent/invoices/${voucher.Ali}/checkout`).set(parent).send({ provider: 'EASYPAISA' }).expect(400);
  });

  it('ignores a forged JazzCash return', async () => {
    const start = await request(server).post(`/api/parent/invoices/${voucher.Sana}/checkout`).set(parent).send({ provider: 'JAZZCASH' }).expect(201);
    const forged = jazzcashMockReturn(online.config, { txnRef: start.body.checkout.txnRef, amount: 4500, approve: false, at: new Date() });
    forged.pp_ResponseCode = '000';
    const back = await request(server).post('/api/payments/return/jazzcash').type('form').send(forged).expect(303);
    expect(back.headers.location).toBe('http://localhost:3000/parent/invoices?payment=unverified');
    const after = await request(server).get(`/api/parent/payments/${start.body.checkout.id}`).set(parent).expect(200);
    expect(after.body.status).toBe('PENDING');
  });

  it('records a declined Easypaisa checkout as failed', async () => {
    const start = await request(server).post(`/api/parent/invoices/${voucher.Sana}/checkout`).set(parent).send({ provider: 'EASYPAISA' }).expect(201);
    const done = await request(server).post(`/api/parent/payments/${start.body.checkout.id}/mock`).set(parent).send({ approve: false }).expect(200);
    expect(done.body).toMatchObject({ status: 'FAILED', receipt: null });
  });

  it('takes a 1Bill payment through the 1LINK inquiry and payment calls', async () => {
    const start = await request(server).post(`/api/parent/invoices/${voucher.Sana}/checkout`).set(parent).send({ provider: 'ONEBILL' }).expect(201);
    const consumer = start.body.action.consumerNumber;
    expect(consumer).toMatch(/^00000\d{10}$/);

    const denied = await request(server).post('/api/payments/1bill/bill-inquiry').set({ username: 'x', password: 'y' }).send({ consumer_number: consumer }).expect(200);
    expect(denied.body.response_Code).toBe('05');
    const missing = await request(server).post('/api/payments/1bill/bill-inquiry').set(onebillAuth).send({ consumer_number: '000009999999999' }).expect(200);
    expect(missing.body.response_Code).toBe('01');

    const bill = await request(server).post('/api/payments/1bill/bill-inquiry').set(onebillAuth).send({ consumer_number: consumer }).expect(200);
    expect(bill.body).toMatchObject({ response_Code: '00', bill_status: 'U', amount_within_dueDate: '+0000000450000' });
    expect(bill.body.consumer_Detail.trim()).toBe('Sana Khan');

    const wrongAmount = { consumer_number: consumer, tran_auth_id: '123456', transaction_amount: '000000400000', bank_mnemonic: 'HBL' };
    expect((await request(server).post('/api/payments/1bill/bill-payment').set(onebillAuth).send(wrongAmount)).body.response_Code).toBe('04');

    const pay = { ...wrongAmount, transaction_amount: '000000450000' };
    const paid = await request(server).post('/api/payments/1bill/bill-payment').set(onebillAuth).send(pay).expect(200);
    expect(paid.body.response_Code).toBe('00');
    expect(paid.body.Identification_parameter).toMatch(/^R-/);
    // A retry gets the same receipt; another bank paying again is refused.
    const retry = await request(server).post('/api/payments/1bill/bill-payment').set(onebillAuth).send(pay).expect(200);
    expect(retry.body).toMatchObject({ response_Code: '00', Identification_parameter: paid.body.Identification_parameter });
    const twice = await request(server).post('/api/payments/1bill/bill-payment').set(onebillAuth).send({ ...pay, tran_auth_id: '999' }).expect(200);
    expect(twice.body.response_Code).toBe('02');

    const after = await request(server).post('/api/payments/1bill/bill-inquiry').set(onebillAuth).send({ consumer_number: consumer }).expect(200);
    expect(after.body).toMatchObject({ bill_status: 'P', tran_auth_Id: '123456' });
    expect(await prisma.payment.count({ where: { invoiceId: voucher.Sana } })).toBe(1);
  });

  it('holds a wallet payment for review when the voucher was settled at the counter meanwhile', async () => {
    const start = await request(server).post(`/api/parent/invoices/${voucher.Omar}/checkout`).set(parent).send({ provider: 'EASYPAISA' }).expect(201);
    await request(server).post(`/api/fees/invoices/${voucher.Omar}/payments`).set(owner).send({ amount: 4500, method: 'CASH' }).expect(201);
    const done = await request(server).post(`/api/parent/payments/${start.body.checkout.id}/mock`).set(parent).send({ approve: true }).expect(200);
    expect(done.body.status).toBe('REVIEW');
    expect(done.body.message).toContain('already paid');
  });

  it('lists checkouts for the fee office', async () => {
    const list = await request(server).get('/api/fees/online-payments').set(owner).expect(200);
    expect(list.body.mode).toBe('mock');
    expect(list.body.items).toHaveLength(5);
    expect(list.body.summary.PAID).toEqual({ count: 2, amount: 9000 });
    expect(list.body.summary.REVIEW.count).toBe(1);
    expect(list.body.summary.FAILED.count).toBe(1);
    const review = await request(server).get('/api/fees/online-payments?status=REVIEW').set(owner).expect(200);
    expect(review.body.items[0]).toMatchObject({ provider: 'EASYPAISA', student: { name: 'Omar Khan' } });
    await request(server).get('/api/fees/online-payments').set(parent).expect(403);
  });
});
