import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  NotificationsService,
  type OutgoingMessage,
} from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// One exam from setup to a parent opening the report card.
describe('Exams and report cards (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const sent: OutgoingMessage[] = [];
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `031${run.slice(-7)}${n}`;

  let owner: Record<string, string>;
  let mathsTeacher: Record<string, string>;
  let englishTeacher: Record<string, string>;
  let schoolSlug: string;
  let yearId: string;
  let classId: string;
  let sectionId: string;
  let maths: string;
  let english: string;
  let examId: string;
  const students: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const notifications = app.get(NotificationsService);
    const original = notifications.send.bind(notifications);
    vi.spyOn(notifications, 'send').mockImplementation(
      async (schoolId, messages) => {
        sent.push(...messages);
        return original(schoolId, messages);
      },
    );

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({
        schoolName: `Exams ${run}`,
        ownerName: 'Owner',
        email: `exams+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  async function loginAs(login: string, password = 'password123') {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password })
      .expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  it('sets up a section with a teacher per subject', async () => {
    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id;
    yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({
          name: '2026-27',
          startsOn: '2026-04-01',
          endsOn: '2027-03-31',
          isCurrent: true,
        })
        .expect(201)
    ).body.id;
    classId = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 5' })
        .expect(201)
    ).body.id;
    sectionId = (
      await request(server)
        .post(`/api/classes/${classId}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'A' })
        .expect(201)
    ).body.id;
    maths = (
      await request(server)
        .post('/api/subjects')
        .set(owner)
        .send({ name: 'Maths' })
        .expect(201)
    ).body.id;
    english = (
      await request(server)
        .post('/api/subjects')
        .set(owner)
        .send({ name: 'English' })
        .expect(201)
    ).body.id;

    const teacher = async (n: number) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({
            name: `Teacher ${n}`,
            phone: phone(n),
            password: 'password123',
            roles: [{ role: 'TEACHER' }],
          })
          .expect(201)
      ).body.id;
    const [t1, t2] = [await teacher(1), await teacher(2)];
    const subjects = await request(server)
      .put(`/api/classes/sections/${sectionId}/subjects`)
      .set(owner)
      .send({
        subjects: [
          { subjectId: maths, teacherId: t1 },
          { subjectId: english, teacherId: t2 },
        ],
      })
      .expect(200);
    expect(
      subjects.body.map((s: { subject: { name: string } }) => s.subject.name),
    ).toEqual(['English', 'Maths']);
    mathsTeacher = await loginAs(phone(1));
    englishTeacher = await loginAs(phone(2));

    for (const [i, name] of ['Ayesha', 'Bilal', 'Hamza'].entries()) {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({
          sectionId,
          firstName: name,
          gender: 'FEMALE',
          guardians: [
            { name: 'Parent', phone: phone(5 + i), relation: 'Mother' },
          ],
        })
        .expect(201);
      students.push(res.body.id);
    }
  });

  it('creates an exam with papers', async () => {
    const exam = await request(server)
      .post('/api/exams')
      .set(owner)
      .send({ name: 'Mid-term', academicYearId: yearId, endsOn: '2026-10-20' })
      .expect(201);
    examId = exam.body.id;
    await request(server)
      .post('/api/exams')
      .set(owner)
      .send({ name: 'Mid-term', academicYearId: yearId })
      .expect(409);
    await request(server)
      .post('/api/exams')
      .set(mathsTeacher)
      .send({ name: 'Finals', academicYearId: yearId })
      .expect(403);

    await request(server)
      .put(`/api/exams/${examId}/papers`)
      .set(owner)
      .send({
        papers: [{ classId, subjectId: maths, maxMarks: 50, passMarks: 60 }],
      })
      .expect(400);
    const papers = await request(server)
      .put(`/api/exams/${examId}/papers`)
      .set(owner)
      .send({
        papers: [
          { classId, subjectId: maths, maxMarks: 50, passMarks: 17 },
          { classId, subjectId: english, maxMarks: 100, passMarks: 33 },
        ],
      })
      .expect(200);
    expect(papers.body.papers).toHaveLength(2);
  });

  it('lets each teacher enter marks only for their own subject', async () => {
    const sheet = await request(server)
      .get(
        `/api/exams/${examId}/marks?sectionId=${sectionId}&subjectId=${maths}`,
      )
      .set(mathsTeacher)
      .expect(200);
    expect(sheet.body.students).toHaveLength(3);
    expect(sheet.body.paper.maxMarks).toBe(50);

    await request(server)
      .get(
        `/api/exams/${examId}/marks?sectionId=${sectionId}&subjectId=${maths}`,
      )
      .set(englishTeacher)
      .expect(403);

    const save = (
      headers: Record<string, string>,
      subjectId: string,
      entries: unknown[],
    ) =>
      request(server)
        .put(`/api/exams/${examId}/marks`)
        .set(headers)
        .send({ sectionId, subjectId, entries });

    await save(mathsTeacher, maths, [
      { studentId: students[0], marks: 51 },
    ]).expect(409);
    await save(mathsTeacher, maths, [
      { studentId: students[0], marks: 45 },
      { studentId: students[1], marks: 40 },
      { studentId: students[2], marks: 30 },
    ]).expect(200);
    await save(englishTeacher, english, [
      { studentId: students[0], marks: 90 },
      { studentId: students[1], marks: 92 },
    ]).expect(200);
  });

  it('refuses to publish while marks are missing', async () => {
    const progress = await request(server)
      .get(`/api/exams/${examId}/progress`)
      .set(owner)
      .expect(200);
    expect(
      progress.body.find((p: { subject: string }) => p.subject === 'English'),
    ).toMatchObject({ entered: 2, missing: 1, canEnter: true });

    // Teachers see which sheets are theirs to fill in.
    const mine = await request(server)
      .get(`/api/exams/${examId}/progress`)
      .set(mathsTeacher)
      .expect(200);
    expect(
      mine.body
        .filter((p: { canEnter: boolean }) => p.canEnter)
        .map((p: { subject: string }) => p.subject),
    ).toEqual(['Maths']);

    await request(server)
      .post(`/api/exams/${examId}/publish`)
      .set(owner)
      .send({})
      .expect(409);
  });

  it('publishes results with positions and tells parents', async () => {
    await request(server)
      .put(`/api/exams/${examId}/marks`)
      .set(englishTeacher)
      .send({
        sectionId,
        subjectId: english,
        entries: [{ studentId: students[2], marks: null, isAbsent: true }],
      })
      .expect(200);

    const published = await request(server)
      .post(`/api/exams/${examId}/publish`)
      .set(owner)
      .send({ sendWhatsApp: true })
      .expect(201);
    expect(published.body).toEqual({ published: 3, messagesSent: 3 });
    expect(sent.at(-1)?.template).toBe('exam.result');

    const results = await request(server)
      .get(`/api/exams/${examId}/results?sectionId=${sectionId}`)
      .set(owner)
      .expect(200);
    expect(
      results.body.results.map(
        (r: {
          name: string;
          position: number;
          grade: string;
          passed: boolean;
        }) => [r.name, r.position, r.grade, r.passed],
      ),
    ).toEqual([
      ['Ayesha', 1, 'A+', true],
      ['Bilal', 2, 'A', true],
      ['Hamza', 3, 'F', false],
    ]);

    // Published marks are locked.
    await request(server)
      .put(`/api/exams/${examId}/marks`)
      .set(mathsTeacher)
      .send({
        sectionId,
        subjectId: maths,
        entries: [{ studentId: students[0], marks: 50 }],
      })
      .expect(409);
  });

  it('keeps remarks across an unpublish and republish', async () => {
    await request(server)
      .put(`/api/exams/${examId}/results/${students[0]}/remarks`)
      .set(mathsTeacher)
      .send({ teacherRemark: 'Well done' })
      .expect(403);
    await request(server)
      .put(`/api/exams/${examId}/results/${students[0]}/remarks`)
      .set(owner)
      .send({ teacherRemark: 'Well done', principalRemark: 'Keep it up' })
      .expect(200);

    await request(server)
      .post(`/api/exams/${examId}/unpublish`)
      .set(owner)
      .expect(201);
    await request(server)
      .put(`/api/exams/${examId}/marks`)
      .set(mathsTeacher)
      .send({
        sectionId,
        subjectId: maths,
        entries: [{ studentId: students[0], marks: 50 }],
      })
      .expect(200);
    await request(server)
      .post(`/api/exams/${examId}/publish`)
      .set(owner)
      .send({})
      .expect(201);

    const card = await request(server)
      .get(`/api/exams/${examId}/report-cards/${students[0]}`)
      .set(owner)
      .expect(200);
    expect(card.body).toMatchObject({
      obtained: 140,
      maxTotal: 150,
      percent: 93.33,
      grade: 'A+',
      position: 1,
      outOf: 3,
      teacherRemark: 'Well done',
      principalRemark: 'Keep it up',
    });
    expect(
      card.body.subjects.map((s: { subject: string; marks: number }) => [
        s.subject,
        s.marks,
      ]),
    ).toEqual([
      ['English', 90],
      ['Maths', 50],
    ]);
  });

  it("shows parents their own child's report card and nobody else's", async () => {
    const student = await request(server)
      .get(`/api/students/${students[0]}`)
      .set(owner);
    const guardianId = student.body.guardians[0].guardianId;
    await request(server)
      .post(`/api/students/${students[0]}/guardians/${guardianId}/invite`)
      .set(owner)
      .expect(201);
    const password = sent.filter((m) => m.template === 'parent.invite').at(-1)!
      .params.password;
    const parent = await loginAs(phone(5), password);

    const children = await request(server)
      .get('/api/parent/children')
      .set(parent)
      .expect(200);
    expect(children.body[0].results[0]).toMatchObject({
      exam: 'Mid-term',
      grade: 'A+',
      position: 1,
    });

    await request(server)
      .get(`/api/exams/${examId}/report-cards/${students[0]}`)
      .set(parent)
      .expect(200);
    await request(server)
      .get(`/api/exams/${examId}/report-cards/${students[1]}`)
      .set(parent)
      .expect(404);
    await request(server)
      .get(`/api/exams/${examId}/results?sectionId=${sectionId}`)
      .set(parent)
      .expect(403);
  });
});
