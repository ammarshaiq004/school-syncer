import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// SCHOOL-138: requests that arrive together (double clicks, two office PCs)
// must not create, pay or number anything twice, and changes to attendance
// leave a trail.
describe('Data integrity under concurrent requests (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `034${run.slice(-7)}${n}`;

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let schoolSlug: string;
  let schoolId: string;
  let sectionId: string;
  let teacherId: string;
  const students: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Integrity ${run}`, ownerName: 'Owner', email: `integrity+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    schoolId = (await prisma.school.findUniqueOrThrow({ where: { slug: schoolSlug } })).id;

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 3' }).expect(201)
    ).body.id;
    sectionId = (
      await request(server)
        .post(`/api/classes/${classId}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'A' })
        .expect(201)
    ).body.id;
    teacherId = (
      await request(server)
        .post('/api/users')
        .set(owner)
        .send({ name: 'Class Teacher', phone: phone(1), password: 'password123', roles: [{ role: 'TEACHER' }] })
        .expect(201)
    ).body.id;
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login: phone(1), password: 'password123' })
      .expect(200);
    await keepIssuedPassword(app, res.body);
    teacher = { Authorization: `Bearer ${res.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('gives students admitted at the same moment different admission and roll numbers', async () => {
    const admit = (i: number) =>
      request(server)
        .post('/api/students')
        .set(owner)
        .send({
          sectionId,
          firstName: `Child ${i}`,
          gender: 'MALE',
          guardians: [{ name: `Parent ${i}`, phone: `035${run.slice(-7)}${i}`, relation: 'Father' }],
        });
    const created = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(admit));
    expect(created.map((r) => r.status)).toEqual(Array(8).fill(201));
    students.push(...created.map((r) => r.body.id));

    const admissionNos = created.map((r) => r.body.admissionNo as string);
    expect(new Set(admissionNos).size).toBe(8);
    const year = new Date().getFullYear();
    expect(admissionNos.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${year}-000${n}`));
    const rolls = await prisma.enrollment.findMany({ where: { sectionId }, select: { rollNo: true } });
    expect(rolls.map((r) => r.rollNo).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // A typed admission number already in use is refused with a clear message.
    const taken = await request(server)
      .post('/api/students')
      .set(owner)
      .send({
        sectionId,
        admissionNo: `${year}-0003`,
        firstName: 'Duplicate',
        gender: 'FEMALE',
        guardians: [{ name: 'Parent', phone: phone(9), relation: 'Mother' }],
      })
      .expect(409);
    expect(taken.body.message).toContain(`${year}-0003`);
  });

  it('records attendance changes with the old value and who made them', async () => {
    const save = (records: { studentId: string; status: string; note?: string }[]) =>
      request(server).put('/api/attendance/sheet').set(teacher).send({ sectionId, date: '2026-10-06', records });
    // The owner administers the section; make the teacher its class teacher.
    await prisma.section.update({ where: { id: sectionId }, data: { classTeacherId: teacherId } });

    const all = students.map((studentId) => ({ studentId, status: 'PRESENT' }));
    await save(all).expect(200);
    await save(all).expect(200);
    const auditOf = (entity: string) => prisma.auditLog.count({ where: { schoolId, entity } });
    // Taking the register is one compact record; re-saving it unchanged adds nothing.
    expect(await auditOf('AttendanceSession')).toBe(1);
    expect(await auditOf('AttendanceRecord')).toBe(0);

    await request(server)
      .put('/api/attendance/sheet')
      .set(owner)
      .send({ sectionId, date: '2026-10-06', records: [{ studentId: students[0], status: 'LATE', note: 'Bus late' }] })
      .expect(200);
    expect(await auditOf('AttendanceRecord')).toBe(1);

    const history = await request(server)
      .get(`/api/attendance/history?sectionId=${sectionId}&studentId=${students[0]}`)
      .set(teacher)
      .expect(200);
    expect(history.body.history).toEqual([
      expect.objectContaining({
        kind: 'changed',
        date: '2026-10-06',
        studentName: 'Child 0',
        by: 'Owner',
        before: { status: 'PRESENT', note: null },
        after: { status: 'LATE', note: 'Bus late' },
      }),
      expect.objectContaining({ kind: 'taken', by: 'Class Teacher', after: { status: 'PRESENT' } }),
    ]);
    // The whole day's history lists every student's first mark too.
    const day = await request(server)
      .get(`/api/attendance/history?sectionId=${sectionId}&date=2026-10-06`)
      .set(owner)
      .expect(200);
    expect(day.body.history).toHaveLength(9);
  });

  it('creates one payroll run when the month is generated twice at once', async () => {
    await request(server).put(`/api/hr/staff/${teacherId}`).set(owner).send({ designation: 'Teacher', basicSalary: 30000 }).expect(200);
    const generate = () => request(server).post('/api/hr/payroll').set(owner).send({ period: '2026-09' });
    const results = await Promise.all([generate(), generate(), generate(), generate(), generate()]);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);

    const runs = await prisma.payrollRun.findMany({ where: { schoolId, period: '2026-09' }, include: { payslips: true } });
    expect(runs).toHaveLength(1);
    expect(runs[0].payslips).toHaveLength(1);
    expect(runs[0].createdById).toBeTruthy();
    const audits = await prisma.auditLog.findMany({ where: { schoolId, entity: 'PayrollRun', entityId: runs[0].id } });
    expect(audits.filter((a) => a.action === 'create')).toHaveLength(1);
  });

  it('finalises once, then refuses to recalculate or pay a payslip twice', async () => {
    const runId = (await prisma.payrollRun.findFirstOrThrow({ where: { schoolId, period: '2026-09' } })).id;
    const finalise = () => request(server).post(`/api/hr/payroll/${runId}/finalize`).set(owner);
    const finals = await Promise.all([finalise(), finalise()]);
    expect(finals.map((r) => r.status).sort()).toEqual([201, 409]);
    await request(server).post('/api/hr/payroll').set(owner).send({ period: '2026-09' }).expect(409);

    const slip = await prisma.payslip.findFirstOrThrow({ where: { runId } });
    const pay = () => request(server).post(`/api/hr/payroll/${runId}/payslips/${slip.id}/pay`).set(owner).send({ method: 'CASH' });
    const paid = await Promise.all([pay(), pay(), pay()]);
    expect(paid.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    await pay().expect(409);

    const after = await prisma.payslip.findUniqueOrThrow({ where: { id: slip.id } });
    expect(after.paymentMethod).toBe('CASH');
    expect(after.paidById).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { schoolId, entity: 'Payslip', action: 'pay' } })).toBe(1);
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.finalizedById).toBe(after.paidById);
  });
});
