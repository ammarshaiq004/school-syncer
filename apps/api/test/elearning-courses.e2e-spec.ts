import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

// Course builder (staff) and the student course player, with teacher scoping and tenant isolation.
describe('E-school courses (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const slugs: string[] = [];
  const phone = (n: number) => `035${run.slice(-7)}${n}`;

  let owner: Headers;
  let teacher: Headers;
  let otherTeacher: Headers;
  let accountant: Headers;
  let studentA: Headers;
  let studentB: Headers;
  let rivalOwner: Headers;
  let schoolSlug: string;
  let sectionA: string;
  let sectionB: string;
  let maths: string;
  let english: string;
  let teacherId: string;
  let ayeshaId: string;

  let courseId: string;
  let unit1: string;
  let unit2: string;
  let videoLesson: string;
  let textLesson: string;
  let draftLesson: string;

  async function register(name: string, email: string) {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return reg.body as { schoolSlug: string; accessToken: string; user: { schoolId: string } };
  }

  async function loginAs(login: string) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password: 'password123' })
      .expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  /** Student logins are made by another endpoint; here the STUDENT user is created directly. */
  async function studentLogin(schoolId: string, studentId: string, name: string) {
    const user = await prisma.user.create({
      data: { schoolId, name, username: `s${run}${studentId.slice(-4)}`, roles: { create: { role: 'STUDENT' } } },
    });
    await prisma.student.update({ where: { id: studentId }, data: { userId: user.id } });
    const token = app.get(JwtService).sign({
      sub: user.id,
      schoolId,
      name,
      roles: [{ role: 'STUDENT', campusId: null, customRoleId: null }],
    });
    return { Authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await register(`Courses ${run}`, `courses+${run}@test.pk`);
    schoolSlug = reg.schoolSlug;
    const schoolId = reg.user.schoolId;
    owner = { Authorization: `Bearer ${reg.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 7' }).expect(201)
    ).body.id;
    const section = async (name: string) =>
      (
        await request(server)
          .post(`/api/classes/${classId}/sections`)
          .set(owner)
          .send({ academicYearId: yearId, name })
          .expect(201)
      ).body.id as string;
    sectionA = await section('A');
    sectionB = await section('B');
    maths = (await request(server).post('/api/subjects').set(owner).send({ name: 'Maths' }).expect(201)).body.id;
    english = (await request(server).post('/api/subjects').set(owner).send({ name: 'English' }).expect(201)).body.id;
    const makeUser = async (n: number, role: string) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name: `Staff ${n}`, phone: phone(n), password: 'password123', roles: [{ role }] })
          .expect(201)
      ).body.id as string;
    teacherId = await makeUser(1, 'TEACHER');
    await makeUser(2, 'TEACHER');
    await makeUser(3, 'ACCOUNTANT');
    for (const s of [sectionA, sectionB]) {
      await request(server)
        .put(`/api/classes/sections/${s}/subjects`)
        .set(owner)
        .send({ subjects: [{ subjectId: maths, teacherId: s === sectionA ? teacherId : undefined }, { subjectId: english }] })
        .expect(200);
    }
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));
    accountant = await loginAs(phone(3));

    const addStudent = async (sectionId: string, firstName: string, n: number) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId,
            firstName,
            gender: 'FEMALE',
            guardians: [{ name: 'Mother', phone: phone(n), relation: 'Mother' }],
          })
          .expect(201)
      ).body.id as string;
    ayeshaId = await addStudent(sectionA, 'Ayesha', 5);
    await addStudent(sectionA, 'Hina', 6);
    const bilalId = await addStudent(sectionB, 'Bilal', 7);
    studentA = await studentLogin(schoolId, ayeshaId, 'Ayesha');
    studentB = await studentLogin(schoolId, bilalId, 'Bilal');

    const rival = await register(`Rival ${run}`, `rival+${run}@test.pk`);
    rivalOwner = { Authorization: `Bearer ${rival.accessToken}` };
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  it('lets a teacher create a course only for a subject they teach', async () => {
    const created = await request(server)
      .post('/api/elearning/courses')
      .set(teacher)
      .send({ sectionId: sectionA, subjectId: maths, description: 'Fractions, decimals and ratios' })
      .expect(201);
    courseId = created.body.id;
    expect(created.body).toMatchObject({
      title: 'Maths',
      teacher: { id: teacherId },
      isPublished: false,
      subject: { id: maths },
    });

    await request(server)
      .post('/api/elearning/courses')
      .set(teacher)
      .send({ sectionId: sectionA, subjectId: english })
      .expect(403);
    await request(server)
      .post('/api/elearning/courses')
      .set(otherTeacher)
      .send({ sectionId: sectionA, subjectId: maths })
      .expect(403);
    await request(server)
      .post('/api/elearning/courses')
      .set(teacher)
      .send({ sectionId: sectionA, subjectId: maths, teacherId })
      .expect(403);
    await request(server)
      .post('/api/elearning/courses')
      .set(owner)
      .send({ sectionId: sectionA, subjectId: maths })
      .expect(409);
  });

  it('generates the missing courses for a section once', async () => {
    const first = await request(server)
      .post('/api/elearning/courses/generate')
      .set(owner)
      .send({ sectionId: sectionA })
      .expect(201);
    expect(first.body.created).toBe(1);
    expect(first.body.courses[0]).toMatchObject({ title: 'English', teacher: null });
    const again = await request(server)
      .post('/api/elearning/courses/generate')
      .set(owner)
      .send({ sectionId: sectionA })
      .expect(201);
    expect(again.body.created).toBe(0);
  });

  it('scopes the course list to what each staff member teaches', async () => {
    const all = await request(server).get('/api/elearning/courses').set(owner).expect(200);
    expect(all.body.map((c: { title: string }) => c.title).sort()).toEqual(['English', 'Maths']);
    const filtered = await request(server).get(`/api/elearning/courses?subjectId=${maths}`).set(owner).expect(200);
    expect(filtered.body).toHaveLength(1);

    const mine = await request(server).get('/api/elearning/courses').set(teacher).expect(200);
    expect(mine.body).toMatchObject([{ id: courseId, studentCount: 2, canManage: true }]);
    const none = await request(server).get('/api/elearning/courses').set(otherTeacher).expect(200);
    expect(none.body).toEqual([]);
    await request(server).get(`/api/elearning/courses/${courseId}`).set(otherTeacher).expect(404);
    await request(server).patch(`/api/elearning/courses/${courseId}`).set(otherTeacher).send({ title: 'Mine' }).expect(404);
    await request(server).get('/api/elearning/courses').set(accountant).expect(403);
  });

  it('builds units and lessons in order', async () => {
    unit1 = (
      await request(server).post(`/api/elearning/courses/${courseId}/units`).set(teacher).send({ title: 'Fractions' }).expect(201)
    ).body.id;
    unit2 = (
      await request(server).post(`/api/elearning/courses/${courseId}/units`).set(teacher).send({ title: 'Decimals' }).expect(201)
    ).body.id;
    await request(server)
      .put(`/api/elearning/courses/${courseId}/units/order`)
      .set(teacher)
      .send({ ids: [unit1] })
      .expect(400);
    await request(server)
      .put(`/api/elearning/courses/${courseId}/units/order`)
      .set(teacher)
      .send({ ids: [unit2, unit1] })
      .expect(200);
    await request(server).patch(`/api/elearning/units/${unit2}`).set(teacher).send({ title: 'Decimal numbers' }).expect(200);

    const video = await request(server)
      .post(`/api/elearning/units/${unit1}/lessons`)
      .set(teacher)
      .send({ title: 'What is a fraction?', kind: 'VIDEO', url: 'https://www.youtube.com/watch?v=n0FZhQ_GkKw', durationMin: 8 })
      .expect(201);
    videoLesson = video.body.id;
    expect(video.body.embedUrl).toBe('https://www.youtube-nocookie.com/embed/n0FZhQ_GkKw');
    textLesson = (
      await request(server)
        .post(`/api/elearning/units/${unit1}/lessons`)
        .set(teacher)
        .send({ title: 'Equivalent fractions', kind: 'TEXT', body: '1/2 = 2/4 = 3/6', isPublished: true })
        .expect(201)
    ).body.id;
    draftLesson = (
      await request(server)
        .post(`/api/elearning/units/${unit2}/lessons`)
        .set(teacher)
        .send({ title: 'Place value', kind: 'TEXT', body: 'Tenths and hundredths' })
        .expect(201)
    ).body.id;
    await request(server)
      .post(`/api/elearning/units/${unit1}/lessons`)
      .set(teacher)
      .send({ title: 'Worksheet', kind: 'LINK', url: 'http://example.com/sheet' })
      .expect(400);
    await request(server)
      .post(`/api/elearning/units/${unit1}/lessons`)
      .set(teacher)
      .send({ title: 'Empty', kind: 'VIDEO' })
      .expect(400);

    await request(server)
      .put(`/api/elearning/units/${unit1}/lessons/order`)
      .set(teacher)
      .send({ ids: [textLesson, videoLesson] })
      .expect(200);
    await request(server)
      .put(`/api/elearning/lessons/${videoLesson}/publish`)
      .set(teacher)
      .send({ isPublished: true })
      .expect(200);
    await request(server)
      .patch(`/api/elearning/lessons/${draftLesson}`)
      .set(teacher)
      .send({ kind: 'VIDEO' })
      .expect(400);

    const detail = await request(server).get(`/api/elearning/courses/${courseId}`).set(teacher).expect(200);
    expect(detail.body.units.map((u: { title: string }) => u.title)).toEqual(['Decimal numbers', 'Fractions']);
    expect(detail.body.units[1].lessons.map((l: { id: string; isPublished: boolean }) => [l.id, l.isPublished])).toEqual([
      [textLesson, true],
      [videoLesson, true],
    ]);
    expect(detail.body.units[1].lessons[1].publishedAt).toBeTruthy();
  });

  it('shows students only published courses and lessons of their own section', async () => {
    expect((await request(server).get('/api/student/courses').set(studentA).expect(200)).body).toEqual([]);
    await request(server).get(`/api/student/courses/${courseId}`).set(studentA).expect(404);
    await request(server).patch(`/api/elearning/courses/${courseId}`).set(teacher).send({ isPublished: true }).expect(200);

    const list = await request(server).get('/api/student/courses').set(studentA).expect(200);
    expect(list.body).toMatchObject([
      { id: courseId, lessonCount: 2, completedCount: 0, percent: 0, nextLesson: { id: textLesson } },
    ]);
    const detail = await request(server).get(`/api/student/courses/${courseId}`).set(studentA).expect(200);
    // The unit holding only a draft is hidden.
    expect(detail.body.units).toHaveLength(1);
    expect(detail.body.units[0].lessons.map((l: { id: string }) => l.id)).toEqual([textLesson, videoLesson]);

    const lesson = await request(server).get(`/api/student/lessons/${videoLesson}`).set(studentA).expect(200);
    expect(lesson.body).toMatchObject({
      kind: 'VIDEO',
      embedUrl: 'https://www.youtube-nocookie.com/embed/n0FZhQ_GkKw',
      completed: false,
      prev: { id: textLesson },
      next: null,
      unit: { id: unit1 },
    });
    await request(server).get(`/api/student/lessons/${draftLesson}`).set(studentA).expect(404);
    await request(server).post(`/api/student/lessons/${draftLesson}/complete`).set(studentA).expect(404);

    // Bilal is in section B: nothing to see.
    expect((await request(server).get('/api/student/courses').set(studentB).expect(200)).body).toEqual([]);
    await request(server).get(`/api/student/lessons/${videoLesson}`).set(studentB).expect(404);
    await request(server).post(`/api/student/lessons/${videoLesson}/complete`).set(studentB).expect(404);
    // Staff do not use the student endpoints, students do not use the staff ones.
    await request(server).get('/api/student/courses').set(teacher).expect(403);
    await request(server).get('/api/elearning/courses').set(studentA).expect(403);
  });

  it('records completion and shows it in the progress matrix', async () => {
    const done = await request(server).post(`/api/student/lessons/${videoLesson}/complete`).set(studentA).expect(201);
    expect(done.body).toMatchObject({ completed: true, completedCount: 1, lessonCount: 2, percent: 50 });
    // Completing twice is harmless.
    await request(server).post(`/api/student/lessons/${videoLesson}/complete`).set(studentA).expect(201);
    const lesson = await request(server).get(`/api/student/lessons/${videoLesson}`).set(studentA).expect(200);
    expect(lesson.body.completed).toBe(true);

    const progress = await request(server).get(`/api/elearning/courses/${courseId}/progress`).set(teacher).expect(200);
    expect(progress.body.publishedLessonCount).toBe(2);
    expect(progress.body.lessons).toHaveLength(3);
    const ayesha = progress.body.students.find((s: { id: string }) => s.id === ayeshaId);
    expect(ayesha).toMatchObject({ name: 'Ayesha', completedCount: 1, percent: 50 });
    expect(Object.keys(ayesha.completed)).toEqual([videoLesson]);
    expect(progress.body.avgPercent).toBe(25);

    const list = await request(server).get('/api/elearning/courses').set(teacher).expect(200);
    expect(list.body[0]).toMatchObject({ lessonCount: 3, publishedLessonCount: 2, avgCompletion: 25 });
    await request(server).get(`/api/elearning/courses/${courseId}/progress`).set(otherTeacher).expect(404);
  });

  it('keeps another school out', async () => {
    expect((await request(server).get('/api/elearning/courses').set(rivalOwner).expect(200)).body).toEqual([]);
    await request(server).get(`/api/elearning/courses/${courseId}`).set(rivalOwner).expect(404);
    await request(server).patch(`/api/elearning/courses/${courseId}`).set(rivalOwner).send({ title: 'Taken' }).expect(404);
    await request(server).post(`/api/elearning/courses/${courseId}/units`).set(rivalOwner).send({ title: 'X' }).expect(404);
    await request(server).patch(`/api/elearning/lessons/${videoLesson}`).set(rivalOwner).send({ title: 'X' }).expect(404);
    await request(server).delete(`/api/elearning/units/${unit1}`).set(rivalOwner).expect(404);
    await request(server)
      .post('/api/elearning/courses')
      .set(rivalOwner)
      .send({ sectionId: sectionA, subjectId: maths })
      .expect(404);
  });

  it('deletes lessons, units and courses', async () => {
    await request(server).delete(`/api/elearning/lessons/${draftLesson}`).set(teacher).expect(200);
    await request(server).delete(`/api/elearning/units/${unit2}`).set(teacher).expect(200);
    await request(server).delete(`/api/elearning/courses/${courseId}`).set(otherTeacher).expect(404);
    await request(server).delete(`/api/elearning/courses/${courseId}`).set(teacher).expect(200);
    expect(await prisma.lessonProgress.count({ where: { studentId: ayeshaId } })).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { entityId: courseId }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['course.create', 'course.update', 'course.delete']));
  });
});
