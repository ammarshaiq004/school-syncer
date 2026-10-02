import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { NotificationsService, type OutgoingMessage } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Bell schedule, section timetables with clash checks, and homework through to parents.
describe('Timetable and homework (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const sent: OutgoingMessage[] = [];
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `032${run.slice(-7)}${n}`;

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let otherTeacher: Record<string, string>;
  let schoolSlug: string;
  let campusId: string;
  let sectionA: string;
  let sectionB: string;
  let maths: string;
  let english: string;
  let teacherId: string;
  let studentId: string;
  let periods: { id: string; name: string; isBreak: boolean }[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const notifications = app.get(NotificationsService);
    const original = notifications.send.bind(notifications);
    vi.spyOn(notifications, 'send').mockImplementation(async (schoolId, messages) => {
      sent.push(...messages);
      return original(schoolId, messages);
    });

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Timetable ${run}`, ownerName: 'Owner', email: `tt+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  async function loginAs(login: string, password = 'password123') {
    const res = await request(server).post('/api/auth/login').send({ schoolSlug, login, password }).expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  it('sets up two sections sharing a maths teacher', async () => {
    campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 4' }).expect(201)).body.id;
    const section = async (name: string) =>
      (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name }).expect(201)).body.id;
    sectionA = await section('A');
    sectionB = await section('B');
    maths = (await request(server).post('/api/subjects').set(owner).send({ name: 'Maths' }).expect(201)).body.id;
    english = (await request(server).post('/api/subjects').set(owner).send({ name: 'English' }).expect(201)).body.id;
    const makeTeacher = async (n: number) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name: `Teacher ${n}`, phone: phone(n), password: 'password123', roles: [{ role: 'TEACHER' }] })
          .expect(201)
      ).body.id;
    teacherId = await makeTeacher(1);
    await makeTeacher(2);
    for (const s of [sectionA, sectionB]) {
      await request(server)
        .put(`/api/classes/sections/${s}/subjects`)
        .set(owner)
        .send({ subjects: [{ subjectId: maths, teacherId }, { subjectId: english }] })
        .expect(200);
    }
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));
    studentId = (
      await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId: sectionA, firstName: 'Zara', gender: 'FEMALE', guardians: [{ name: 'Mother', phone: phone(5), relation: 'Mother' }] })
        .expect(201)
    ).body.id;
  });

  it('saves a bell schedule in time order and rejects overlaps', async () => {
    await request(server)
      .put('/api/timetable/periods')
      .set(owner)
      .send({
        campusId,
        periods: [
          { name: 'Period 1', startTime: '08:00', endTime: '08:45' },
          { name: 'Period 2', startTime: '08:30', endTime: '09:15' },
        ],
      })
      .expect(409);
    const res = await request(server)
      .put('/api/timetable/periods')
      .set(owner)
      .send({
        campusId,
        periods: [
          { name: 'Break', startTime: '08:45', endTime: '09:05', isBreak: true },
          { name: 'Period 1', startTime: '08:00', endTime: '08:45' },
          { name: 'Period 2', startTime: '09:05', endTime: '09:50' },
        ],
      })
      .expect(200);
    periods = res.body;
    expect(periods.map((p) => p.name)).toEqual(['Period 1', 'Break', 'Period 2']);
    await request(server).put('/api/timetable/periods').set(teacher).send({ campusId, periods: [] }).expect(403);
  });

  it('builds section timetables, filling in the subject teacher and refusing clashes', async () => {
    const [p1, brk, p2] = periods;
    const a = await request(server)
      .put(`/api/timetable/sections/${sectionA}`)
      .set(owner)
      .send({
        slots: [
          { dayOfWeek: 1, periodId: p1.id, subjectId: maths },
          { dayOfWeek: 1, periodId: p2.id, subjectId: english, room: 'Lab' },
        ],
      })
      .expect(200);
    expect(a.body.slots.find((s: { subject: string }) => s.subject === 'Maths').teacher).toBe('Teacher 1');

    await request(server)
      .put(`/api/timetable/sections/${sectionA}`)
      .set(owner)
      .send({ slots: [{ dayOfWeek: 1, periodId: brk.id, subjectId: maths }] })
      .expect(409);

    // Teacher 1 is already in section A for Monday period 1.
    const clash = await request(server)
      .put(`/api/timetable/sections/${sectionB}`)
      .set(owner)
      .send({ slots: [{ dayOfWeek: 1, periodId: p1.id, subjectId: maths }] })
      .expect(409);
    expect(clash.body.message).toContain('already teaches Grade 4 A');

    await request(server)
      .put(`/api/timetable/sections/${sectionB}`)
      .set(owner)
      .send({ slots: [{ dayOfWeek: 1, periodId: p2.id, subjectId: maths }] })
      .expect(200);

    const mine = await request(server).get('/api/timetable/me').set(teacher).expect(200);
    expect(mine.body.map((s: { section: string; period: string }) => `${s.section} ${s.period}`)).toEqual([
      'Grade 4 A Period 1',
      'Grade 4 B Period 2',
    ]);

    // A period in use cannot be dropped from the bell schedule.
    await request(server)
      .put('/api/timetable/periods')
      .set(owner)
      .send({ campusId, periods: [{ id: p1.id, name: 'Period 1', startTime: '08:00', endTime: '08:45' }] })
      .expect(409);
  });

  it('lets the subject teacher set homework and tells parents', async () => {
    await request(server)
      .post('/api/homework')
      .set(otherTeacher)
      .send({ sectionId: sectionA, subjectId: maths, title: 'Exercise 4.2', dueDate: localToday() })
      .expect(403);
    const created = await request(server)
      .post('/api/homework')
      .set(teacher)
      .send({ sectionId: sectionA, subjectId: maths, title: 'Exercise 4.2', details: 'Questions 1 to 10', dueDate: localToday(), sendWhatsApp: true })
      .expect(201);
    expect(created.body.messagesSent).toBe(1);
    expect(sent.at(-1)).toMatchObject({ template: 'homework.assigned', params: { title: 'Exercise 4.2', className: 'Grade 4 A' } });

    await request(server)
      .post('/api/homework')
      .set(teacher)
      .send({ sectionId: sectionA, subjectId: maths, title: 'Too late', dueDate: '2020-01-01' })
      .expect(403);

    const list = await request(server).get(`/api/homework?sectionId=${sectionA}`).set(owner).expect(200);
    expect(list.body).toHaveLength(1);
    await request(server).delete(`/api/homework/${created.body.id}`).set(otherTeacher).expect(403);
  });

  it("shows a parent their child's homework and timetable", async () => {
    const student = await request(server).get(`/api/students/${studentId}`).set(owner);
    await request(server)
      .post(`/api/students/${studentId}/guardians/${student.body.guardians[0].guardianId}/invite`)
      .set(owner)
      .expect(201);
    const password = sent.find((m) => m.template === 'parent.invite')!.params.password;
    const parent = await loginAs(phone(5), password);

    const children = await request(server).get('/api/parent/children').set(parent).expect(200);
    expect(children.body[0].homework[0]).toMatchObject({ subject: 'Maths', title: 'Exercise 4.2' });

    const week = await request(server).get(`/api/timetable/students/${studentId}`).set(parent).expect(200);
    expect(week.body.slots).toHaveLength(2);
    await request(server).get(`/api/timetable/sections/${sectionA}`).set(parent).expect(403);
  });
});
