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
import { keepIssuedPassword } from './session.js';

// CV bank, staff import, experience certificates and payroll rules for lates and short leave.
describe('HR recruitment and payroll rules (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const storageDir = mkdtempSync(join(tmpdir(), 'hr-cv-'));
  const phone = (n: number) => `034${run.slice(-7)}${n}`;

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let schoolSlug: string;
  let teacherId: string;

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
      .send({ schoolName: `HR2 ${run}`, ownerName: 'Owner', email: `hr2+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    teacherId = (
      await request(server)
        .post('/api/users')
        .set(owner)
        .send({ name: 'Rule Teacher', phone: phone(1), password: 'password123', roles: [{ role: 'TEACHER' }] })
        .expect(201)
    ).body.id;
    const login = await request(server).post('/api/auth/login').send({ schoolSlug, login: phone(1), password: 'password123' }).expect(200);
    await keepIssuedPassword(app, login.body);
    teacher = { Authorization: `Bearer ${login.body.accessToken}` };
    await request(server)
      .put(`/api/hr/staff/${teacherId}`)
      .set(owner)
      .send({ designation: 'Maths teacher', joinedOn: '2022-04-01', basicSalary: 27000 })
      .expect(200);
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('keeps candidates and their CVs in the CV bank', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%fake cv\n');
    await request(server).post('/api/hr/candidates/cv').set(teacher).attach('file', pdf, 'cv.pdf').expect(403);
    await request(server).post('/api/hr/candidates/cv').set(owner).attach('file', Buffer.from('MZ not a pdf'), 'cv.pdf').expect(400);
    const cv = (await request(server).post('/api/hr/candidates/cv').set(owner).attach('file', pdf, 'cv.pdf').expect(201)).body;

    const created = await request(server)
      .post('/api/hr/candidates')
      .set(owner)
      .send({ name: 'Sana Iqbal', phone: '0301 5551234', position: 'Science teacher', qualification: 'MSc Physics', experienceYears: 4, expectedSalary: 45000, cvId: cv.id })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'NEW', phone: '03015551234' });
    expect(created.body.cv.url).toBeTruthy();
    await request(server).post('/api/hr/candidates').set(owner).send({ name: 'Zeeshan', position: 'Clerk', cvId: cv.id }).expect(400);

    await request(server).post('/api/hr/candidates').set(owner).send({ name: 'Omar Farooq', position: 'Maths teacher', status: 'SHORTLISTED' }).expect(201);
    expect((await request(server).get('/api/hr/candidates?search=physics').set(owner).expect(200)).body).toHaveLength(1);
    expect((await request(server).get('/api/hr/candidates?status=SHORTLISTED').set(owner).expect(200)).body).toHaveLength(1);
    expect((await request(server).get('/api/hr/candidates').set(owner).expect(200)).body).toHaveLength(2);
    await request(server).get('/api/hr/candidates').set(teacher).expect(403);

    const id = created.body.id;
    const moved = await request(server)
      .put(`/api/hr/candidates/${id}`)
      .set(owner)
      .send({ name: 'Sana Iqbal', position: 'Science teacher', status: 'OFFERED', cvId: cv.id })
      .expect(200);
    expect(moved.body.status).toBe('OFFERED');
    expect(moved.body.cv.id).toBe(cv.id);
    await request(server).put(`/api/hr/candidates/${id}`).set(owner).send({ name: 'Sana Iqbal', position: 'Science teacher', cvId: null }).expect(200);
    expect(await prisma.storedFile.count({ where: { id: cv.id } })).toBe(0);
    await request(server).delete(`/api/hr/candidates/${id}`).set(owner).expect(200);
    expect((await request(server).get('/api/hr/candidates').set(owner).expect(200)).body).toHaveLength(1);
  });

  it('imports staff from a sheet, all or nothing', async () => {
    const good = { name: 'Hina Raza', designation: 'English teacher', phone: phone(2), basicSalary: '32,000', joinedOn: '01/08/2023', role: 'Class Teacher' };
    const bad = { name: 'No Contact', designation: 'Clerk' };
    const check = await request(server).post('/api/hr/staff/import').set(owner).send({ rows: [good, bad], commit: true }).expect(201);
    expect(check.body).toMatchObject({ valid: 1, invalid: 1, imported: 0 });
    expect(check.body.rows[1].errors).toContain('Give an email or a phone number');

    await request(server).post('/api/hr/staff/import').set(teacher).send({ rows: [good] }).expect(403);
    const done = await request(server)
      .post('/api/hr/staff/import')
      .set(owner)
      .send({ rows: [good, { ...good, name: 'Imran Ali', phone: '', email: `imran+${run}@test.pk`, role: '' }], commit: true })
      .expect(201);
    // The second row repeats the first row's phone only if phone is kept; here it has an email instead.
    expect(done.body.imported).toBe(2);
    expect(done.body.logins.map((l: { employeeNo: string }) => l.employeeNo)).toEqual(['EMP-0002', 'EMP-0003']);

    const login = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login: phone(2), password: done.body.logins[0].temporaryPassword })
      .expect(200);
    expect(login.body.user.name).toBe('Hina Raza');
    const again = await request(server).post('/api/hr/staff/import').set(owner).send({ rows: [good], commit: true }).expect(201);
    expect(again.body.invalid).toBe(1);
    const staff = (await request(server).get('/api/hr/staff').set(owner).expect(200)).body;
    expect(staff.find((s: { name: string }) => s.name === 'Hina Raza').staffProfile).toMatchObject({ basicSalary: 32000, designation: 'English teacher' });
  });

  it('issues, verifies and cancels an experience certificate', async () => {
    await request(server).post('/api/hr/experience-certificates').set(teacher).send({ userId: teacherId }).expect(403);
    const issued = await request(server)
      .post('/api/hr/experience-certificates')
      .set(owner)
      .send({ userId: teacherId, leftOn: '2026-06-30', conduct: 'Excellent', issuedOn: '2026-07-05' })
      .expect(201);
    expect(issued.body.serialNo).toBe('EXP-2026-0001');
    expect(issued.body.details).toMatchObject({ staffName: 'Rule Teacher', designation: 'Maths teacher', joinedOn: '2022-04-01', leftOn: '2026-06-30' });
    await request(server).post('/api/hr/experience-certificates').set(owner).send({ userId: teacherId, leftOn: '2021-01-01' }).expect(409);

    const second = await request(server).post('/api/hr/experience-certificates').set(owner).send({ userId: teacherId, issuedOn: '2026-07-06' }).expect(201);
    expect(second.body.serialNo).toBe('EXP-2026-0002');

    const check = await request(server).get(`/api/verify/${issued.body.verifyCode}`).expect(200);
    expect(check.body).toMatchObject({ found: true, valid: true, type: 'EXPERIENCE', staffName: 'Rule Teacher', leftOn: '2026-06-30' });

    await request(server).post(`/api/hr/experience-certificates/${issued.body.id}/cancel`).set(owner).send({ reason: 'Wrong date' }).expect(201);
    await request(server).post(`/api/hr/experience-certificates/${issued.body.id}/cancel`).set(owner).send({ reason: 'Again' }).expect(409);
    expect((await request(server).get(`/api/verify/${issued.body.verifyCode}`).expect(200)).body.valid).toBe(false);
    expect((await request(server).get('/api/hr/experience-certificates').set(owner).expect(200)).body).toHaveLength(2);
  });

  it('takes late arrivals and short leaves off the month’s pay', async () => {
    const defaults = await request(server).get('/api/hr/payroll-rules').set(owner).expect(200);
    expect(defaults.body).toMatchObject({ shiftStart: '08:00', graceMinutes: 10, latesPerDeduction: 3, freeShortLeaves: 2 });
    await request(server).put('/api/hr/payroll-rules').set(teacher).send(defaults.body).expect(403);
    await request(server).put('/api/hr/payroll-rules').set(owner).send({ ...defaults.body, shiftStart: '8am' }).expect(400);

    // Two late by arrival time, one marked Late, one on time inside the grace period.
    const mark = (date: string, status: string, checkIn?: string) =>
      request(server).put('/api/hr/attendance').set(owner).send({ date, records: [{ userId: teacherId, status, checkIn }] }).expect(200);
    await mark('2026-09-01', 'PRESENT', '08:30');
    await mark('2026-09-02', 'PRESENT', '08:45');
    await mark('2026-09-03', 'LATE');
    await mark('2026-09-04', 'PRESENT', '08:10');
    const sheet = await request(server).get('/api/hr/attendance?date=2026-09-01').set(owner).expect(200);
    expect(sheet.body.staff.find((s: { id: string }) => s.id === teacherId).checkIn).toBe('08:30');

    const shortLeave = async (date: string, from: string, to: string) =>
      (await request(server).post('/api/hr/short-leave').set(teacher).send({ date, fromTime: from, toTime: to }).expect(201)).body.id as string;
    const ids = [
      await shortLeave('2026-09-07', '11:00', '13:00'),
      await shortLeave('2026-09-08', '11:00', '13:00'),
      await shortLeave('2026-09-09', '11:00', '13:00'),
    ];
    await request(server).post('/api/hr/short-leave').set(teacher).send({ date: '2026-09-09', fromTime: '12:00', toTime: '14:00' }).expect(409);
    await request(server).post('/api/hr/short-leave').set(teacher).send({ date: '2026-09-10', fromTime: '13:00', toTime: '11:00' }).expect(400);
    await request(server).post(`/api/hr/short-leave/${ids[0]}/decide`).set(teacher).send({ approve: true }).expect(403);
    for (const id of ids) await request(server).post(`/api/hr/short-leave/${id}/decide`).set(owner).send({ approve: true }).expect(201);
    await request(server).post(`/api/hr/short-leave/${ids[0]}/decide`).set(owner).send({ approve: true }).expect(409);
    expect((await request(server).get('/api/hr/short-leave').set(teacher).expect(200)).body).toHaveLength(3);

    // September 2026 has 26 working days: 27000 / 26 = 1038.46 a day.
    const draft = await request(server).post('/api/hr/payroll').set(owner).send({ period: '2026-09' }).expect(201);
    const slip = draft.body.payslips.find((p: { userId: string }) => p.userId === teacherId);
    // 3 lates -> one day (1038); 3 short leaves, 2 free -> half a day (519).
    expect(slip).toMatchObject({ lateDeduction: 1038, shortLeaveDeduction: 519, net: 27000 - 1038 - 519 });
    expect(slip.lines.map((l: { name: string }) => l.name)).toEqual(
      expect.arrayContaining(['Late arrivals (3 late, 1 deducted)', 'Short leaves (3, 1 over the free limit)']),
    );

    // Stricter rules and a recalculation.
    await request(server).put('/api/hr/payroll-rules').set(owner).send({ ...defaults.body, latesPerDeduction: 0, freeShortLeaves: 3 }).expect(200);
    const redo = await request(server).post('/api/hr/payroll').set(owner).send({ period: '2026-09' }).expect(201);
    expect(redo.body.payslips.find((p: { userId: string }) => p.userId === teacherId)).toMatchObject({ lateDeduction: 0, shortLeaveDeduction: 0, net: 27000 });
  });
});
