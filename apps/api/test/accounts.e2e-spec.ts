import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Fees, salaries and other entries meeting in the cash book and reports.
describe('Accounts and reports (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `034${run.slice(-7)}${n}`;
  const today = localToday();
  const period = today.slice(0, 7);

  let owner: Record<string, string>;
  let accountant: Record<string, string>;
  let teacher: Record<string, string>;
  let schoolSlug: string;
  let sectionId: string;
  let utilities: string;
  let canteen: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Accounts ${run}`, ownerName: 'Owner', email: `acc+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  async function loginAs(login: string) {
    const res = await request(server).post('/api/auth/login').send({ schoolSlug, login, password: 'password123' }).expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  it('collects a fee and pays a salary', async () => {
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 2' }).expect(201)).body.id;
    sectionId = (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
    for (const [i, name] of ['Ali', 'Sana'].entries()) {
      await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId, firstName: name, gender: 'MALE', guardians: [{ name: 'Parent', phone: phone(5 + i), relation: 'Father' }] })
        .expect(201);
    }
    const head = await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition' }).expect(201);
    await request(server)
      .put('/api/fees/structures')
      .set(owner)
      .send({ classId, feeHeadId: head.body.id, academicYearId: yearId, amount: 3000 })
      .expect(200);
    await request(server).post('/api/fees/invoices/generate').set(owner).send({ period }).expect(201);
    const invoices = await request(server).get(`/api/fees/invoices?period=${period}`).set(owner).expect(200);
    await request(server).post(`/api/fees/invoices/${invoices.body[0].id}/payments`).set(owner).send({ amount: 3000, method: 'CASH' }).expect(201);

    const accId = (
      await request(server)
        .post('/api/users')
        .set(owner)
        .send({ name: 'Accountant', phone: phone(1), password: 'password123', roles: [{ role: 'ACCOUNTANT' }] })
        .expect(201)
    ).body.id;
    await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: 'Teacher', phone: phone(2), password: 'password123', roles: [{ role: 'TEACHER' }] })
      .expect(201);
    accountant = await loginAs(phone(1));
    teacher = await loginAs(phone(2));
    await request(server).put(`/api/hr/staff/${accId}`).set(owner).send({ designation: 'Accountant', basicSalary: 2000 }).expect(200);
    const payroll = await request(server).post('/api/hr/payroll').set(accountant).send({ period }).expect(201);
    await request(server).post(`/api/hr/payroll/${payroll.body.id}/finalize`).set(accountant).expect(201);
    await request(server).post(`/api/hr/payroll/${payroll.body.id}/payslips/${payroll.body.payslips[0].id}/pay`).set(accountant).send({ method: 'CASH' }).expect(201);
  });

  it('records other income and expenses', async () => {
    utilities = (await request(server).post('/api/accounts/categories').set(accountant).send({ name: 'Utilities', kind: 'EXPENSE' }).expect(201)).body.id;
    canteen = (await request(server).post('/api/accounts/categories').set(accountant).send({ name: 'Canteen rent', kind: 'INCOME' }).expect(201)).body.id;
    await request(server).post('/api/accounts/categories').set(accountant).send({ name: 'Utilities', kind: 'EXPENSE' }).expect(409);
    await request(server).get('/api/accounts/categories').set(teacher).expect(403);

    // Before the period: becomes the opening balance.
    await request(server)
      .post('/api/accounts/entries')
      .set(accountant)
      .send({ categoryId: canteen, amount: 10000, date: daysBefore(today, 40), party: 'Canteen' })
      .expect(201);
    await request(server).post('/api/accounts/entries').set(accountant).send({ categoryId: utilities, amount: 700, date: today, party: 'LESCO', method: 'BANK' }).expect(201);
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await request(server)
      .post('/api/accounts/entries')
      .set(accountant)
      .send({ categoryId: utilities, amount: 1, date: tomorrow.toISOString().slice(0, 10) })
      .expect(409);
  });

  it('balances the cash book', async () => {
    const from = daysBefore(today, 20);
    const book = await request(server).get(`/api/accounts/cashbook?from=${from}&to=${today}`).set(accountant).expect(200);
    expect(book.body).toMatchObject({ opening: 10000, totalIn: 3000, totalOut: 2700, closing: 10300 });
    expect(book.body.rows.map((r: { source: string }) => r.source).sort()).toEqual(['ENTRY', 'FEES', 'SALARY']);
    expect(book.body.rows.at(-1).balance).toBe(10300);
    await request(server).get(`/api/accounts/cashbook?from=${today}&to=${from}`).set(accountant).expect(400);
  });

  it('reports income and expenditure, collections and outstanding fees', async () => {
    const from = daysBefore(today, 20);
    const ie = await request(server).get(`/api/reports/income-expense?from=${from}&to=${today}`).set(accountant).expect(200);
    expect(ie.body).toMatchObject({ totalIncome: 3000, totalExpenses: 2700, surplus: 300 });
    expect(ie.body.expenses).toEqual([
      { name: 'Salaries', total: 2000 },
      { name: 'Utilities', total: 700 },
    ]);

    const fees = await request(server).get('/api/reports/fee-collection').set(accountant).expect(200);
    expect(fees.body).toMatchObject({ total: 3000, receipts: 1, byMethod: [{ name: 'CASH', total: 3000 }], byClass: [{ name: 'Grade 2 A', total: 3000 }] });

    const owed = await request(server).get('/api/reports/outstanding').set(accountant).expect(200);
    expect(owed.body.total).toBe(3000);
    expect(owed.body.students).toHaveLength(1);
  });

  it('reports attendance below the threshold', async () => {
    const sheet = await request(server).get(`/api/attendance/sheet?sectionId=${sectionId}&date=${today}`).set(owner).expect(200);
    await request(server)
      .put('/api/attendance/sheet')
      .set(owner)
      .send({
        sectionId,
        date: today,
        records: sheet.body.students.map((s: { id: string }, i: number) => ({ studentId: s.id, status: i === 0 ? 'ABSENT' : 'PRESENT' })),
      })
      .expect(200);
    const report = await request(server).get(`/api/reports/attendance?month=${period}`).set(owner).expect(200);
    expect(report.body.sections[0]).toMatchObject({ name: 'Grade 2 A', days: 1, percent: 50 });
    expect(report.body.lowAttendance).toHaveLength(1);
    await request(server).get(`/api/reports/attendance?month=${period}`).set(accountant).expect(403);
  });
});
