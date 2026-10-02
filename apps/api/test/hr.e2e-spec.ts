import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Staff records, the staff register, leave and a month's payroll.
describe('HR and payroll (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `033${run.slice(-7)}${n}`;

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let accountant: Record<string, string>;
  let schoolSlug: string;
  let teacherId: string;
  let accountantId: string;
  let leaveId: string;
  let runId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `HR ${run}`, ownerName: 'Owner', email: `hr+${run}@test.pk`, password: 'password123' })
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

  it('records salary details for staff', async () => {
    const add = async (n: number, role: string) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name: `Staff ${n}`, phone: phone(n), password: 'password123', roles: [{ role }] })
          .expect(201)
      ).body.id;
    teacherId = await add(1, 'TEACHER');
    accountantId = await add(2, 'ACCOUNTANT');
    teacher = await loginAs(phone(1));
    accountant = await loginAs(phone(2));

    const profile = await request(server)
      .put(`/api/hr/staff/${teacherId}`)
      .set(owner)
      .send({
        designation: 'Senior teacher',
        cnic: '35202-1234567-1',
        basicSalary: 27000,
        payItems: [
          { name: 'House rent', type: 'ALLOWANCE', amount: 5000 },
          { name: 'Provident fund', type: 'DEDUCTION', amount: 1000 },
        ],
      })
      .expect(200);
    expect(profile.body).toMatchObject({ employeeNo: 'EMP-0001', cnic: '3520212345671' });
    expect(profile.body.payItems).toHaveLength(2);
    await request(server)
      .put(`/api/hr/staff/${accountantId}`)
      .set(owner)
      .send({ designation: 'Accountant', basicSalary: 54000 })
      .expect(200);

    await request(server).put(`/api/hr/staff/${teacherId}`).set(accountant).send({ designation: 'X', basicSalary: 1 }).expect(403);
    const staff = await request(server).get('/api/hr/staff').set(accountant).expect(200);
    expect(staff.body).toHaveLength(3);
    await request(server).get('/api/hr/staff').set(teacher).expect(403);
  });

  it('takes the staff register', async () => {
    const sheet = await request(server).get('/api/hr/attendance?date=2026-10-05').set(owner).expect(200);
    expect(sheet.body.staff).toHaveLength(3);
    await request(server)
      .put('/api/hr/attendance')
      .set(owner)
      .send({
        date: '2026-10-05',
        records: [
          { userId: teacherId, status: 'ABSENT' },
          { userId: accountantId, status: 'PRESENT' },
        ],
      })
      .expect(200);
  });

  it('lets staff apply for leave and an admin decide', async () => {
    const leave = await request(server)
      .post('/api/hr/leave')
      .set(teacher)
      .send({ type: 'UNPAID', fromDate: '2026-10-09', toDate: '2026-10-12', reason: 'Family wedding' })
      .expect(201);
    leaveId = leave.body.id;
    await request(server)
      .post('/api/hr/leave')
      .set(teacher)
      .send({ type: 'CASUAL', fromDate: '2026-10-12', toDate: '2026-10-12' })
      .expect(409);

    const own = await request(server).get('/api/hr/leave').set(teacher).expect(200);
    expect(own.body[0]).toMatchObject({ status: 'PENDING', days: 3 });
    expect((await request(server).get('/api/hr/leave').set(accountant).expect(200)).body).toHaveLength(0);

    await request(server).post(`/api/hr/leave/${leaveId}/decide`).set(teacher).send({ approve: true }).expect(403);
    const decided = await request(server).post(`/api/hr/leave/${leaveId}/decide`).set(owner).send({ approve: true }).expect(201);
    expect(decided.body).toEqual({ status: 'APPROVED', days: 3 });
    await request(server).post(`/api/hr/leave/${leaveId}/decide`).set(owner).send({ approve: false }).expect(409);

    const register = await request(server).get('/api/hr/attendance?date=2026-10-10').set(owner).expect(200);
    expect(register.body.staff.find((s: { id: string }) => s.id === teacherId).status).toBe('LEAVE');
  });

  it('runs payroll, deducting unpaid days, and locks it once finalised', async () => {
    await request(server).post('/api/hr/payroll').set(teacher).send({ period: '2026-10' }).expect(403);
    const draft = await request(server).post('/api/hr/payroll').set(accountant).send({ period: '2026-10' }).expect(201);
    runId = draft.body.id;
    expect(draft.body.workingDays).toBe(27);
    const slip = draft.body.payslips.find((p: { userId: string }) => p.userId === teacherId);
    // 1 absent day plus 3 days of unpaid leave, at 27000 / 27 = 1000 a day.
    expect(slip).toMatchObject({ basic: 27000, allowances: 5000, deductions: 1000, unpaidDays: 4, unpaidDeduction: 4000, net: 27000 });
    expect(draft.body.payslips).toHaveLength(2);

    // Staff can't see a draft payslip.
    await request(server).get(`/api/hr/payslips/${slip.id}`).set(teacher).expect(404);
    await request(server).post(`/api/hr/payroll/${runId}/payslips/${slip.id}/pay`).set(accountant).send({}).expect(409);

    // Recalculating picks up a salary change.
    await request(server).put(`/api/hr/staff/${accountantId}`).set(owner).send({ designation: 'Accountant', basicSalary: 60000 }).expect(200);
    const again = await request(server).post('/api/hr/payroll').set(accountant).send({ period: '2026-10' }).expect(201);
    expect(again.body.id).toBe(runId);
    expect(again.body.payslips.find((p: { userId: string }) => p.userId === accountantId).net).toBe(60000);

    await request(server).post(`/api/hr/payroll/${runId}/finalize`).set(accountant).expect(201);
    await request(server).post('/api/hr/payroll').set(accountant).send({ period: '2026-10' }).expect(409);
    const newSlip = again.body.payslips.find((p: { userId: string }) => p.userId === teacherId);
    await request(server).post(`/api/hr/payroll/${runId}/payslips/${newSlip.id}/pay`).set(accountant).send({ method: 'BANK' }).expect(201);
    await request(server).post(`/api/hr/payroll/${runId}/payslips/${newSlip.id}/pay`).set(accountant).send({}).expect(409);

    const mine = await request(server).get('/api/hr/payslips/mine').set(teacher).expect(200);
    expect(mine.body).toHaveLength(1);
    const printable = await request(server).get(`/api/hr/payslips/${newSlip.id}`).set(teacher).expect(200);
    expect(printable.body.user.staffProfile.designation).toBe('Senior teacher');
    const other = again.body.payslips.find((p: { userId: string }) => p.userId === accountantId);
    await request(server).get(`/api/hr/payslips/${other.id}`).set(teacher).expect(404);
  });
});
