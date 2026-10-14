import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { dayStart, daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Auth = Record<string, string>;
interface Line {
  description: string;
  amount: number;
  kind: string;
}

// Concessions and sibling discounts (SCHOOL-140), late fines, ad-hoc vouchers,
// receipts, paging and one outstanding figure (SCHOOL-122), and safe voucher
// runs with arrears carried forward (SCHOOL-138).
describe('Fee features (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `037${run.slice(-7)}${n}`;
  const today = localToday();
  const tenDaysAgo = dayStart(daysBefore(today, 10));

  let slug = '';
  let schoolId = '';
  let owner: Auth;
  let mainAccountant: Auth;
  let northAccountant: Auth;
  let yearId = '';
  let grade5 = '';
  let section5 = '';
  const head: Record<'tuition' | 'admission', string> = { tuition: '', admission: '' };
  /** Student id by first name. */
  const kid: Record<string, string> = {};

  const api = () => request(server);
  const voucher = async (name: string, period: string) =>
    prisma.invoice.findFirstOrThrow({ where: { studentId: kid[name], monthlyPeriod: period }, include: { lines: true } });
  const detail = async (id: string, as: Auth = owner) => (await api().get(`/api/fees/invoices/${id}`).set(as).expect(200)).body;
  const pay = (id: string, amount: number, as: Auth = owner) =>
    api().post(`/api/fees/invoices/${id}/payments`).set(as).send({ amount, method: 'CASH' });
  const generate = (period: string, as: Auth = owner, extra: Record<string, unknown> = {}) =>
    api().post('/api/fees/invoices/generate').set(as).send({ period, ...extra });
  /**
   * Runs vouchers for a month and moves what it billed far into the future, so
   * only the vouchers a test makes overdue are late, whatever today's date is.
   */
  async function bill(period: string, as: Auth = owner, extra: Record<string, unknown> = {}) {
    const res = await generate(period, as, extra).expect(201);
    await notDue(res.body.runId);
    return res.body;
  }
  const notDue = (runId: string) => prisma.invoice.updateMany({ where: { runId }, data: { dueDate: new Date('2099-01-10') } });
  const outstanding = async (as: Auth = owner) => (await api().get('/api/fees/outstanding').set(as).expect(200)).body;

  async function login(n: number) {
    const res = await api().post('/api/auth/login').send({ schoolSlug: slug, login: phone(n), password: 'password123' }).expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await api()
      .post('/api/auth/register-school')
      .send({ schoolName: `Fee features ${run}`, ownerName: 'Owner', email: `fees-features+${run}@test.pk`, password: 'password123' })
      .expect(201);
    slug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    const main = (await api().get('/api/campuses').set(owner)).body[0].id;
    const north = (await api().post('/api/campuses').set(owner).send({ name: `North ${run}` }).expect(201)).body.id;
    yearId = (
      await api()
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    grade5 = (await api().post('/api/classes').set(owner).send({ campusId: main, name: 'Grade 5' }).expect(201)).body.id;
    const grade1 = (await api().post('/api/classes').set(owner).send({ campusId: north, name: 'Grade 1' }).expect(201)).body.id;
    section5 = (await api().post(`/api/classes/${grade5}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
    const section1 = (await api().post(`/api/classes/${grade1}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;

    // Ali, Sara and Omar (main) and Noor (north) share a mother: one family of four.
    const family = { name: 'Family mother', phone: phone(9), relation: 'Mother' };
    const admit = async (firstName: string, sectionId: string, guardian: { name: string; phone: string; relation: string }) => {
      kid[firstName] = (
        await api().post('/api/students').set(owner).send({ sectionId, firstName, lastName: 'Test', gender: 'MALE', guardians: [guardian] }).expect(201)
      ).body.id;
    };
    await admit('Ali', section5, family);
    await admit('Sara', section5, family);
    await admit('Omar', section5, family);
    await admit('Hina', section5, { name: 'Hina parent', phone: phone(8), relation: 'Father' });
    await admit('Zain', section1, { name: 'Zain parent', phone: phone(7), relation: 'Father' });
    await admit('Noor', section1, family);

    head.tuition = (await api().post('/api/fees/heads').set(owner).send({ name: 'Tuition' }).expect(201)).body.id;
    head.admission = (await api().post('/api/fees/heads').set(owner).send({ name: 'Admission', frequency: 'ONE_TIME' }).expect(201)).body.id;
    const fee = (classId: string, feeHeadId: string, amount: number) =>
      api().put('/api/fees/structures').set(owner).send({ classId, feeHeadId, academicYearId: yearId, amount }).expect(200);
    await fee(grade5, head.tuition, 5000);
    await fee(grade1, head.tuition, 4000);
    await fee(grade5, head.admission, 10000);

    for (const [n, campusId] of [
      [1, main],
      [2, north],
    ] as const) {
      await api()
        .post('/api/users')
        .set(owner)
        .send({ name: `Accountant ${n}`, phone: phone(n), password: 'password123', roles: [{ role: 'ACCOUNTANT', campusId }] })
        .expect(201);
    }
    mainAccountant = await login(1);
    northAccountant = await login(2);
  }, 60_000);

  afterAll(async () => {
    if (slug) await deleteSchools(prisma, { slug });
    await app.close();
  });

  describe('SCHOOL-140: concessions and sibling discount', () => {
    it('lists, sets (with months) and removes a concession, inside the campus', async () => {
      const url = `/api/fees/students/${kid.Sara}/concessions`;
      const base = { feeHeadId: head.tuition, type: 'PERCENT', reason: 'Staff child' };
      await api().put(url).set(owner).send({ ...base, value: 150 }).expect(400);
      await api().put(url).set(owner).send({ ...base, value: 50, validFrom: '2026-12', validTo: '2026-10' }).expect(400);
      await api().put(url).set(owner).send({ ...base, value: 50, validFrom: '2026-10', validTo: '2026-12' }).expect(200);
      const list = (await api().get(url).set(mainAccountant).expect(200)).body;
      expect(list).toEqual([
        expect.objectContaining({ type: 'PERCENT', value: 50, validFrom: '2026-10', validTo: '2026-12', feeHead: expect.objectContaining({ name: 'Tuition' }) }),
      ]);
      await api().get(url).set(northAccountant).expect(404);
      await api().put(url).set(northAccountant).send({ ...base, value: 10 }).expect(404);

      // Removing and adding back.
      await api().put(`/api/fees/students/${kid.Hina}/concessions`).set(owner).send({ ...base, type: 'FIXED', value: 700 }).expect(200);
      await api().delete(`/api/fees/students/${kid.Hina}/concessions/${head.tuition}`).set(northAccountant).expect(404);
      await api().delete(`/api/fees/students/${kid.Hina}/concessions/${head.tuition}`).set(owner).expect(200);
      expect((await api().get(`/api/fees/students/${kid.Hina}/concessions`).set(owner).expect(200)).body).toEqual([]);
    });

    it('keeps the sibling discount a school-wide rule', async () => {
      const rule = { siblingSecondPercent: 10, siblingThirdPercent: 20, siblingFeeHeadIds: [head.tuition] };
      await api().put('/api/fees/policy').set(mainAccountant).send(rule).expect(403);
      await api().put('/api/fees/policy').set(owner).send({ ...rule, siblingThirdPercent: 120 }).expect(400);
      await api().put('/api/fees/policy').set(owner).send({ siblingFeeHeadIds: ['nope'] }).expect(404);
      // The admission fee has to be a one-time head.
      await api().put('/api/fees/policy').set(owner).send({ admissionFeeHeadId: head.tuition }).expect(400);
      const res = await api().put('/api/fees/policy').set(owner).send({ ...rule, lateFeePerDay: 100, lateFeeCap: 500 }).expect(200);
      expect(res.body).toMatchObject({ ...rule, lateFeePerDay: 100, lateFeeCap: 500, lateFeeMaxDays: null });
      expect((await api().get('/api/fees/policy').set(mainAccountant).expect(200)).body).toMatchObject(rule);
      expect(await prisma.auditLog.findFirst({ where: { schoolId, action: 'fee_policy.update' } })).toBeTruthy();
    });

    it("shows a student's place in the family, naming only siblings the caller can see", async () => {
      const wide = (await api().get(`/api/fees/students/${kid.Omar}/fee-profile`).set(owner).expect(200)).body;
      expect(wide.sibling).toMatchObject({ rank: 3, familySize: 4, percent: 20, feeHeads: [{ id: head.tuition, name: 'Tuition' }] });
      expect(wide.sibling.siblings.map((s: { name: string }) => s.name).sort()).toEqual(['Ali Test', 'Noor Test', 'Sara Test']);
      expect(wide.oneTimeCharges).toEqual([{ feeHeadId: head.admission, name: 'Admission', amount: 10000 }]);

      const campus = (await api().get(`/api/fees/students/${kid.Omar}/fee-profile`).set(mainAccountant).expect(200)).body;
      expect(campus.sibling.siblings).toContainEqual({ id: null, name: 'Sibling at another campus', admissionNo: null });
      await api().get(`/api/fees/students/${kid.Omar}/fee-profile`).set(northAccountant).expect(404);
    });

    it('applies concessions and the sibling discount in the run, each on its own labelled line', async () => {
      const res = await bill('2026-10');
      expect(res).toMatchObject({ period: '2026-10', students: 6, created: 6, alreadyBilled: 0, skipped: 0 });

      const lines = async (name: string) =>
        (await voucher(name, '2026-10')).lines.map((l: Line) => [l.description, l.amount, l.kind]);
      expect(await lines('Ali')).toEqual([['Tuition', 5000, 'FEE']]);
      expect(await lines('Sara')).toEqual([
        ['Tuition', 5000, 'FEE'],
        ['Tuition concession', -2500, 'FEE'],
        ['Tuition sibling discount (2nd child, 10%)', -250, 'SIBLING_DISCOUNT'],
      ]);
      expect(await lines('Omar')).toEqual([
        ['Tuition', 5000, 'FEE'],
        ['Tuition sibling discount (3rd child, 20%)', -1000, 'SIBLING_DISCOUNT'],
      ]);
      // A sibling at the other campus still counts in the family.
      expect((await voucher('Noor', '2026-10')).total).toBe(3200);
      expect((await voucher('Zain', '2026-10')).total).toBe(4000);
      expect((await voucher('Hina', '2026-10')).total).toBe(5000);
    });
  });

  describe('SCHOOL-138: voucher runs', () => {
    it('is safe to run again, and two runs at once never bill anyone twice', async () => {
      expect(await bill('2026-10')).toMatchObject({ created: 0, alreadyBilled: 6 });

      const both = await Promise.all([generate('2026-11'), generate('2026-11')]);
      for (const r of both) expect([201, 409]).toContain(r.status);
      for (const r of both) if (r.status === 201) await notDue(r.body.runId);
      expect(both.filter((r) => r.status === 201).reduce((n, r) => n + r.body.created, 0)).toBe(6);
      const nov = await prisma.invoice.groupBy({ by: ['studentId'], where: { schoolId, period: '2026-11' }, _count: true });
      expect(nov).toHaveLength(6);
      expect(nov.every((r) => r._count === 1)).toBe(true);
    }, 30_000);

    it('fills the gap a crashed run left behind', async () => {
      // A run that died after some batches: one student's voucher is missing.
      await prisma.invoice.delete({ where: { id: (await voucher('Hina', '2026-11')).id } });
      const res = await bill('2026-11');
      expect(res).toMatchObject({ created: 1, alreadyBilled: 5 });
      expect((await voucher('Hina', '2026-11')).total).toBe(5000);
    }, 30_000);

    it('refuses a second run for a month while one is going, but takes over a dead one', async () => {
      const lockKey = `${schoolId}:2027-01`;
      const stuck = await prisma.voucherRun.create({ data: { schoolId, period: '2027-01', lockKey } });
      expect((await generate('2027-01').expect(409)).body.message).toMatch(/already being generated/);
      await prisma.voucherRun.update({ where: { id: stuck.id }, data: { startedAt: new Date(Date.now() - 3_600_000) } });
      expect((await bill('2027-01')).created).toBe(6);
      expect(await prisma.voucherRun.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({ status: 'FAILED', lockKey: null });
    }, 30_000);

    it("bills only the caller's campus, and lists runs with their summary", async () => {
      const res = await bill('2027-02', northAccountant);
      expect(res).toMatchObject({ students: 2, created: 2, totalBilled: 3200 + 4000 });

      const runs = (await api().get('/api/fees/voucher-runs').set(owner).expect(200)).body;
      expect(runs[0]).toMatchObject({ period: '2027-02', status: 'DONE', created: 2, totalBilled: 7200 });
      expect(runs[0].lockKey).toBeUndefined();
      expect(runs.some((r: { period: string; status: string }) => r.period === '2026-11' && r.status === 'DONE')).toBe(true);
      // Campus staff see only the runs they started.
      expect((await api().get('/api/fees/voucher-runs').set(northAccountant).expect(200)).body.map((r: { id: string }) => r.id)).toEqual([runs[0].id]);
      expect((await api().get('/api/fees/voucher-runs').set(mainAccountant).expect(200)).body).toEqual([]);
    }, 30_000);
  });

  describe('SCHOOL-122: late fines', () => {
    it('caps the fine and books it when the balance is paid, so it cannot vanish or count twice', async () => {
      const hina = await voucher('Hina', '2026-10');
      await prisma.invoice.update({ where: { id: hina.id }, data: { dueDate: tenDaysAgo } });
      // 10 days at Rs 100, capped at Rs 500.
      expect(await detail(hina.id)).toMatchObject({ lateFine: 500, balance: 5000 });

      await pay(hina.id, 5000).expect(201);
      const after = await detail(hina.id);
      expect(after).toMatchObject({ total: 5500, paid: 5000, status: 'PARTIAL', balance: 500, lateFine: 0, fineBooked: 500 });
      expect(after.lines).toContainEqual(expect.objectContaining({ description: 'Late fine (10 days late)', amount: 500, kind: 'LATE_FINE' }));
      const defaulter = (await api().get('/api/fees/defaulters').set(owner).expect(200)).body.find((d: { invoiceId: string }) => d.invoiceId === hina.id);
      expect(defaulter).toMatchObject({ balance: 500, lateFine: 0, daysOverdue: 10 });

      await pay(hina.id, 501).expect(400);
      await pay(hina.id, 500).expect(201);
      expect(await detail(hina.id)).toMatchObject({ total: 5500, paid: 5500, status: 'PAID', lateFine: 0 });
    });

    it('charges at most the set number of days', async () => {
      await api().put('/api/fees/policy').set(owner).send({ lateFeeCap: null, lateFeeMaxDays: 3 }).expect(200);
      const ali = await voucher('Ali', '2026-10');
      await prisma.invoice.update({ where: { id: ali.id }, data: { dueDate: tenDaysAgo } });
      expect(await detail(ali.id)).toMatchObject({ lateFine: 300 });
    });

    it('waives a fine with a reason, audited, inside the campus', async () => {
      const ali = await voucher('Ali', '2026-10');
      const url = `/api/fees/invoices/${ali.id}/waive-fine`;
      await api().post(url).set(northAccountant).send({ reason: 'Not mine' }).expect(404);
      await api().post(url).set(owner).send({}).expect(400);
      await api().post(url).set(mainAccountant).send({ reason: 'Family emergency' }).expect(200);
      expect(await detail(ali.id)).toMatchObject({ lateFine: 0, total: 5000, fineWaiverReason: 'Family emergency' });
      expect(await prisma.auditLog.findFirst({ where: { schoolId, action: 'invoice.waive_fine', entityId: ali.id } })).toBeTruthy();
      await api().post(url).set(owner).send({ reason: 'Again' }).expect(400);
    });

    it('takes a booked, unpaid fine back off the voucher when it is waived', async () => {
      const zain = await voucher('Zain', '2026-10');
      await prisma.invoice.update({ where: { id: zain.id }, data: { dueDate: tenDaysAgo } });
      await pay(zain.id, 1000, northAccountant).expect(201);
      expect(await detail(zain.id)).toMatchObject({ total: 4300, fineBooked: 300, balance: 3300 });
      const res = await api().post(`/api/fees/invoices/${zain.id}/waive-fine`).set(northAccountant).send({ reason: 'Principal agreed' }).expect(200);
      expect(res.body).toMatchObject({ waived: 300, invoice: { total: 4000, fineBooked: 0, paid: 1000, status: 'PARTIAL' } });
      const lines = (await detail(zain.id)).lines.map((l: Line) => [l.description, l.amount]);
      expect(lines).toEqual([
        ['Tuition', 4000],
        ['Late fine (10 days late)', 300],
        ['Late fine waived', -300],
      ]);
    });
  });

  describe('SCHOOL-122: one outstanding figure', () => {
    async function figures(as: Auth = owner) {
      const [owed, defaulters, dashboard, report, paged] = await Promise.all([
        outstanding(as),
        api().get('/api/fees/defaulters').set(as).expect(200),
        api().get('/api/dashboard/summary').set(as).expect(200),
        api().get('/api/reports/outstanding').set(as).expect(200),
        api().get('/api/fees/invoices/paged').set(as).expect(200),
      ]);
      return { owed, defaulters: defaulters.body as { balance: number }[], dashboard: dashboard.body, report: report.body, paged: paged.body };
    }

    it('matches across the defaulters list, dashboard, reports and the fees page', async () => {
      const f = await figures();
      expect(f.owed.overdue.invoices).toBeGreaterThan(0);
      expect(f.defaulters.length).toBe(f.owed.overdue.invoices);
      expect(f.defaulters.reduce((s, d) => s + d.balance, 0)).toBe(f.owed.overdue.amount);
      expect(f.dashboard.overdue).toEqual(f.owed.overdue);
      expect(f.dashboard.outstanding).toEqual(f.owed.outstanding);
      expect(f.report.total).toBe(f.owed.outstanding.amount);
      expect(f.paged.summary.outstanding).toBe(f.owed.outstanding.amount);
      expect(f.paged.summary.overdue).toEqual(f.owed.overdue);
      // Ali's fine was waived and Hina's booked and paid; nothing else is overdue with a fine.
      expect(f.owed.lateFines).toBe(0);

      // The same holds for campus staff, over their campus only.
      const north = await figures(northAccountant);
      expect(north.defaulters.reduce((s, d) => s + d.balance, 0)).toBe(north.owed.overdue.amount);
      expect(north.report.total).toBe(north.owed.outstanding.amount);
      expect(north.owed.outstanding.amount).toBeLessThan(f.owed.outstanding.amount);
    });

    it('leaves out reversed payments and cancelled vouchers', async () => {
      const before = (await outstanding()).outstanding.amount;
      const hina = await detail((await voucher('Hina', '2026-10')).id);
      const last = hina.payments.at(-1);
      await api().post(`/api/fees/payments/${last.id}/reverse`).set(owner).send({ reason: 'Counted twice' }).expect(200);
      expect((await outstanding()).outstanding.amount).toBe(before + 500);

      const omarNov = await voucher('Omar', '2026-11');
      await api().post(`/api/fees/invoices/${omarNov.id}/cancel`).set(owner).send({ reason: 'Billed by mistake' }).expect(200);
      const f = await figures();
      expect(f.owed.outstanding.amount).toBe(before + 500 - omarNov.total);
      expect(f.report.total).toBe(f.owed.outstanding.amount);
      expect(f.dashboard.outstanding).toEqual(f.owed.outstanding);
    });
  });

  describe('SCHOOL-122: receipts and the voucher list', () => {
    it('prints a receipt, marked once reversed, inside the campus', async () => {
      const hina = await detail((await voucher('Hina', '2026-10')).id);
      const [first, reversed] = hina.payments;
      const receipt = (await api().get(`/api/fees/payments/${first.id}/receipt`).set(mainAccountant).expect(200)).body;
      expect(receipt).toMatchObject({
        receiptNo: first.receiptNo,
        amount: 5000,
        method: 'CASH',
        reversedAt: null,
        online: false,
        invoice: { voucherNo: hina.voucherNo, period: '2026-10', balance: 500, student: { firstName: 'Hina', admissionNo: expect.any(String) } },
      });
      expect(receipt.invoice.school.name).toContain('Fee features');
      const marked = (await api().get(`/api/fees/payments/${reversed.id}/receipt`).set(owner).expect(200)).body;
      expect(marked).toMatchObject({ reversalReason: 'Counted twice', reversedAt: expect.any(String) });
      await api().get(`/api/fees/payments/${first.id}/receipt`).set(northAccountant).expect(404);
    });

    it('pages through every voucher with server-side filters', async () => {
      const page = (q: string, as: Auth = owner) => api().get(`/api/fees/invoices/paged?${q}`).set(as).expect(200);
      const first = (await page('period=2026-10&pageSize=4')).body;
      expect(first).toMatchObject({ total: 6, page: 1, pageSize: 4 });
      expect(first.items).toHaveLength(4);
      const second = (await page('period=2026-10&pageSize=4&page=2')).body;
      expect(second.items).toHaveLength(2);
      const ids = new Set([...first.items, ...second.items].map((i: { id: string }) => i.id));
      expect(ids.size).toBe(6);
      // Totals cover every matching voucher, not just the page.
      expect(first.summary.vouchers).toBe(6);
      expect(second.summary).toEqual(first.summary);

      const overdue = (await page('status=OVERDUE')).body;
      expect(overdue.items.length).toBeGreaterThan(0);
      for (const i of overdue.items) expect(['UNPAID', 'PARTIAL']).toContain(i.status);
      expect((await page('status=CANCELLED')).body.items.map((i: { id: string }) => i.id)).toEqual([(await voucher('Omar', '2026-11')).id]);
      expect((await page('search=hina&period=2026-10')).body.total).toBe(1);
      expect((await page(`classId=${grade5}&period=2026-10`)).body.total).toBe(4);
      expect((await page('period=2026-10', northAccountant)).body.total).toBe(2);
      await api().get('/api/fees/invoices/paged?status=NOPE').set(owner).expect(400);
      await api().get('/api/fees/invoices/paged?pageSize=1000').set(owner).expect(400);
    });
  });

  describe('SCHOOL-122: ad-hoc vouchers and the admission fee', () => {
    it("bills one-off charges for a student without taking the month's place", async () => {
      const url = `/api/fees/students/${kid.Hina}/vouchers`;
      await api().post(url).set(owner).send({ lines: [{ amount: 100 }] }).expect(400);
      await api().post(url).set(owner).send({ lines: [] }).expect(400);
      await api().post(url).set(northAccountant).send({ lines: [{ description: 'Uniform', amount: 1500 }] }).expect(404);
      const res = await api()
        .post(url)
        .set(mainAccountant)
        .send({ lines: [{ feeHeadId: head.admission, amount: 3000 }, { description: 'Uniform', amount: 1500 }] })
        .expect(201);
      expect(res.body).toMatchObject({ kind: 'ADHOC', monthlyPeriod: null, total: 4500, status: 'UNPAID' });
      expect(res.body.lines.map((l: Line) => l.description)).toEqual(['Admission', 'Uniform']);
      expect(await prisma.auditLog.findFirst({ where: { schoolId, action: 'invoice.adhoc', entityId: res.body.id } })).toBeTruthy();
      expect((await api().get(`/api/fees/invoices/paged?kind=ADHOC`).set(owner).expect(200)).body.total).toBe(1);
    });

    it('bills the admission fee on admission when the school sets one', async () => {
      await api().put('/api/fees/policy').set(owner).send({ admissionFeeHeadId: head.admission }).expect(200);
      const bilal = (
        await api()
          .post('/api/students')
          .set(owner)
          .send({ sectionId: section5, firstName: 'Bilal', gender: 'MALE', guardians: [{ name: 'Bilal parent', phone: phone(6), relation: 'Father' }] })
          .expect(201)
      ).body.id;
      kid.Bilal = bilal;
      const adhoc = await prisma.invoice.findFirstOrThrow({ where: { studentId: bilal }, include: { lines: true } });
      expect(adhoc).toMatchObject({ kind: 'ADHOC', total: 10000, monthlyPeriod: null });
      expect(adhoc.lines.map((l) => l.description)).toEqual(['Admission']);
      // The monthly run still bills the new student.
      expect(await bill('2026-10')).toMatchObject({ created: 1, alreadyBilled: 6 });
    }, 30_000);
  });

  describe('SCHOOL-137 follow-up: arrears carried forward', () => {
    it("moves an overdue balance onto the next run's voucher once, and back if that voucher is voided", async () => {
      // Noor: Rs 3,200 due 10 days ago, Rs 1,200 paid (a Rs 300 fine is booked with it).
      const noorOct = await voucher('Noor', '2026-10');
      await prisma.invoice.update({ where: { id: noorOct.id }, data: { dueDate: tenDaysAgo } });
      await pay(noorOct.id, 1200, northAccountant).expect(201);
      expect(await detail(noorOct.id)).toMatchObject({ total: 3500, paid: 1200, balance: 2300 });
      const zainOct = await detail((await voucher('Zain', '2026-10')).id);
      expect(zainOct.balance).toBe(3000);
      const before = (await outstanding()).outstanding.amount;

      const res = await bill('2026-12', northAccountant, { carryForward: true });
      expect(res).toMatchObject({ created: 2, carriedForward: 2, totalBilled: 3200 + 2300 + 4000 + 3000 });

      const noorDec = await voucher('Noor', '2026-12');
      expect(noorDec).toMatchObject({ total: 5500, arrears: 2300 });
      expect(noorDec.lines).toContainEqual(
        expect.objectContaining({ amount: 2300, kind: 'ARREARS', description: `Arrears: Oct 2026 (voucher ${noorOct.voucherNo})` }),
      );
      const carried = await detail(noorOct.id);
      expect(carried).toMatchObject({ status: 'CARRIED_FORWARD', balance: 0, lateFine: 0, carriedTo: { id: noorDec.id } });
      // Counted once: only the new month's fees were added.
      expect((await outstanding()).outstanding.amount).toBe(before + 3200 + 4000);
      const defaulters = (await api().get('/api/fees/defaulters').set(owner).expect(200)).body;
      expect(defaulters.some((d: { invoiceId: string }) => d.invoiceId === noorOct.id)).toBe(false);

      // Money on the old voucher is corrected on the new one.
      expect((await pay(noorOct.id, 100).expect(400)).body.message).toContain(noorDec.voucherNo);
      await api().post(`/api/fees/payments/${carried.payments[0].id}/reverse`).set(owner).send({ reason: 'Bounced' }).expect(400);
      await api().post(`/api/fees/invoices/${noorOct.id}/adjustments`).set(owner).send({ amount: -100, reason: 'Discount' }).expect(400);
      await api().post(`/api/fees/invoices/${noorOct.id}/cancel`).set(owner).send({ reason: 'Wrong' }).expect(400);

      // A re-run carries nothing twice.
      expect(await bill('2026-12', northAccountant, { carryForward: true })).toMatchObject({ created: 0, carriedForward: 0 });

      // Voiding the new voucher brings the balance back to the old one.
      await api().post(`/api/fees/invoices/${noorDec.id}/cancel`).set(owner).send({ reason: 'Run by mistake' }).expect(200);
      expect(await detail(noorOct.id)).toMatchObject({ status: 'PARTIAL', balance: 2300, carriedTo: null });
      expect((await outstanding()).outstanding.amount).toBe(before + 4000);
    }, 30_000);
  });
});
