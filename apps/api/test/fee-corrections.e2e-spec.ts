import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutStatus, PaymentMethod } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { OnlinePaymentsService } from '../src/fees/online-payments.service.js';
import { sign } from '../src/fees/payment-webhook.controller.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

const WEBHOOK_SECRET = 'test-jazzcash-secret';

type Auth = Record<string, string>;

// Payment de-duplication scoped to a school (SCHOOL-130) and correcting fee money (SCHOOL-137).
describe('Fee money: de-duplication and corrections (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let online: OnlinePaymentsService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const today = localToday();
  const period = '2026-09';

  interface School {
    slug: string;
    schoolId: string;
    owner: Auth;
    /** Voucher by student first name. */
    voucher: Record<string, { id: string; voucherNo: string }>;
  }
  let a: School;
  let b: School;
  let accountant: Auth;
  let teacher: Auth;

  async function school(name: string, students: string[]): Promise<School> {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `${name} ${run}`, ownerName: 'Owner', email: `fix-${name.toLowerCase()}+${run}@test.pk`, password: 'password123' })
      .expect(201);
    const owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: 'This year', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 5' }).expect(201)).body.id;
    const sectionId = (
      await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)
    ).body.id;
    for (const [n, firstName] of students.entries()) {
      await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId, firstName, lastName: name, gender: 'FEMALE', guardians: [{ name: `${name} parent`, phone: phone(3 + n), relation: 'Mother' }] })
        .expect(201);
    }
    const head = await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition' }).expect(201);
    await request(server)
      .put('/api/fees/structures')
      .set(owner)
      .send({ classId, feeHeadId: head.body.id, academicYearId: yearId, amount: 5000 })
      .expect(200);
    await request(server).post('/api/fees/invoices/generate').set(owner).send({ period }).expect(201);
    const invoices = (await request(server).get(`/api/fees/invoices?period=${period}`).set(owner).expect(200)).body;
    // Due in the future, so no late fine moves the amounts.
    await prisma.invoice.updateMany({ where: { id: { in: invoices.map((i: { id: string }) => i.id) } }, data: { dueDate: new Date('2099-01-10') } });
    const voucher = Object.fromEntries(
      invoices.map((i: { id: string; voucherNo: string; student: { firstName: string } }) => [i.student.firstName, { id: i.id, voucherNo: i.voucherNo }]),
    );
    return { slug: reg.body.schoolSlug, schoolId: reg.body.user.schoolId, owner, voucher };
  }

  async function addUser(s: School, n: number, role: string) {
    await request(server)
      .post('/api/users')
      .set(s.owner)
      .send({ name: `${role} ${n}`, phone: phone(n), password: 'password123', roles: [{ role }] })
      .expect(201);
    const res = await request(server).post('/api/auth/login').send({ schoolSlug: s.slug, login: phone(n), password: 'password123' }).expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  const pay = (s: School, student: string, body: Record<string, unknown>) =>
    request(server).post(`/api/fees/invoices/${s.voucher[student].id}/payments`).set(s.owner).send(body);
  const invoice = async (s: School, student: string) =>
    (await request(server).get(`/api/fees/invoices/${s.voucher[student].id}`).set(s.owner).expect(200)).body;
  const webhook = (payload: string) =>
    request(server)
      .post('/api/payments/webhook/jazzcash')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sign(payload, WEBHOOK_SECRET))
      .send(payload);
  const audit = (s: School, action: string, entityId: string) =>
    prisma.auditLog.findFirst({ where: { schoolId: s.schoolId, action, entityId } });

  beforeAll(async () => {
    process.env.PAYMENT_WEBHOOK_SECRET_JAZZCASH = WEBHOOK_SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    online = app.get(OnlinePaymentsService);

    a = await school('Alpha', ['Ayesha', 'Bilal', 'Chand', 'Dua', 'Eman', 'Faris']);
    b = await school('Beta', ['Zara', 'Yusuf']);
    accountant = await addUser(a, 1, 'ACCOUNTANT');
    teacher = await addUser(a, 2, 'TEACHER');
  });

  afterAll(async () => {
    for (const s of [a, b]) if (s) await deleteSchools(prisma, { slug: s.slug });
    await app.close();
  });

  describe('SCHOOL-130: a reference only de-duplicates within one school', () => {
    it("records another school's bank slip with the same number as a new payment", async () => {
      const first = await pay(a, 'Ayesha', { amount: 5000, method: 'BANK', reference: 'SLIP-777' }).expect(201);
      const second = await pay(b, 'Zara', { amount: 3000, method: 'BANK', reference: 'SLIP-777' }).expect(201);
      expect(second.body.duplicate).toBe(false);
      expect(second.body.payment.id).not.toBe(first.body.payment.id);
      expect(second.body.payment).toMatchObject({ schoolId: b.schoolId, invoiceId: b.voucher.Zara.id, amount: 3000 });
      expect(await invoice(b, 'Zara')).toMatchObject({ paid: 3000, status: 'PARTIAL' });
      expect(await invoice(a, 'Ayesha')).toMatchObject({ paid: 5000, status: 'PAID' });
    });

    it('records "cash" twice in one school, for two students', async () => {
      const first = await pay(a, 'Bilal', { amount: 5000, method: 'CASH', reference: 'cash' }).expect(201);
      const second = await pay(a, 'Chand', { amount: 2000, method: 'CASH', reference: 'cash' }).expect(201);
      expect(second.body.duplicate).toBe(false);
      expect(second.body.payment.id).not.toBe(first.body.payment.id);
      expect(await invoice(a, 'Bilal')).toMatchObject({ paid: 5000, status: 'PAID' });
      expect(await invoice(a, 'Chand')).toMatchObject({ paid: 2000, status: 'PARTIAL' });
      // A slip number reused on a second instalment is a second payment too.
      const again = await pay(a, 'Chand', { amount: 1000, method: 'CASH', reference: 'cash' }).expect(201);
      expect(again.body.duplicate).toBe(false);
      expect(await invoice(a, 'Chand')).toMatchObject({ paid: 3000 });
    });

    it('counts a retried save once when the client sends an idempotency key', async () => {
      const body = { amount: 1000, method: 'CASH', idempotencyKey: `retry-${run}` };
      const first = await pay(a, 'Chand', body).expect(201);
      const retry = await pay(a, 'Chand', body).expect(201);
      expect(retry.body).toMatchObject({ duplicate: true, payment: { id: first.body.payment.id } });
      expect(await invoice(a, 'Chand')).toMatchObject({ paid: 4000 });
      // The same key for other money is refused rather than answered with this receipt.
      await pay(a, 'Dua', body).expect(409);
      // Another school may use the same key.
      expect((await pay(b, 'Yusuf', body).expect(201)).body.duplicate).toBe(false);
    });

    it('de-duplicates a gateway callback per school, never returning another school’s payment', async () => {
      const ref = `JC-${run}`;
      const forA = JSON.stringify({ voucherNo: a.voucher.Dua.voucherNo, amount: 1500, reference: ref });
      const forB = JSON.stringify({ voucherNo: b.voucher.Yusuf.voucherNo, amount: 1500, reference: ref });
      const first = await webhook(forA).expect(200);
      expect(first.body.duplicate).toBe(false);
      const other = await webhook(forB).expect(200);
      expect(other.body).toMatchObject({ duplicate: false });
      expect(other.body.receiptNo).not.toBe(first.body.receiptNo);
      // A replay in either school is answered with that school's own receipt.
      expect((await webhook(forA).expect(200)).body).toEqual({ receiptNo: first.body.receiptNo, duplicate: true });
      expect((await webhook(forB).expect(200)).body).toEqual({ receiptNo: other.body.receiptNo, duplicate: true });
      expect(await prisma.payment.count({ where: { reference: ref } })).toBe(2);
    });

    it('settles two checkouts whose gateway gives the same transaction id', async () => {
      const checkout = (s: School, student: string, n: number) =>
        prisma.onlinePayment.create({
          data: {
            schoolId: s.schoolId,
            invoiceId: s.voucher[student].id,
            provider: PaymentMethod.ONEBILL,
            amount: 500,
            txnRef: `T${n}${run}`.slice(0, 20),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      // 1Bill auth ids are six digits, so two payments can share one, even in one school.
      const checkouts = [await checkout(a, 'Eman', 1), await checkout(a, 'Faris', 2), await checkout(b, 'Yusuf', 3)];
      const settled = [];
      for (const c of checkouts) {
        settled.push(await online.apply('ONEBILL', { txnRef: c.txnRef, outcome: 'PAID', amount: 500, providerRef: '123456' }));
      }
      expect(settled.map((c) => c?.status)).toEqual([CheckoutStatus.PAID, CheckoutStatus.PAID, CheckoutStatus.PAID]);
      expect(new Set(settled.map((c) => c?.paymentId)).size).toBe(3);
      const payments = await prisma.payment.findMany({ where: { id: { in: settled.map((c) => c!.paymentId!) } } });
      expect(payments.map((p) => p.invoiceId).sort()).toEqual([a.voucher.Eman.id, a.voucher.Faris.id, b.voucher.Yusuf.id].sort());
      // The gateway confirming the same checkout again changes nothing.
      const replay = await online.apply('ONEBILL', { txnRef: checkouts[0].txnRef, outcome: 'PAID', amount: 500, providerRef: '123456' });
      expect(replay?.paymentId).toBe(settled[0]?.paymentId);
      const direct = await prisma.payment.findUniqueOrThrow({ where: { id: settled[0]!.paymentId! } });
      expect(direct.idempotencyKey).toBe(`checkout:${checkouts[0].txnRef}`);
      expect(await prisma.payment.count({ where: { invoiceId: a.voucher.Eman.id } })).toBe(1);
    });
  });

  describe('SCHOOL-137: correcting fee money', () => {
    it('reverses a counter payment: kept on record, voucher and books recalculated', async () => {
      const before = await invoice(a, 'Bilal');
      const payment = before.payments[0];
      const fees = async () => (await request(server).get(`/api/reports/fee-collection?from=${today}&to=${today}`).set(a.owner).expect(200)).body.total;
      const book = async () => (await request(server).get(`/api/accounts/cashbook?from=${today}&to=${today}`).set(a.owner).expect(200)).body.totalIn;
      const income = async () => (await request(server).get(`/api/reports/income-expense?from=${today}&to=${today}`).set(a.owner).expect(200)).body.totalIncome;
      const [feesBefore, bookBefore, incomeBefore] = [await fees(), await book(), await income()];

      await request(server).post(`/api/fees/payments/${payment.id}/reverse`).set(a.owner).send({}).expect(400);
      const res = await request(server).post(`/api/fees/payments/${payment.id}/reverse`).set(a.owner).send({ reason: 'Cheque bounced' }).expect(200);
      expect(res.body.invoice).toMatchObject({ paid: 0, status: 'UNPAID' });
      expect(res.body.payment).toMatchObject({ reversalReason: 'Cheque bounced', receiptNo: payment.receiptNo });
      expect(res.body.payment.reversedAt).toBeTruthy();

      const after = await invoice(a, 'Bilal');
      expect(after).toMatchObject({ paid: 0, balance: 5000, status: 'UNPAID' });
      expect(after.payments).toEqual([expect.objectContaining({ id: payment.id, receiptNo: payment.receiptNo, reversalReason: 'Cheque bounced' })]);
      expect(await fees()).toBe(feesBefore - 5000);
      expect(await book()).toBe(bookBefore - 5000);
      expect(await income()).toBe(incomeBefore - 5000);
      const defaulters = (await request(server).get('/api/fees/defaulters').set(a.owner).expect(200)).body;
      expect(defaulters).toEqual([]); // not due until 2099

      const list = (await request(server).get('/api/fees/payments?reversed=true').set(a.owner).expect(200)).body;
      expect(list).toEqual([expect.objectContaining({ id: payment.id, online: false, reversalReason: 'Cheque bounced' })]);
      const live = (await request(server).get('/api/fees/payments?reversed=false').set(a.owner).expect(200)).body;
      expect(live.some((p: { id: string }) => p.id === payment.id)).toBe(false);

      expect(await audit(a, 'payment.reverse', payment.id)).toMatchObject({ before: expect.objectContaining({ reversedAt: null }) });
      await request(server).post(`/api/fees/payments/${payment.id}/reverse`).set(a.owner).send({ reason: 'Again' }).expect(400);
      // The voucher takes the money again once it really arrives.
      await pay(a, 'Bilal', { amount: 5000, method: 'CASH' }).expect(201);
      expect(await invoice(a, 'Bilal')).toMatchObject({ paid: 5000, status: 'PAID' });
    });

    it('reverses one of several payments, leaving the voucher part paid', async () => {
      const before = await invoice(a, 'Chand');
      expect(before.paid).toBe(4000);
      await request(server).post(`/api/fees/payments/${before.payments[0].id}/reverse`).set(a.owner).send({ reason: 'Typed twice' }).expect(200);
      expect(await invoice(a, 'Chand')).toMatchObject({ paid: 2000, status: 'PARTIAL' });
    });

    it('reverses an online payment', async () => {
      const payment = (await invoice(a, 'Eman')).payments[0];
      const res = await request(server).post(`/api/fees/payments/${payment.id}/reverse`).set(a.owner).send({ reason: 'Refunded by 1Bill' }).expect(200);
      expect(res.body.invoice).toMatchObject({ paid: 0, status: 'UNPAID' });
      const list = (await request(server).get('/api/fees/payments?reversed=true&method=ONEBILL').set(a.owner).expect(200)).body;
      expect(list).toEqual([expect.objectContaining({ id: payment.id, online: true })]);
    });

    it('voids an unpaid voucher, but not one with payments standing', async () => {
      await request(server).post(`/api/fees/invoices/${a.voucher.Ayesha.id}/cancel`).set(a.owner).send({ reason: 'Wrong student' }).expect(400);
      await request(server).post(`/api/fees/invoices/${a.voucher.Eman.id}/cancel`).set(a.owner).send({ reason: 'x' }).expect(400);

      // Eman's only payment was reversed, so the voucher can go.
      const res = await request(server).post(`/api/fees/invoices/${a.voucher.Eman.id}/cancel`).set(a.owner).send({ reason: 'Left the school' }).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Left the school' });
      expect(await audit(a, 'invoice.cancel', a.voucher.Eman.id)).toMatchObject({ after: expect.objectContaining({ status: 'CANCELLED' }) });
      await request(server).post(`/api/fees/invoices/${a.voucher.Eman.id}/cancel`).set(a.owner).send({ reason: 'Left the school' }).expect(400);
      await pay(a, 'Eman', { amount: 100, method: 'CASH' }).expect(400);

      // Out of the defaulters and outstanding lists, even once overdue.
      await prisma.invoice.update({ where: { id: a.voucher.Eman.id }, data: { dueDate: new Date('2026-01-10') } });
      const defaulters = (await request(server).get('/api/fees/defaulters').set(a.owner).expect(200)).body;
      expect(defaulters.some((d: { invoiceId: string }) => d.invoiceId === a.voucher.Eman.id)).toBe(false);
      const outstanding = (await request(server).get('/api/reports/outstanding').set(a.owner).expect(200)).body;
      expect(outstanding.students.some((s: { name: string }) => s.name.startsWith('Eman'))).toBe(false);
      expect(outstanding.students.some((s: { name: string }) => s.name.startsWith('Faris'))).toBe(true);
      const cancelled = (await request(server).get(`/api/fees/invoices?period=${period}&status=CANCELLED`).set(a.owner).expect(200)).body;
      expect(cancelled.map((i: { id: string }) => i.id)).toEqual([a.voucher.Eman.id]);
    });

    it('adds a discount or a charge line with a reason', async () => {
      const id = a.voucher.Dua.id; // 5000 billed, 1500 paid by the gateway
      await request(server).post(`/api/fees/invoices/${id}/adjustments`).set(a.owner).send({ amount: 0, reason: 'Nothing' }).expect(400);
      await request(server).post(`/api/fees/invoices/${id}/adjustments`).set(a.owner).send({ amount: -500 }).expect(400);
      // Never below what was already paid.
      await request(server).post(`/api/fees/invoices/${id}/adjustments`).set(a.owner).send({ amount: -4000, reason: 'Too much' }).expect(400);

      const discount = await request(server)
        .post(`/api/fees/invoices/${id}/adjustments`)
        .set(a.owner)
        .send({ amount: -500, reason: 'Sibling discount agreed by principal' })
        .expect(201);
      expect(discount.body.invoice).toMatchObject({ total: 4500, paid: 1500, status: 'PARTIAL' });
      expect(discount.body.line).toMatchObject({ description: 'Discount', amount: -500, kind: 'ADJUSTMENT', reason: 'Sibling discount agreed by principal' });

      // A charge reopens a settled voucher.
      const charge = await request(server)
        .post(`/api/fees/invoices/${a.voucher.Ayesha.id}/adjustments`)
        .set(a.owner)
        .send({ amount: 800, reason: 'Lost library book', description: 'Library charge' })
        .expect(201);
      expect(charge.body.invoice).toMatchObject({ total: 5800, paid: 5000, status: 'PARTIAL' });
      const ayesha = await invoice(a, 'Ayesha');
      expect(ayesha.lines.map((l: { description: string }) => l.description)).toEqual(['Tuition', 'Library charge']);
      expect(await audit(a, 'invoice.adjust', a.voucher.Ayesha.id)).toBeTruthy();

      await request(server).post(`/api/fees/invoices/${a.voucher.Eman.id}/adjustments`).set(a.owner).send({ amount: -100, reason: 'Cancelled one' }).expect(400);
    });

    it("answers 404 for another school's vouchers and payments", async () => {
      const zara = await invoice(b, 'Zara');
      await request(server).post(`/api/fees/payments/${zara.payments[0].id}/reverse`).set(a.owner).send({ reason: 'Not ours' }).expect(404);
      await request(server).post(`/api/fees/invoices/${b.voucher.Yusuf.id}/cancel`).set(a.owner).send({ reason: 'Not ours' }).expect(404);
      await request(server).post(`/api/fees/invoices/${b.voucher.Yusuf.id}/adjustments`).set(a.owner).send({ amount: -1, reason: 'Not ours' }).expect(404);
      const listA = (await request(server).get('/api/fees/payments').set(a.owner).expect(200)).body;
      expect(listA.some((p: { id: string }) => p.id === zara.payments[0].id)).toBe(false);
      expect(await invoice(b, 'Zara')).toMatchObject({ paid: 3000, status: 'PARTIAL', total: 5000 });
    });

    it('needs fees manage to correct money, and fee access to see receipts', async () => {
      const chand = await invoice(a, 'Chand');
      const live = chand.payments.find((p: { reversedAt: string | null }) => !p.reversedAt);
      await request(server).get('/api/fees/payments').set(teacher).expect(403);
      await request(server).post(`/api/fees/payments/${live.id}/reverse`).set(teacher).send({ reason: 'Teacher' }).expect(403);

      await request(server).put('/api/roles/builtin/ACCOUNTANT').set(a.owner).send({ permissions: { fees: 'view' } }).expect(200);
      await request(server).get('/api/fees/payments').set(accountant).expect(200);
      await request(server).post(`/api/fees/payments/${live.id}/reverse`).set(accountant).send({ reason: 'View only' }).expect(403);
      await request(server).post(`/api/fees/invoices/${a.voucher.Faris.id}/cancel`).set(accountant).send({ reason: 'View only' }).expect(403);
      await request(server).post(`/api/fees/invoices/${a.voucher.Faris.id}/adjustments`).set(accountant).send({ amount: -1, reason: 'View only' }).expect(403);

      await request(server).put('/api/roles/builtin/ACCOUNTANT').set(a.owner).send({ reset: true, permissions: {} }).expect(200);
      const res = await request(server).post(`/api/fees/payments/${live.id}/reverse`).set(accountant).send({ reason: 'Counted twice' }).expect(200);
      expect(res.body.invoice).toMatchObject({ paid: 1000, status: 'PARTIAL' });
    });
  });
});
