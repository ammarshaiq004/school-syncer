import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// QR-scan attendance for students and staff, the end-of-day close and the attendance reports.
describe('QR attendance and reports (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `034${run.slice(-7)}${n}`;
  const today = localToday();
  const past = daysBefore(today, 3);
  const from = daysBefore(today, 4);

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let otherTeacher: Record<string, string>;
  let schoolSlug: string;
  let sectionId: string;
  let ali: { id: string; admissionNo: string };
  let sara: { id: string; admissionNo: string };
  let staffEmployeeNo: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `QR ${run}`, ownerName: 'Owner', email: `qr+${run}@test.pk`, password: 'password123' })
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
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  it('sets up a class with two students and a teacher on the staff register', async () => {
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const year = await request(server)
      .post('/api/academic-years')
      .set(owner)
      .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
      .expect(201);
    const grade = await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 1' }).expect(201);
    const user = (n: number) =>
      request(server)
        .post('/api/users')
        .set(owner)
        .send({ name: `Teacher ${n}`, phone: phone(n), password: 'password123', roles: [{ role: 'TEACHER' }] })
        .expect(201);
    const t1 = await user(1);
    await user(2);
    const section = await request(server)
      .post(`/api/classes/${grade.body.id}/sections`)
      .set(owner)
      .send({ academicYearId: year.body.id, name: 'A', classTeacherId: t1.body.id })
      .expect(201);
    sectionId = section.body.id;
    const student = async (firstName: string) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({ sectionId, firstName, lastName: 'Raza', gender: 'MALE', guardians: [{ name: 'Raza', phone: phone(9), relation: 'Father' }] })
          .expect(201)
      ).body;
    ali = await student('Ali');
    sara = await student('Sara');
    staffEmployeeNo = (
      await request(server).put(`/api/hr/staff/${t1.body.id}`).set(owner).send({ designation: 'Teacher', basicSalary: 20000 }).expect(200)
    ).body.employeeNo;
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));
  });

  it('marks a student from a scanned code, late after the cut-off', async () => {
    await request(server).patch('/api/school').set(owner).send({ attendanceLateAfter: '23:59' }).expect(200);
    const first = await request(server).post('/api/attendance/scan').set(teacher).send({ code: `SS:S:${ali.admissionNo}` }).expect(201);
    expect(first.body).toMatchObject({ kind: 'student', name: 'Ali Raza', detail: 'Grade 1 A', result: 'marked', status: 'PRESENT' });

    // The same card again changes nothing.
    const again = await request(server).post('/api/attendance/scan').set(teacher).send({ code: `SS:S:${ali.admissionNo}` }).expect(201);
    expect(again.body).toMatchObject({ result: 'already', status: 'PRESENT' });

    // Typing the admission number works like scanning it; with a 00:00 cut-off the arrival is late.
    await request(server).patch('/api/school').set(owner).send({ attendanceLateAfter: '00:00' }).expect(200);
    const late = await request(server).post('/api/attendance/scan').set(teacher).send({ code: sara.admissionNo }).expect(201);
    expect(late.body).toMatchObject({ result: 'marked', status: 'LATE' });

    const record = await prisma.attendanceRecord.findFirstOrThrow({ where: { studentId: sara.id } });
    expect(record.scannedAt).not.toBeNull();
    const sheet = await request(server).get(`/api/attendance/sheet?sectionId=${sectionId}&date=${today}`).set(teacher).expect(200);
    expect(sheet.body.students.map((s: { status: string }) => s.status).sort()).toEqual(['LATE', 'PRESENT']);
  });

  it('rejects bad codes, other teachers and a bad cut-off', async () => {
    await request(server).post('/api/attendance/scan').set(teacher).send({ code: 'SS:S:nobody' }).expect(404);
    await request(server).post('/api/attendance/scan').set(teacher).send({ code: 'SS:X:1' }).expect(404);
    await request(server).post('/api/attendance/scan').set(otherTeacher).send({ code: `SS:S:${ali.admissionNo}` }).expect(403);
    await request(server).patch('/api/school').set(owner).send({ attendanceLateAfter: '25:00' }).expect(400);
  });

  it('scans staff for administrators only', async () => {
    // A teacher cannot see the staff register, so their scan finds no one.
    await request(server).post('/api/attendance/scan').set(teacher).send({ code: `SS:E:${staffEmployeeNo}` }).expect(404);
    const res = await request(server).post('/api/attendance/scan').set(owner).send({ code: `SS:E:${staffEmployeeNo}` }).expect(201);
    expect(res.body).toMatchObject({ kind: 'staff', name: 'Teacher 1', detail: 'Teacher', result: 'marked', status: 'LATE' });
  });

  it('marks everyone unscanned absent at close of day', async () => {
    await request(server).post('/api/attendance/scan/close').set(teacher).send({}).expect(403);
    const closed = await request(server).post('/api/attendance/scan/close').set(owner).send({}).expect(201);
    expect(closed.body.studentsMarkedAbsent).toBe(0); // both students scanned
    expect(closed.body.staffMarkedAbsent).toBeGreaterThanOrEqual(2); // owner and the other teacher
    // Closing twice adds nothing.
    const twice = await request(server).post('/api/attendance/scan/close').set(owner).send({}).expect(201);
    expect(twice.body).toMatchObject({ studentsMarkedAbsent: 0, staffMarkedAbsent: 0 });

    // A scan corrects an absent mark made by the close.
    const pastClose = await request(server).post('/api/attendance/scan/close').set(owner).send({ date: past }).expect(201);
    expect(pastClose.body.studentsMarkedAbsent).toBe(2);
  });

  it('lists the day\'s absent, late and leave students', async () => {
    const daily = await request(server).get(`/api/attendance/reports/daily?date=${today}`).set(teacher).expect(200);
    expect(daily.body.rows).toEqual([expect.objectContaining({ name: 'Sara Raza', status: 'LATE', section: 'Grade 1 A' })]);
    const absent = await request(server).get(`/api/attendance/reports/daily?date=${past}&status=ABSENT`).set(owner).expect(200);
    expect(absent.body.total).toBe(2);
    expect((await request(server).get(`/api/attendance/reports/daily?date=${past}`).set(otherTeacher).expect(200)).body.total).toBe(0);
    await request(server).get(`/api/attendance/reports/daily?date=${past}&status=BOGUS`).set(owner).expect(400);
  });

  it('reports a class by date with per-student totals', async () => {
    const res = await request(server)
      .get(`/api/attendance/reports/class?sectionId=${sectionId}&from=${from}&to=${today}`)
      .set(teacher)
      .expect(200);
    expect(res.body.days.map((d: { date: string }) => d.date)).toEqual(expect.arrayContaining([past, today]));
    const saraRow = res.body.students.find((s: { name: string }) => s.name === 'Sara Raza');
    expect(saraRow).toMatchObject({ LATE: 1, ABSENT: 1 });
    await request(server).get(`/api/attendance/reports/class?sectionId=${sectionId}&from=${from}&to=${today}`).set(otherTeacher).expect(403);
    await request(server).get(`/api/attendance/reports/class?sectionId=${sectionId}&from=2025-01-01&to=${today}`).set(owner).expect(400);
  });

  it('reports absent staff and the most absent staff', async () => {
    const staff = await request(server).get(`/api/attendance/reports/staff?date=${past}&status=ABSENT`).set(owner).expect(200);
    expect(staff.body.total).toBeGreaterThanOrEqual(2);
    const ranked = await request(server).get(`/api/attendance/reports/staff-absences?from=${from}&to=${today}&limit=1`).set(owner).expect(200);
    expect(ranked.body.rows).toHaveLength(1);
    expect(ranked.body.rows[0].ABSENT).toBeGreaterThanOrEqual(1);
    await request(server).get(`/api/attendance/reports/staff?date=${past}`).set(teacher).expect(403);
    await request(server).get(`/api/attendance/reports/staff-absences?from=${from}&to=${today}`).set(teacher).expect(403);
  });
});
