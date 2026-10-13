import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { gatewayConfig, type GatewayConfig } from '../src/fees/gateways/gateway-config.js';
import { jazzcashHash } from '../src/fees/gateways/jazzcash.js';
import { OnlinePaymentsService } from '../src/fees/online-payments.service.js';
import { NotificationsService, type OutgoingMessage } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// A school entering its own merchant accounts, in sandbox mode with the server's JazzCash account as fallback.
describe('School payment accounts (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let online: OnlinePaymentsService;
  let mock: GatewayConfig;
  const sandbox = gatewayConfig({
    PAYMENTS_MODE: 'sandbox',
    JAZZCASH_MERCHANT_ID: 'PLATFORM1',
    JAZZCASH_PASSWORD: 'platform-pass',
    JAZZCASH_INTEGRITY_SALT: 'platform-salt',
  });
  const sent: OutgoingMessage[] = [];
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `037${run.slice(-7)}${n}`;
  const today = localToday();
  const period = today.slice(0, 7);
  const prefix = `9${run.slice(-5)}`;

  let owner: Record<string, string>;
  let parent: Record<string, string>;
  let schoolSlug: string;
  const voucher: Record<string, string> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    online = app.get(OnlinePaymentsService);
    mock = online.config;
    Object.assign(online, { config: sandbox });
    process.env.PAYMENTS_SECRET_KEY = 'e2e-only key that is long enough to use';

    const notifications = app.get(NotificationsService);
    const original = notifications.send.bind(notifications);
    vi.spyOn(notifications, 'send').mockImplementation(async (schoolId, messages) => {
      sent.push(...messages);
      return original(schoolId, messages);
    });

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Own accounts ${run}`, ownerName: 'Owner', email: `accounts+${run}@test.pk`, password: 'password123' })
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
    await keepIssuedPassword(app, login.body);
    parent = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    Object.assign(online, { config: mock });
    delete process.env.PAYMENTS_SECRET_KEY;
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  const accounts = () => request(server).get('/api/school/payment-accounts').set(owner).expect(200);
  const options = async () => (await request(server).get('/api/parent/payment-options').set(parent).expect(200)).body.providers;

  it("falls back to the server's JazzCash account", async () => {
    const res = await accounts();
    expect(res.body).toMatchObject({ mode: 'sandbox', canSaveSecrets: true });
    expect(res.body.gateways.map((g: { provider: string; source: string | null }) => [g.provider, g.source])).toEqual([
      ['JAZZCASH', 'platform'],
      ['EASYPAISA', null],
      ['ONEBILL', null],
    ]);
    expect(res.body.urls.JAZZCASH.ipnUrl).toBe('http://localhost:4000/api/payments/ipn/jazzcash');
    expect(await options()).toEqual(['JAZZCASH']);
  });

  it("sends JazzCash checkouts to the school's own account once saved, and never shows its secrets", async () => {
    await request(server)
      .put('/api/school/payment-accounts/jazzcash')
      .set(owner)
      .send({ enabled: true, settings: { merchantId: 'SCHOOL42' }, secrets: { password: 'school-pass' } })
      .expect(200);
    let res = await accounts();
    let jazz = res.body.gateways[0];
    // Half filled in: the server's account carries on.
    expect(jazz).toMatchObject({ source: 'platform', ownAccount: { missing: ['integritySalt'], secretsSet: { password: true, integritySalt: false } } });

    res = await request(server)
      .put('/api/school/payment-accounts/jazzcash')
      .set(owner)
      .send({ enabled: true, settings: { merchantId: 'SCHOOL42' }, secrets: { integritySalt: 'school-salt' } })
      .expect(200);
    jazz = res.body.gateways[0];
    expect(jazz).toMatchObject({ source: 'school', ownAccount: { missing: [], settings: { merchantId: 'SCHOOL42' } } });
    expect(JSON.stringify(res.body)).not.toMatch(/school-pass|school-salt/);
    const row = await prisma.schoolPaymentGateway.findFirstOrThrow({ where: { provider: 'JAZZCASH', school: { slug: schoolSlug } } });
    expect(row.secrets).toMatch(/^v1:/);
    expect(row.secrets).not.toContain('school-salt');

    const start = await request(server).post(`/api/parent/invoices/${voucher.Ali}/checkout`).set(parent).send({ provider: 'JAZZCASH' }).expect(201);
    const f = start.body.action.fields;
    expect(f).toMatchObject({ pp_MerchantID: 'SCHOOL42', pp_Password: 'school-pass' });
    expect(f.pp_SecureHash).toBe(jazzcashHash(f, 'school-salt'));

    // A return signed with the server's salt is not this school's; one with the school's is.
    const ret: Record<string, string> = {
      pp_MerchantID: 'SCHOOL42',
      pp_TxnRefNo: start.body.checkout.txnRef,
      pp_Amount: '450000',
      pp_ResponseCode: '000',
      pp_RetreivalReferenceNo: '777001',
    };
    const ipn = await request(server).post('/api/payments/ipn/jazzcash').send({ ...ret, pp_SecureHash: jazzcashHash(ret, 'platform-salt') }).expect(200);
    expect(ipn.body.pp_ResponseCode).toBe('001');
    const ok = await request(server).post('/api/payments/ipn/jazzcash').send({ ...ret, pp_SecureHash: jazzcashHash(ret, 'school-salt') }).expect(200);
    expect(ok.body.pp_ResponseCode).toBe('000');
    expect(ok.body.pp_SecureHash).toBe(jazzcashHash({ pp_ResponseCode: '000', pp_ResponseMessage: 'IPN received' }, 'school-salt'));
    const after = await request(server).get(`/api/parent/payments/${start.body.checkout.id}`).set(parent).expect(200);
    expect(after.body).toMatchObject({ status: 'PAID', providerRef: '777001' });
  });

  it("answers 1LINK only with the school's biller credentials", async () => {
    await request(server)
      .put('/api/school/payment-accounts/onebill')
      .set(owner)
      .send({ enabled: true, settings: { billerPrefix: prefix, username: 'school-1link' }, secrets: { password: 'school-1link-pass' } })
      .expect(200);
    expect(await options()).toEqual(['JAZZCASH', 'ONEBILL']);
    const start = await request(server).post(`/api/parent/invoices/${voucher.Sana}/checkout`).set(parent).send({ provider: 'ONEBILL' }).expect(201);
    const consumer = start.body.action.consumerNumber;
    expect(consumer.startsWith(prefix)).toBe(true);

    const ask = (headers: Record<string, string>, number = consumer) =>
      request(server).post('/api/payments/1bill/bill-inquiry').set(headers).send({ consumer_number: number }).expect(200);
    expect((await ask({ username: 'mock-1link', password: 'mock-1link' })).body.response_Code).toBe('05');
    expect((await ask({ username: 'school-1link', password: 'school-1link-pass' })).body.response_Code).toBe('00');
    // An unknown number under the school's prefix: right credentials, nothing found.
    expect((await ask({ username: 'school-1link', password: 'school-1link-pass' }, `${prefix}0000000001`)).body.response_Code).toBe('01');
  });

  it('switches a gateway off for the school even when the server has an account', async () => {
    await request(server).put('/api/school/payment-accounts/jazzcash').set(owner).send({ enabled: false }).expect(200);
    expect(await options()).toEqual(['ONEBILL']);
    await request(server).post(`/api/parent/invoices/${voucher.Omar}/checkout`).set(parent).send({ provider: 'JAZZCASH' }).expect(400);
    const res = await request(server).delete('/api/school/payment-accounts/jazzcash').set(owner).expect(200);
    expect(res.body.gateways[0]).toMatchObject({ source: 'platform', ownAccount: null });
  });

  it('checks what it stores and who may change it', async () => {
    const bad = await request(server)
      .put('/api/school/payment-accounts/easypaisa')
      .set(owner)
      .send({ enabled: true, secrets: { hashKey: 'too-short' } })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain('16 characters');
    await request(server).put('/api/school/payment-accounts/paypal').set(owner).send({ enabled: true }).expect(400);
    await request(server).get('/api/school/payment-accounts').set(parent).expect(403);

    const key = process.env.PAYMENTS_SECRET_KEY;
    delete process.env.PAYMENTS_SECRET_KEY;
    try {
      const noKey = await request(server)
        .put('/api/school/payment-accounts/easypaisa')
        .set(owner)
        .send({ enabled: true, settings: { storeId: '123' }, secrets: { password: 'x' } })
        .expect(400);
      expect(noKey.body.message).toContain('PAYMENTS_SECRET_KEY');
    } finally {
      process.env.PAYMENTS_SECRET_KEY = key;
    }
  });
});
