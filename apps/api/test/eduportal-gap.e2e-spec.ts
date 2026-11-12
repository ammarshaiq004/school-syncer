import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// The EduPortal migration gaps: back-dating, advance credit, leaving reasons, dashboard widgets, promises to pay.
describe('EduPortal gap closure (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const storageDir = mkdtempSync(join(tmpdir(), 'gap-docs-'));
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const email = `gap+${run}@test.pk`;
  const phone = (n: number) => `030${run.slice(-7)}${n}`;
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const period = todayIso.slice(0, 7);

  let owner: Record<string, string>;
  let schoolSlug: string;
  let sectionId: string;
  let ahmed: string;
  let sara: string;
  let zara: string;

  const summary = async () => (await request(server).get('/api/dashboard/summary').set(owner).expect(200)).body;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = storageDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Gap ${run}`, ownerName: 'Owner', email, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('sets up a school with a fee structure', async () => {
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const year = await request(server)
      .post('/api/academic-years')
      .set(owner)
      .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
      .expect(201);
    const grade = await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 1' }).expect(201);
    const section = await request(server)
      .post(`/api/classes/${grade.body.id}/sections`)
      .set(owner)
      .send({ academicYearId: year.body.id, name: 'A' })
      .expect(201);
    sectionId = section.body.id;
    const head = await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition', frequency: 'MONTHLY' }).expect(201);
    await request(server)
      .put('/api/fees/structures')
      .set(owner)
      .send({ classId: grade.body.id, feeHeadId: head.body.id, academicYearId: year.body.id, amount: 1500 })
      .expect(200);
  });

  it('admits students with real admission dates, an unspecified gender and a birthday today', async () => {
    const dob = `2016-${todayIso.slice(5)}`;
    const a = await request(server)
      .post('/api/students')
      .set(owner)
      .send({ sectionId, firstName: 'Ahmed', gender: 'MALE', dateOfBirth: dob, admittedOn: '2025-04-01', guardians: [{ name: 'Khan', phone: phone(1), relation: 'Father' }] })
      .expect(201);
    ahmed = a.body.id;
    expect(a.body.admittedOn.slice(0, 10)).toBe('2025-04-01');
    const s = await request(server)
      .post('/api/students')
      .set(owner)
      .send({ sectionId, firstName: 'Sara', gender: 'UNSPECIFIED', guardians: [{ name: 'Raza', phone: phone(2), relation: 'Father' }] })
      .expect(201);
    sara = s.body.id;
    expect(s.body.gender).toBe('UNSPECIFIED');
    zara = (
      await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId, firstName: 'Zara', gender: 'FEMALE', guardians: [{ name: 'Zed', phone: phone(4), relation: 'Father' }] })
        .expect(201)
    ).body.id;
    await request(server)
      .post('/api/students')
      .set(owner)
      .send({ sectionId, firstName: 'Future', gender: 'MALE', admittedOn: '2099-01-01', guardians: [{ name: 'Z', phone: phone(3), relation: 'Father' }] })
      .expect(400);
  });

  it('counts new admissions from the real dates and shows the gender split and birthdays', async () => {
    const s = await summary();
    expect(s.newStudentsThisMonth).toBe(2); // Sara and Zara, admitted today; Ahmed was admitted in 2025
    expect(s.genderSplit).toEqual({ male: 1, female: 1, other: 1 });
    expect(s.birthdaysToday.map((b: { name: string }) => b.name)).toEqual(['Ahmed']);
  });

  it('edits dates on a student: leaving needs a reason, keeps the real date and records the balance', async () => {
    await request(server).patch(`/api/students/${ahmed}`).set(owner).send({ admittedOn: '2099-01-01' }).expect(400);
    await request(server).patch(`/api/students/${ahmed}`).set(owner).send({ admittedOn: '2025-05-01' }).expect(200);
    // Bring in an opening balance so the leaving balance is not zero.
    await request(server).post('/api/fees/opening-balance').set(owner).send({ studentId: ahmed, amount: 4200, asOf: '2026-06-30' }).expect(201);

    await request(server).patch(`/api/students/${zara}`).set(owner).send({ status: 'LEFT' }).expect(400);
    await request(server).patch(`/api/students/${zara}`).set(owner).send({ status: 'LEFT', leavingReason: 'Not a reason' }).expect(400);
    const left = await request(server)
      .patch(`/api/students/${ahmed}`)
      .set(owner)
      .send({ status: 'LEFT', leavingReason: 'Migration', leavingRemarks: 'Moved city', leftOn: '2026-10-31' })
      .expect(200);
    expect(left.body).toMatchObject({ status: 'LEFT', leavingReason: 'Migration', leavingBalance: 4200 });
    expect(left.body.leftOn.slice(0, 10)).toBe('2026-10-31');
    await request(server).patch(`/api/students/${ahmed}`).set(owner).send({ leftOn: '2024-01-01' }).expect(400);

    // Ahmed left in October: not a withdrawal this month. Back to active for the rest of the test.
    expect((await summary()).withdrawalsThisMonth).toBe(0);
    await request(server).patch(`/api/students/${ahmed}`).set(owner).send({ status: 'ACTIVE' }).expect(200);
    const back = await request(server).get(`/api/students/${ahmed}`).set(owner).expect(200);
    expect(back.body).toMatchObject({ leftOn: null, leavingReason: null, leavingBalance: null });
  });

  it('filters the directory by leaving reason', async () => {
    await request(server).patch(`/api/students/${zara}`).set(owner).send({ status: 'LEFT', leavingReason: 'Fee Defaulter' }).expect(200);
    const res = await request(server).get('/api/students/directory?status=LEFT&leavingReason=Fee%20Defaulter').set(owner).expect(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Zara']);
    expect((await summary()).withdrawalsThisMonth).toBe(1);
  });

  it('keeps school-specific leaving reasons', async () => {
    const defaults = (await request(server).get('/api/students/leaving-reasons').set(owner).expect(200)).body;
    expect(defaults).toContain('Wrong Entry');
    await request(server).put('/api/students/leaving-reasons').set(owner).send({ reasons: ['Moved abroad', 'Other'] }).expect(200);
    expect((await request(server).get('/api/students/leaving-reasons').set(owner)).body).toEqual(['Moved abroad', 'Other']);
    await request(server).put('/api/students/leaving-reasons').set(owner).send({ reasons: ['a,b'] }).expect(400);
  });

  let voucher: string;
  it('bills a month, back-dates a payment and files it on the real day', async () => {
    await request(server).post('/api/fees/invoices/generate').set(owner).send({ period }).expect(201);
    const list = (await request(server).get(`/api/fees/invoices?period=${period}`).set(owner).expect(200)).body;
    voucher = list.find((i: { studentId: string }) => i.studentId === sara).id;

    await request(server).post(`/api/fees/invoices/${voucher}/payments`).set(owner).send({ amount: 500, method: 'CASH', paidOn: '2099-01-01' }).expect(400);
    const paid = await request(server)
      .post(`/api/fees/invoices/${voucher}/payments`)
      .set(owner)
      .send({ amount: 500, method: 'BANK', paidOn: '2026-06-10' })
      .expect(201);
    expect(paid.body.payment.receivedAt.slice(0, 10)).toBe('2026-06-10');

    // Not collected today, and the receiver can be someone else on the staff.
    expect((await summary()).feesThisMonth.collectedToday).toBe(0);
    const receivers = (await request(server).get('/api/fees/receivers').set(owner).expect(200)).body;
    expect(receivers.length).toBeGreaterThan(0);
    await request(server).post(`/api/fees/invoices/${voucher}/payments`).set(owner).send({ amount: 100, method: 'CASH', receivedById: 'someone-else' }).expect(400);
    await request(server)
      .post(`/api/fees/invoices/${voucher}/payments`)
      .set(owner)
      .send({ amount: 100, method: 'CASH', receivedById: receivers[0].id })
      .expect(201);
    const s = await summary();
    expect(s.feesThisMonth.collectedToday).toBe(100);
    // The fee chart counts cash by the month it was received, so June shows up in the history.
    const june = s.collectionTrend.find((m: { period: string }) => m.period === '2026-06');
    if (june) expect(june.collected).toBe(500);
  });

  it('stores advance credit, nets it off outstanding and uses it on the next voucher', async () => {
    const before = (await summary()).outstanding;
    await request(server).post('/api/fees/credits').set(owner).send({ studentId: sara, amount: 0 }).expect(400);
    await request(server).post('/api/fees/credits').set(owner).send({ studentId: sara, amount: 700, note: 'Advance', effectiveOn: '2026-05-01' }).expect(201);
    const held = (await request(server).get(`/api/fees/credits?studentId=${sara}`).set(owner).expect(200)).body;
    expect(held.balance).toBe(700);
    await request(server).post('/api/fees/credits').set(owner).send({ studentId: sara, amount: -9999 }).expect(400);

    const after = (await summary()).outstanding;
    expect(after.credits).toBe(700);
    expect(after.amount).toBe(Math.max(0, before.gross - 700));
    const perf = (await request(server).get(`/api/students/${sara}/performance`).set(owner).expect(200)).body.feeSummary;
    expect(perf).toMatchObject({ credit: 700, netBalance: perf.balance - 700 });

    // The next month's voucher takes the credit automatically.
    const next = new Date(`${period}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextPeriod = next.toISOString().slice(0, 7);
    await request(server).post('/api/fees/invoices/generate').set(owner).send({ period: nextPeriod }).expect(201);
    const inv = (await request(server).get(`/api/fees/invoices?period=${nextPeriod}`).set(owner).expect(200)).body.find(
      (i: { studentId: string }) => i.studentId === sara,
    );
    expect(inv.total).toBe(800); // 1500 less 700 credit
    expect((await request(server).get(`/api/fees/credits?studentId=${sara}`).set(owner)).body.balance).toBe(0);
  });

  it('reports months owed from the balance, challan status per student, and the fee remark', async () => {
    const s = await summary();
    // Only Sara is enrolled now (Ahmed and Zara left), so one student has a voucher this month.
    expect(s.challans).toMatchObject({ period, total: 1 });
    expect(s.challans.paid + s.challans.partial + s.challans.unpaid).toBe(1);
    // A Rs 4,200 opening balance on one voucher on top of Sara's open months: several months of a Rs 1,500 fee, not "1 month".
    await request(server).post('/api/fees/opening-balance').set(owner).send({ studentId: sara, amount: 4200, asOf: '2026-06-30' }).expect(201);
    const row = (await summary()).topDefaulters.find((d: { name: string }) => d.name === 'Sara');
    expect(row.monthsOwed).toBeGreaterThanOrEqual(3);

    await request(server).put(`/api/fees/students/${ahmed}/remark`).set(owner).send({ remark: 'Father abroad, call uncle' }).expect(200);
  });

  it('records promises to pay and marks them kept when the money arrives', async () => {
    await request(server).post('/api/fees/commitments').set(owner).send({ studentId: sara, amount: 100, promisedOn: '2020-01-01' }).expect(400);
    const made = await request(server)
      .post('/api/fees/commitments')
      .set(owner)
      .send({ studentId: sara, amount: 100, promisedOn: todayIso, note: 'Will pay at pickup' })
      .expect(201);
    const due = (await request(server).get('/api/fees/commitments?due=today').set(owner).expect(200)).body;
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ status: 'PENDING', paid: 0 });
    expect((await summary()).commitments.dueToday).toHaveLength(1);

    const open = (await request(server).get(`/api/fees/invoices?period=${period}`).set(owner)).body.find((i: { studentId: string }) => i.studentId === sara);
    await request(server).post(`/api/fees/invoices/${open.id}/payments`).set(owner).send({ amount: 100, method: 'CASH' }).expect(201);
    const kept = (await request(server).get('/api/fees/commitments?due=today').set(owner)).body;
    expect(kept[0].status).toBe('KEPT');

    await request(server).delete(`/api/fees/commitments/${made.body.id}`).set(owner).expect(200);
    expect((await request(server).get('/api/fees/commitments').set(owner)).body).toEqual([]);

    const defaulters = (await request(server).get('/api/fees/defaulters').set(owner).expect(200)).body;
    expect(Array.isArray(defaulters)).toBe(true);
  });

  it('refuses an adjustment with an unknown field and signs one from its type', async () => {
    const open = (await request(server).get(`/api/fees/invoices?period=${period}`).set(owner)).body.find((i: { studentId: string }) => i.studentId === sara);
    await request(server).post(`/api/fees/invoices/${open.id}/adjustments`).set(owner).send({ amount: 100, kind: 'DISCOUNT', reason: 'Typo' }).expect(400);
    const res = await request(server)
      .post(`/api/fees/invoices/${open.id}/adjustments`)
      .set(owner)
      .send({ amount: 100, type: 'DISCOUNT', reason: 'Scholarship' })
      .expect(201);
    expect(res.body.line.amount).toBe(-100);
  });

  it('lets admins back-date a one-off voucher and rejects impossible years', async () => {
    const body = { lines: [{ description: 'Trip', amount: 300 }] };
    await request(server).post(`/api/fees/students/${sara}/vouchers`).set(owner).send({ ...body, dueDate: '202026-01-01' }).expect(400);
    await request(server).post(`/api/fees/students/${sara}/vouchers`).set(owner).send({ ...body, dueDate: '2026-01-15' }).expect(201);
  });

  it('imports students with an admission date, blank gender and opening balance', async () => {
    const rows = [
      { firstName: 'Imported', gender: '', class: 'Grade 1', section: 'A', admissionDate: '01/04/2024', openingBalance: '-250', guardianName: 'Imp Father', guardianPhone: phone(8) },
    ];
    const res = await request(server).post('/api/students/import').set(owner).send({ rows, commit: true }).expect(201);
    expect(res.body.imported).toBe(1);
    const found = await prisma.student.findFirstOrThrow({ where: { schoolId: (await prisma.school.findFirstOrThrow({ where: { slug: schoolSlug } })).id, firstName: 'Imported' } });
    expect(found.gender).toBe('UNSPECIFIED');
    expect(found.admittedOn.toISOString().slice(0, 10)).toBe('2024-04-01');
    const credit = await prisma.studentCredit.aggregate({ where: { studentId: found.id }, _sum: { amount: true } });
    expect(credit._sum.amount).toBe(250);
  });
  it('keeps student documents and timestamped internal notes', async () => {
    const types = (await request(server).get('/api/students/config/document-types').set(owner).expect(200)).body as string[];
    expect(types.length).toBeGreaterThan(2);
    const pdf = Buffer.from('%PDF-1.4\n%fake b-form\n');
    const file = (await request(server).post('/api/students/files/upload').set(owner).attach('file', pdf, 'bform.pdf').expect(201)).body;
    await request(server).post(`/api/students/${sara}/documents`).set(owner).send({ fileId: file.id, type: 'Made up', title: 'x' }).expect(400);
    await request(server).post(`/api/students/${sara}/documents`).set(owner).send({ fileId: file.id, type: types[0], title: 'B-Form' }).expect(201);
    // the same upload cannot be attached twice
    await request(server).post(`/api/students/${ahmed}/documents`).set(owner).send({ fileId: file.id, type: types[0], title: 'again' }).expect(400);
    const docs = (await request(server).get(`/api/students/${sara}/documents`).set(owner).expect(200)).body;
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('B-Form');
    await request(server).delete(`/api/students/${sara}/documents/${docs[0].id}`).set(owner).expect(200);
    expect((await request(server).get(`/api/students/${sara}/documents`).set(owner)).body).toHaveLength(0);

    await request(server).post(`/api/students/${sara}/notes`).set(owner).send({ body: '  ' }).expect(400);
    const note = (await request(server).post(`/api/students/${sara}/notes`).set(owner).send({ body: 'Father asked for a fee extension' }).expect(201)).body;
    const notes = (await request(server).get(`/api/students/${sara}/notes`).set(owner).expect(200)).body;
    expect(notes[0]).toMatchObject({ id: note.id, body: 'Father asked for a fee extension', by: 'Owner' });
    await request(server).delete(`/api/students/${sara}/notes/${note.id}`).set(owner).expect(200);
  });
});
