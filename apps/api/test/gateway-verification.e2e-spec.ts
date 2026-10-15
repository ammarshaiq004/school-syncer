import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { GatewayChecksService } from '../src/fees/gateway-checks.service.js';
import { gatewayConfig, type GatewayConfig } from '../src/fees/gateways/gateway-config.js';
import { jazzcashHash } from '../src/fees/gateways/jazzcash.js';
import { OnlinePaymentsService } from '../src/fees/online-payments.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// SCHOOL-149: "Test connection" for school and server accounts, and the
// console's guided small live test, with no network: gateway replies are
// stubbed and callbacks are posted the way the gateways post them.
describe('Gateway verification (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let online: OnlinePaymentsService;
  let checks: GatewayChecksService;
  let original: GatewayConfig;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const prefix = `8${run.slice(-5)}`;
  const adminEmail = `gateways+${run}@schoolsyncer.test`;
  const sandbox = gatewayConfig({
    PAYMENTS_MODE: 'sandbox',
    API_PUBLIC_URL: 'https://api.example.pk',
    WEB_PUBLIC_URL: 'https://portal.example.pk',
    JAZZCASH_MERCHANT_ID: 'PLATFORM9',
    JAZZCASH_PASSWORD: 'platform-pass',
    JAZZCASH_INTEGRITY_SALT: 'platform-salt',
  });
  /** What the stubbed gateway answers next, and every request it got. */
  let reply: () => Response;
  const sent: { url: string; body: string }[] = [];
  const signedNotFound = (salt: string) => {
    const body = { pp_ResponseCode: '110', pp_ResponseMessage: 'Transaction not found.' };
    return new Response(JSON.stringify({ ...body, pp_SecureHash: jazzcashHash(body, salt) }));
  };

  let schoolId = '';
  let schoolSlug = '';
  let owner: Record<string, string>;
  let campusAdmin: Record<string, string>;
  let console_: Record<string, string>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    online = app.get(OnlinePaymentsService);
    checks = app.get(GatewayChecksService);
    original = online.config;
    Object.assign(online, { config: sandbox });
    process.env.PAYMENTS_SECRET_KEY = 'e2e-only key that is long enough to use';
    process.env.API_PUBLIC_URL = 'https://api.example.pk';
    checks.fetch = async (url, init) => {
      sent.push({ url, body: String(init.body) });
      return reply();
    };

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Gateways ${run}`, ownerName: 'Owner', email: `gateways+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolId = reg.body.user.schoolId;
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: 'Campus Admin', phone: phone(1), password: 'password123', roles: [{ role: 'ADMIN', campusId }] })
      .expect(201);
    const login = await request(server).post('/api/auth/login').send({ schoolSlug, login: phone(1), password: 'password123' }).expect(200);
    await keepIssuedPassword(app, login.body);
    campusAdmin = { Authorization: `Bearer ${login.body.accessToken}` };

    await prisma.platformAdmin.create({
      data: { email: adminEmail, name: 'Gateway Tester', role: 'SUPPORT', passwordHash: await bcrypt.hash('password123', 4) },
    });
    const p = await request(server).post('/api/platform/auth/login').send({ email: adminEmail, password: 'password123' }).expect(200);
    console_ = { Authorization: `Bearer ${p.body.accessToken}` };
  });

  afterAll(async () => {
    Object.assign(online, { config: original });
    delete process.env.PAYMENTS_SECRET_KEY;
    delete process.env.API_PUBLIC_URL;
    await deleteSchools(prisma, { slug: schoolSlug });
    await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const saveJazzcash = () =>
    request(server)
      .put('/api/school/payment-accounts/jazzcash')
      .set(owner)
      .send({ enabled: true, settings: { merchantId: 'SCHOOL77' }, secrets: { password: 'school-pass', integritySalt: 'school-salt' } })
      .expect(200);

  describe('Test connection: school account', () => {
    it('needs a saved account, and a school-wide admin', async () => {
      await request(server).post('/api/school/payment-accounts/jazzcash/check').set(owner).expect(400);
      await saveJazzcash();
      await request(server).post('/api/school/payment-accounts/jazzcash/check').set(campusAdmin).expect(403);
      await request(server).post('/api/school/payment-accounts/paypal/check').set(owner).expect(400);
    });

    it("passes on a reply signed with the school's salt, without returning secrets, and is audited", async () => {
      reply = () => signedNotFound('school-salt');
      const res = await request(server).post('/api/school/payment-accounts/jazzcash/check').set(owner).expect(200);
      expect(res.body).toMatchObject({ ok: true, provider: 'JAZZCASH', account: 'school', mode: 'sandbox', code: '110', simulated: false });
      expect(JSON.stringify(res.body)).not.toMatch(/school-pass|school-salt/);
      const body = JSON.parse(sent.at(-1)!.body);
      expect(body).toMatchObject({ pp_MerchantID: 'SCHOOL77' });
      expect(body.pp_TxnRefNo).toMatch(/^TCHK/);
      // No money moved: the probe made no checkout.
      expect(await prisma.onlinePayment.count({ where: { schoolId } })).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId, action: 'payments.account.check' } });
      expect(audit.after).toMatchObject({ ok: true, code: '110', mode: 'sandbox' });
      expect(JSON.stringify(audit)).not.toMatch(/school-pass|school-salt/);
    });

    it('fails with a hint when the salt is wrong', async () => {
      reply = () => signedNotFound('platform-salt');
      const res = await request(server).post('/api/school/payment-accounts/jazzcash/check').set(owner).expect(200);
      expect(res.body).toMatchObject({ ok: false, code: '110' });
      expect(res.body.hint).toMatch(/integrity salt/);
    });

    it("self-tests the school's 1Bill handlers with its biller credentials", async () => {
      await request(server)
        .put('/api/school/payment-accounts/onebill')
        .set(owner)
        .send({ enabled: true, settings: { billerPrefix: prefix, username: 'school-1link' }, secrets: { password: 'school-1link-pass' } })
        .expect(200);
      const res = await request(server).post('/api/school/payment-accounts/onebill/check').set(owner).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.steps.map((s: { ok: boolean }) => s.ok)).toEqual([true, true, true, true, true]);
      expect(res.body.setup).toEqual({
        billInquiryUrl: 'https://api.example.pk/api/payments/1bill/bill-inquiry',
        billPaymentUrl: 'https://api.example.pk/api/payments/1bill/bill-payment',
        billerPrefix: prefix,
        username: 'school-1link',
      });
      expect(JSON.stringify(res.body)).not.toContain('school-1link-pass');
    });
  });

  describe('Test connection: server account', () => {
    it('is console-only', async () => {
      await request(server).get('/api/platform/gateways').set(owner).expect(401);
      await request(server).post('/api/platform/gateways/jazzcash/check').set(owner).expect(401);
    });

    it('shows what the server has, identifiers only', async () => {
      const res = await request(server).get('/api/platform/gateways').set(console_).expect(200);
      expect(res.body.mode).toBe('sandbox');
      expect(res.body.gateways[0]).toMatchObject({ provider: 'JAZZCASH', configured: true, missing: [], account: { merchantId: 'PLATFORM9' } });
      expect(res.body.gateways[1]).toMatchObject({ provider: 'EASYPAISA', configured: false });
      expect(res.body.gateways[1].missing).toContain('EASYPAISA_STORE_ID');
      expect(res.body.gateways[2].urls.billInquiryUrl).toBe('https://api.example.pk/api/payments/1bill/bill-inquiry');
      expect(JSON.stringify(res.body)).not.toMatch(/platform-pass|platform-salt/);
    });

    it("checks the server's account and logs it", async () => {
      reply = () => signedNotFound('platform-salt');
      const res = await request(server).post('/api/platform/gateways/jazzcash/check').set(console_).expect(200);
      expect(res.body).toMatchObject({ ok: true, account: 'platform' });
      expect(JSON.parse(sent.at(-1)!.body).pp_MerchantID).toBe('PLATFORM9');
      await request(server).post('/api/platform/gateways/easypaisa/check').set(console_).expect(400);
      const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { action: 'payments.gateway.check', admin: { email: adminEmail } } });
      expect(log.details).toMatchObject({ provider: 'JAZZCASH', ok: true });
    });

    it('is rate-limited', async () => {
      reply = () => signedNotFound('platform-salt');
      let status = 200;
      for (let i = 0; i < 12 && status === 200; i++) {
        status = (await request(server).post('/api/platform/gateways/jazzcash/check').set(console_)).status;
      }
      expect(status).toBe(429);
    });
  });

  describe('Guided small live test', () => {
    let runId = '';
    let txnRef = '';

    it('refuses amounts above the cap and gateways the school cannot use', async () => {
      await request(server).post('/api/platform/gateways/runs').set(console_).send({ schoolId, provider: 'JAZZCASH', amount: 500 }).expect(400);
      await request(server).post('/api/platform/gateways/runs').set(console_).send({ schoolId, provider: 'EASYPAISA' }).expect(400);
      await request(server).post('/api/platform/gateways/runs').set(owner).send({ schoolId, provider: 'JAZZCASH' }).expect(401);
    });

    it("makes a Rs 10 test voucher and a real checkout on the school's account", async () => {
      const res = await request(server).post('/api/platform/gateways/runs').set(console_).send({ schoolId, provider: 'JAZZCASH' }).expect(201);
      runId = res.body.run.id;
      txnRef = res.body.run.checkout.txnRef;
      expect(res.body.run).toMatchObject({ amount: 10, mode: 'sandbox', account: 'school', status: 'WAITING', callbackSeen: false });
      expect(res.body.action.fields).toMatchObject({ pp_MerchantID: 'SCHOOL77', pp_Amount: '1000' });
      expect(res.body.action.fields.pp_SecureHash).toBe(jazzcashHash(res.body.action.fields, 'school-salt'));
      const student = await prisma.student.findFirstOrThrow({ where: { schoolId, admissionNo: 'GATEWAY-TEST' } });
      expect(student.status).toBe('LEFT');
    });

    it('shows each callback as it arrives, counts duplicates once, and lands staff back in the console', async () => {
      const ret: Record<string, string> = {
        pp_MerchantID: 'SCHOOL77',
        pp_TxnRefNo: txnRef,
        pp_Amount: '1000',
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'Thank you for Using JazzCash, your transaction was successful.',
        pp_RetreivalReferenceNo: '991122',
      };
      // A forged post first: noted, not trusted.
      await request(server).post('/api/payments/ipn/jazzcash').send({ ...ret, pp_SecureHash: jazzcashHash(ret, 'wrong') }).expect(200);
      const back = await request(server).post('/api/payments/return/jazzcash').send({ ...ret, pp_SecureHash: jazzcashHash(ret, 'school-salt') }).expect(303);
      expect(back.headers.location).toBe(`https://portal.example.pk/platform/gateways?run=${runId}`);
      const ipn = await request(server).post('/api/payments/ipn/jazzcash').send({ ...ret, pp_SecureHash: jazzcashHash(ret, 'school-salt') }).expect(200);
      expect(ipn.body.pp_ResponseCode).toBe('000');

      const res = await request(server).get(`/api/platform/gateways/runs/${runId}`).set(console_).expect(200);
      expect(res.body).toMatchObject({ status: 'PAID', callbackSeen: true, receipt: { reversed: false } });
      expect(res.body.events.map((e: { kind: string; verified: boolean }) => [e.kind, e.verified])).toEqual([
        ['ipn', false],
        ['return', true],
        ['ipn', true],
      ]);
      expect(res.body.timings.toCallback).toBeGreaterThanOrEqual(0);
      expect(await prisma.payment.count({ where: { schoolId } })).toBe(1);
    });

    it('reverses the test payment so the school totals are untouched', async () => {
      await request(server).post(`/api/platform/gateways/runs/${runId}/cancel`).set(console_).expect(400);
      const res = await request(server).post(`/api/platform/gateways/runs/${runId}/reverse`).set(console_).expect(200);
      expect(res.body).toMatchObject({ status: 'REVERSED', outcome: 'reversed', receipt: { reversed: true } });
      await request(server).post(`/api/platform/gateways/runs/${runId}/reverse`).set(console_).expect(400);

      const live = await prisma.payment.aggregate({ where: { schoolId, reversedAt: null }, _sum: { amount: true } });
      expect(live._sum.amount ?? 0).toBe(0);
      const run = await prisma.gatewayTestRun.findUniqueOrThrow({ where: { id: runId } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: run.invoiceId } });
      expect(invoice).toMatchObject({ status: 'CANCELLED', paid: 0 });
      // The fee office sees it in the school's own log, by console staff.
      const reversal = await prisma.auditLog.findFirstOrThrow({ where: { schoolId, action: 'payment.reverse' } });
      expect(reversal.userId).toBeNull();
      expect(reversal.after).toMatchObject({ by: 'Gateway Tester' });
      // And the receipts list shows it reversed.
      const receipts = await request(server).get('/api/fees/payments?reversed=true').set(owner).expect(200);
      expect(receipts.body).toHaveLength(1);
    });

    it('runs the whole flow in mock mode, 1Bill included, and cancels unpaid runs', async () => {
      Object.assign(online, { config: gatewayConfig({ PAYMENTS_MODE: 'mock' }) });
      online.forget(schoolId);
      try {
        const start = await request(server).post('/api/platform/gateways/runs').set(console_).send({ schoolId, provider: 'ONEBILL', amount: 5 }).expect(201);
        expect(start.body.action.kind).toBe('onebill');
        const id = start.body.run.id;
        await request(server).post(`/api/platform/gateways/runs/${id}/refresh`).set(console_).expect(400);
        const paid = await request(server).post(`/api/platform/gateways/runs/${id}/simulate`).set(console_).send({ approve: true }).expect(200);
        expect(paid.body.status).toBe('PAID');
        expect(paid.body.events.map((e: { kind: string }) => e.kind)).toEqual(['1link-inquiry', '1link-payment']);
        await request(server).post(`/api/platform/gateways/runs/${id}/reverse`).set(console_).expect(200);

        const other = await request(server).post('/api/platform/gateways/runs').set(console_).send({ schoolId, provider: 'EASYPAISA' }).expect(201);
        expect(other.body.action.kind).toBe('mock');
        const cancelled = await request(server).post(`/api/platform/gateways/runs/${other.body.run.id}/cancel`).set(console_).expect(200);
        expect(cancelled.body).toMatchObject({ status: 'CANCELLED', checkout: { status: 'FAILED' } });
        await request(server).post(`/api/platform/gateways/runs/${other.body.run.id}/simulate`).set(console_).send({ approve: true }).expect(400);
      } finally {
        Object.assign(online, { config: sandbox });
        online.forget(schoolId);
      }
    });

    it('keeps every run in the history', async () => {
      const res = await request(server).get(`/api/platform/gateways/runs?schoolId=${schoolId}`).set(console_).expect(200);
      expect(res.body.map((r: { provider: string; status: string }) => [r.provider, r.status])).toEqual([
        ['EASYPAISA', 'CANCELLED'],
        ['ONEBILL', 'REVERSED'],
        ['JAZZCASH', 'REVERSED'],
      ]);
      expect(await prisma.student.count({ where: { schoolId, admissionNo: 'GATEWAY-TEST' } })).toBe(1);
      const actions = (await prisma.platformAuditLog.findMany({ where: { schoolId }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['payments.test.start', 'payments.test.reverse', 'payments.test.cancel']));
    });
  });
});
