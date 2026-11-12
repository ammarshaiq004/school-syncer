import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// People lists (birthdays, localities, class sheet), payroll history and the monthly fee summary.
describe('People reports (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `030${run.slice(-7)}${n}`;
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const period = todayIso.slice(0, 7);

  let owner: Record<string, string>;
  let schoolSlug: string;
  let sectionId: string;
  let teacherId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `People ${run}`, ownerName: 'Owner', email: `people+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('sets up a class, a locality, students and a fee', async () => {
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const year = await request(server).post('/api/academic-years').set(owner).send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true }).expect(201);
    const grade = await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 1' }).expect(201);
    sectionId = (await request(server).post(`/api/classes/${grade.body.id}/sections`).set(owner).send({ academicYearId: year.body.id, name: 'A' }).expect(201)).body.id;
    const head = await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition', frequency: 'MONTHLY' }).expect(201);
    await request(server).put('/api/fees/structures').set(owner).send({ classId: grade.body.id, feeHeadId: head.body.id, academicYearId: year.body.id, amount: 1500 }).expect(200);
    const area = await request(server).post('/api/front-office/localities').set(owner).send({ name: 'Model Town' }).expect(201);
    await request(server)
      .post('/api/students')
      .set(owner)
      .send({ sectionId, firstName: 'Ahmed', gender: 'MALE', dateOfBirth: `2016-${todayIso.slice(5)}`, localityId: area.body.id, address: 'House 4', guardians: [{ name: 'Khan', phone: phone(1), relation: 'Father' }] })
      .expect(201);
    await request(server).post('/api/students').set(owner).send({ sectionId, firstName: 'Sara', gender: 'FEMALE', guardians: [{ name: 'Raza', phone: phone(2), relation: 'Father' }] }).expect(201);
  });

  it('lists student and staff birthdays for a month', async () => {
    teacherId = (await request(server).post('/api/users').set(owner).send({ name: 'Mr Teacher', phone: phone(3), password: 'password123', roles: [{ role: 'TEACHER' }] }).expect(201)).body.id;
    await request(server).put(`/api/hr/staff/${teacherId}`).set(owner).send({ designation: 'Teacher', basicSalary: 40000, dateOfBirth: `1990-${todayIso.slice(5)}` }).expect(200);
    const res = await request(server).get('/api/reports/people/birthdays').set(owner).expect(200);
    expect(res.body.people.map((p: { name: string; kind: string }) => [p.name, p.kind]).sort()).toEqual([['Ahmed', 'student'], ['Mr Teacher', 'staff']]);
    // Saving the profile again without a date keeps it; null clears it.
    await request(server).put(`/api/hr/staff/${teacherId}`).set(owner).send({ designation: 'Teacher', basicSalary: 40000 }).expect(200);
    expect((await request(server).get('/api/reports/people/birthdays').set(owner)).body.people).toHaveLength(2);
    await request(server).put(`/api/hr/staff/${teacherId}`).set(owner).send({ designation: 'Teacher', basicSalary: 40000, dateOfBirth: null }).expect(200);
    expect((await request(server).get('/api/reports/people/birthdays').set(owner)).body.people).toHaveLength(1);
    await request(server).get('/api/reports/people/birthdays?month=13').set(owner).expect(400);
  });

  it('groups students by locality and lists an area', async () => {
    const all = await request(server).get('/api/reports/people/localities').set(owner).expect(200);
    expect(all.body.localities.map((l: { name: string; total: number }) => [l.name, l.total])).toEqual([['Model Town', 1], ['No locality set', 1]]);
    const areaId = all.body.localities[0].id;
    const one = await request(server).get(`/api/reports/people/localities?localityId=${areaId}`).set(owner).expect(200);
    expect(one.body.students).toEqual([expect.objectContaining({ name: 'Ahmed', guardian: 'Khan (Father)', phone: phone(1), address: 'House 4' })]);
    const none = await request(server).get('/api/reports/people/localities?localityId=none').set(owner).expect(200);
    expect(none.body.students.map((s: { name: string }) => s.name)).toEqual(['Sara']);
  });

  it('prints a class information sheet and keeps it inside the school', async () => {
    const res = await request(server).get(`/api/reports/people/class-info?sectionId=${sectionId}`).set(owner).expect(200);
    expect(res.body.section).toBe('Grade 1 A');
    expect(res.body.students.map((s: { name: string }) => s.name).sort()).toEqual(['Ahmed', 'Sara']);
    expect(res.body.students.find((s: { name: string }) => s.name === 'Ahmed').guardians).toEqual([{ relation: 'Father', name: 'Khan', phone: phone(1) }]);
    await request(server).get('/api/reports/people/class-info?sectionId=nope').set(owner).expect(404);
    await request(server).get('/api/reports/people/class-info').set(owner).expect(400);
  });

  it('summarises fees by month', async () => {
    await request(server).post('/api/fees/invoices/generate').set(owner).send({ period }).expect(201);
    const res = await request(server).get('/api/reports/fees/monthly').set(owner).expect(200);
    expect(res.body.months).toEqual([expect.objectContaining({ period, vouchers: 2, billed: 3000, collected: 0, outstanding: 3000, collectedPct: 0 })]);
    await request(server).get('/api/reports/fees/monthly?from=2026-13').set(owner).expect(400);
  });

  it('shows payroll history for finalised months only', async () => {
    await request(server).put(`/api/hr/staff/${teacherId}`).set(owner).send({ designation: 'Teacher', basicSalary: 40000 }).expect(200);
    const draft = await request(server).post('/api/hr/payroll').set(owner).send({ period: '2026-10' }).expect(201);
    expect((await request(server).get('/api/hr/payroll/history?from=2026-10&to=2026-10').set(owner).expect(200)).body.rows).toEqual([]);
    await request(server).post(`/api/hr/payroll/${draft.body.id}/finalize`).set(owner).expect(201);
    const res = await request(server).get('/api/hr/payroll/history?from=2026-10&to=2026-10').set(owner).expect(200);
    expect(res.body.rows).toEqual([expect.objectContaining({ period: '2026-10', name: 'Mr Teacher', basic: 40000, net: 40000, designation: 'Teacher' })]);
    await request(server).get('/api/hr/payroll/history?from=bad').set(owner).expect(400);
  });
});
