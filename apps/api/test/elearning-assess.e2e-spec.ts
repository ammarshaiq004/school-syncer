import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

type Headers = Record<string, string>;

// Assignments + submissions and quizzes + attempts: staff and student sides,
// teacher scoping, late rules, the server-side time limit, hidden answer keys
// and tenant isolation.
describe('E-school assignments and quizzes (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const slugs: string[] = [];
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const inDays = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  let owner: Headers;
  let teacher: Headers;
  let otherTeacher: Headers;
  let accountant: Headers;
  let studentA: Headers;
  let studentHina: Headers;
  let studentB: Headers;
  let rivalOwner: Headers;
  let schoolSlug: string;
  let sectionA: string;
  let maths: string;
  let english: string;
  let ayeshaId: string;
  let hinaId: string;

  let assignmentId: string;
  let ayeshaSubmission: string;
  let quizId: string;
  let qSingle: string;
  let qMulti: string;
  let qShort: string;
  let attemptId: string;

  async function register(name: string, email: string) {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({
        schoolName: name,
        ownerName: 'Owner',
        email,
        password: 'password123',
      })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return reg.body as {
      schoolSlug: string;
      accessToken: string;
      user: { schoolId: string };
    };
  }

  async function loginAs(login: string) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password: 'password123' })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  /** The STUDENT user is created directly so this spec does not depend on the student-login endpoint. */
  async function studentLogin(
    schoolId: string,
    studentId: string,
    name: string,
  ) {
    const user = await prisma.user.create({
      data: {
        schoolId,
        name,
        username: `a${run}${studentId.slice(-4)}`,
        roles: { create: { role: 'STUDENT' } },
      },
    });
    await prisma.student.update({
      where: { id: studentId },
      data: { userId: user.id },
    });
    const token = app.get(JwtService).sign({
      sub: user.id,
      schoolId,
      name,
      roles: [{ role: 'STUDENT', campusId: null, customRoleId: null }],
    });
    return { Authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await register(`Assess ${run}`, `assess+${run}@test.pk`);
    schoolSlug = reg.schoolSlug;
    const schoolId = reg.user.schoolId;
    owner = { Authorization: `Bearer ${reg.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id;
    const yearId = (
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
    const classId = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 8' })
        .expect(201)
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
    const sectionB = await section('B');
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
    const makeUser = async (n: number, role: string) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({
            name: `Staff ${n}`,
            phone: phone(n),
            password: 'password123',
            roles: [{ role }],
          })
          .expect(201)
      ).body.id as string;
    const teacherId = await makeUser(1, 'TEACHER');
    await makeUser(2, 'TEACHER');
    await makeUser(3, 'ACCOUNTANT');
    for (const s of [sectionA, sectionB]) {
      await request(server)
        .put(`/api/classes/sections/${s}/subjects`)
        .set(owner)
        .send({
          subjects: [
            {
              subjectId: maths,
              teacherId: s === sectionA ? teacherId : undefined,
            },
            { subjectId: english },
          ],
        })
        .expect(200);
    }
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));
    accountant = await loginAs(phone(3));

    const addStudent = async (
      sectionId: string,
      firstName: string,
      n: number,
    ) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId,
            firstName,
            gender: 'FEMALE',
            guardians: [
              { name: 'Mother', phone: phone(n), relation: 'Mother' },
            ],
          })
          .expect(201)
      ).body.id as string;
    ayeshaId = await addStudent(sectionA, 'Ayesha', 5);
    hinaId = await addStudent(sectionA, 'Hina', 6);
    const bilalId = await addStudent(sectionB, 'Bilal', 7);
    studentA = await studentLogin(schoolId, ayeshaId, 'Ayesha');
    studentHina = await studentLogin(schoolId, hinaId, 'Hina');
    studentB = await studentLogin(schoolId, bilalId, 'Bilal');

    const rival = await register(`Rival ${run}`, `rival-assess+${run}@test.pk`);
    rivalOwner = { Authorization: `Bearer ${rival.accessToken}` };
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  // Assignments

  it('lets a teacher set an assignment only for a subject they teach', async () => {
    const created = await request(server)
      .post('/api/elearning/assignments')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Fractions worksheet',
        instructions: 'Solve questions 1 to 10',
        dueAt: inDays(2),
        maxPoints: 20,
        allowLate: false,
      })
      .expect(201);
    assignmentId = created.body.id;
    expect(created.body).toMatchObject({
      isPublished: false,
      maxPoints: 20,
      subject: { id: maths },
    });

    const body = {
      sectionId: sectionA,
      subjectId: english,
      title: 'Essay',
      dueAt: inDays(2),
    };
    await request(server)
      .post('/api/elearning/assignments')
      .set(teacher)
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/elearning/assignments')
      .set(otherTeacher)
      .send({ ...body, subjectId: maths })
      .expect(403);
    await request(server)
      .post('/api/elearning/assignments')
      .set(teacher)
      .send({
        ...body,
        attachmentUrl: 'http://insecure.pk/file.pdf',
        subjectId: maths,
      })
      .expect(400);
    await request(server)
      .get('/api/elearning/assignments')
      .set(accountant)
      .expect(403);
    expect(
      (
        await request(server)
          .get('/api/elearning/assignments')
          .set(otherTeacher)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .get(`/api/elearning/assignments/${assignmentId}`)
      .set(otherTeacher)
      .expect(404);
    await request(server)
      .get('/api/elearning/assignments')
      .set(studentA)
      .expect(403);
  });

  it('hides drafts from students and shows published work to the right section only', async () => {
    expect(
      (
        await request(server)
          .get('/api/student/assignments')
          .set(studentA)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .get(`/api/student/assignments/${assignmentId}`)
      .set(studentA)
      .expect(404);

    await request(server)
      .patch(`/api/elearning/assignments/${assignmentId}`)
      .set(teacher)
      .send({ isPublished: true })
      .expect(200);
    const list = await request(server)
      .get('/api/student/assignments')
      .set(studentA)
      .expect(200);
    expect(list.body).toMatchObject([
      {
        id: assignmentId,
        state: 'pending',
        urgency: 'soon',
        canSubmit: true,
        submission: null,
      },
    ]);
    expect(
      (
        await request(server)
          .get('/api/student/assignments')
          .set(studentB)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .get(`/api/student/assignments/${assignmentId}`)
      .set(studentB)
      .expect(404);
  });

  it('accepts and replaces a submission until it is graded', async () => {
    await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({})
      .expect(400);
    const first = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ body: 'My answers: 1/2, 3/4' })
      .expect(200);
    ayeshaSubmission = first.body.id;
    expect(first.body).toMatchObject({
      status: 'SUBMITTED',
      isLate: false,
      state: 'submitted',
    });
    const second = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({
        body: 'Corrected answers',
        linkUrl: 'https://drive.google.com/file/d/abc',
      })
      .expect(200);
    expect(second.body).toMatchObject({
      id: ayeshaSubmission,
      body: 'Corrected answers',
    });

    const subs = await request(server)
      .get(`/api/elearning/assignments/${assignmentId}/submissions`)
      .set(teacher)
      .expect(200);
    expect(subs.body.summary).toMatchObject({
      students: 2,
      submitted: 1,
      toGrade: 1,
      pending: 1,
    });
    const byName = Object.fromEntries(
      subs.body.students.map((s: { student: { name: string } }) => [
        s.student.name,
        s,
      ]),
    );
    expect(byName.Ayesha).toMatchObject({
      state: 'submitted',
      submission: { id: ayeshaSubmission },
    });
    expect(byName.Hina).toMatchObject({ state: 'pending', submission: null });

    await request(server)
      .put(`/api/elearning/submissions/${ayeshaSubmission}/grade`)
      .set(teacher)
      .send({ points: 25 })
      .expect(400);
    await request(server)
      .put(`/api/elearning/submissions/${ayeshaSubmission}/grade`)
      .set(otherTeacher)
      .send({ points: 18 })
      .expect(404);
    await request(server)
      .put(`/api/elearning/submissions/${ayeshaSubmission}/grade`)
      .set(rivalOwner)
      .send({ points: 18 })
      .expect(404);
    const graded = await request(server)
      .put(`/api/elearning/submissions/${ayeshaSubmission}/grade`)
      .set(teacher)
      .send({ points: 18, feedback: 'Well done' })
      .expect(200);
    expect(graded.body).toMatchObject({
      status: 'GRADED',
      points: 18,
      feedback: 'Well done',
    });

    const mine = await request(server)
      .get(`/api/student/assignments/${assignmentId}`)
      .set(studentA)
      .expect(200);
    expect(mine.body).toMatchObject({
      state: 'graded',
      canSubmit: false,
      submission: { points: 18, feedback: 'Well done' },
    });
    await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ body: 'One more try' })
      .expect(409);
  });

  it('lets a returned piece of work be resubmitted', async () => {
    await request(server)
      .put(`/api/elearning/submissions/${ayeshaSubmission}/grade`)
      .set(teacher)
      .send({ points: 10, feedback: 'Show your working', status: 'RETURNED' })
      .expect(200);
    const again = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ body: 'With working this time' })
      .expect(200);
    expect(again.body).toMatchObject({ status: 'SUBMITTED', points: null });
  });

  it('applies the late rules after the due date', async () => {
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { dueAt: new Date(Date.now() - 3_600_000) },
    });
    const closed = await request(server)
      .get(`/api/student/assignments/${assignmentId}`)
      .set(studentHina)
      .expect(200);
    expect(closed.body).toMatchObject({ state: 'missing', canSubmit: false });
    await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentHina)
      .send({ body: 'Sorry it is late' })
      .expect(409);

    await request(server)
      .patch(`/api/elearning/assignments/${assignmentId}`)
      .set(teacher)
      .send({ allowLate: true })
      .expect(200);
    const late = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentHina)
      .send({ body: 'Sorry it is late' })
      .expect(200);
    expect(late.body).toMatchObject({ isLate: true });
    const list = await request(server)
      .get('/api/elearning/assignments')
      .set(teacher)
      .expect(200);
    expect(list.body[0]).toMatchObject({
      id: assignmentId,
      submittedCount: 2,
      lateCount: 1,
      studentCount: 2,
    });
  });

  // Quizzes

  it('builds a quiz with validated questions', async () => {
    await request(server)
      .post('/api/elearning/quizzes')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Bad',
        questions: [
          { kind: 'SINGLE', prompt: 'x', options: ['a'], correct: [0] },
        ],
      })
      .expect(400);
    await request(server)
      .post('/api/elearning/quizzes')
      .set(otherTeacher)
      .send({ sectionId: sectionA, subjectId: maths, title: 'Not mine' })
      .expect(403);
    const created = await request(server)
      .post('/api/elearning/quizzes')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Fractions check',
        timeLimitMin: 10,
        questions: [
          {
            kind: 'SINGLE',
            prompt: 'Half of 10?',
            options: ['2', '5', '10'],
            correct: [1],
            points: 2,
          },
          {
            kind: 'MULTI',
            prompt: 'Equal to 1/2?',
            options: ['2/4', '3/6', '1/3'],
            correct: [0, 1],
            points: 2,
          },
          { kind: 'TRUE_FALSE', prompt: '3/3 equals 1', correct: [0] },
        ],
      })
      .expect(201);
    quizId = created.body.id;
    expect(created.body).toMatchObject({
      questionCount: 3,
      totalPoints: 5,
      isPublished: false,
      locked: false,
    });
    [qSingle, qMulti] = created.body.questions.map((q: { id: string }) => q.id);
    expect(created.body.questions[2].options).toEqual(['True', 'False']);
    const short = await request(server)
      .post(`/api/elearning/quizzes/${quizId}/questions`)
      .set(teacher)
      .send({
        kind: 'SHORT',
        prompt: 'Write 0.5 as a fraction',
        correct: ['1/2', 'one half'],
        points: 3,
      })
      .expect(201);
    qShort = short.body.id;

    await request(server)
      .get('/api/student/quizzes/' + quizId)
      .set(studentA)
      .expect(404);
    await request(server)
      .post(`/api/student/quizzes/${quizId}/start`)
      .set(studentA)
      .expect(404);
    await request(server)
      .put(`/api/elearning/quizzes/${quizId}/publish`)
      .set(otherTeacher)
      .send({ isPublished: true })
      .expect(404);
    await request(server)
      .put(`/api/elearning/quizzes/${quizId}/publish`)
      .set(teacher)
      .send({ isPublished: true })
      .expect(200);
  });

  it('starts an attempt without answer keys and autosaves', async () => {
    const list = await request(server)
      .get('/api/student/quizzes')
      .set(studentA)
      .expect(200);
    expect(list.body).toMatchObject([
      {
        id: quizId,
        window: 'open',
        questionCount: 4,
        totalPoints: 8,
        attemptsLeft: 1,
        canStart: true,
      },
    ]);
    expect(
      (
        await request(server)
          .get('/api/student/quizzes')
          .set(studentB)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .post(`/api/student/quizzes/${quizId}/start`)
      .set(studentB)
      .expect(404);

    const started = await request(server)
      .post(`/api/student/quizzes/${quizId}/start`)
      .set(studentA)
      .expect(200);
    attemptId = started.body.attemptId;
    expect(started.body).toMatchObject({
      status: 'in_progress',
      answers: {},
      graceSeconds: 60,
    });
    expect(started.body.deadline).toBeTruthy();
    expect(started.body.questions).toHaveLength(4);
    expect(JSON.stringify(started.body)).not.toMatch(/correct|one half/);

    // Starting again resumes the same attempt.
    const resumed = await request(server)
      .post(`/api/student/quizzes/${quizId}/start`)
      .set(studentA)
      .expect(200);
    expect(resumed.body.attemptId).toBe(attemptId);

    const saved = await request(server)
      .put(`/api/student/attempts/${attemptId}`)
      .set(studentA)
      .send({ answers: { [qSingle]: [1], [qMulti]: [0, 1, 7], unknown: [0] } })
      .expect(200);
    expect(saved.body.answered).toBe(2);
    const view = await request(server)
      .get(`/api/student/attempts/${attemptId}`)
      .set(studentA)
      .expect(200);
    expect(view.body.answers).toEqual({ [qSingle]: [1], [qMulti]: [0, 1] });
    expect(JSON.stringify(view.body)).not.toMatch(/"correct"/);

    // Nobody else can read or change this attempt.
    await request(server)
      .get(`/api/student/attempts/${attemptId}`)
      .set(studentHina)
      .expect(404);
    await request(server)
      .put(`/api/student/attempts/${attemptId}`)
      .set(studentB)
      .send({ answers: {} })
      .expect(404);
    await request(server)
      .get(`/api/elearning/attempts/${attemptId}`)
      .set(rivalOwner)
      .expect(404);

    // Questions are frozen once attempts exist (wording can still change).
    await request(server)
      .delete(`/api/elearning/questions/${qSingle}`)
      .set(teacher)
      .expect(409);
    await request(server)
      .patch(`/api/elearning/questions/${qSingle}`)
      .set(teacher)
      .send({ points: 5 })
      .expect(409);
    await request(server)
      .patch(`/api/elearning/questions/${qSingle}`)
      .set(teacher)
      .send({ prompt: 'What is half of 10?' })
      .expect(200);
  });

  it('marks on submit, waits for review of short answers, and shows the key at the end', async () => {
    const result = await request(server)
      .post(`/api/student/attempts/${attemptId}/submit`)
      .set(studentA)
      .send({ answers: { [qShort]: 'a half' } })
      .expect(200);
    expect(result.body).toMatchObject({
      status: 'submitted',
      score: 4,
      maxScore: 8,
      percent: 50,
      needsReview: true,
      attemptsLeft: 0,
      canRetry: false,
      answersVisible: true,
    });
    const shortRow = result.body.questions.find(
      (q: { id: string }) => q.id === qShort,
    );
    expect(shortRow).toMatchObject({
      outcome: 'pending',
      earned: 0,
      correct: ['1/2', 'one half'],
    });

    // Submitting twice returns the same result; saving afterwards is refused.
    const again = await request(server)
      .post(`/api/student/attempts/${attemptId}/submit`)
      .set(studentA)
      .send({})
      .expect(200);
    expect(again.body.score).toBe(4);
    await request(server)
      .put(`/api/student/attempts/${attemptId}`)
      .set(studentA)
      .send({ answers: {} })
      .expect(409);
    await request(server)
      .post(`/api/student/quizzes/${quizId}/start`)
      .set(studentA)
      .expect(409);

    await request(server)
      .put(`/api/elearning/attempts/${attemptId}/review`)
      .set(teacher)
      .send({ pointsByQuestion: { [qSingle]: 2 } })
      .expect(400);
    await request(server)
      .put(`/api/elearning/attempts/${attemptId}/review`)
      .set(otherTeacher)
      .send({ pointsByQuestion: { [qShort]: 3 } })
      .expect(404);
    await request(server)
      .put(`/api/elearning/attempts/${attemptId}/review`)
      .set(studentA)
      .send({ pointsByQuestion: { [qShort]: 3 } })
      .expect(403);
    const reviewed = await request(server)
      .put(`/api/elearning/attempts/${attemptId}/review`)
      .set(teacher)
      .send({ pointsByQuestion: { [qShort]: 3 } })
      .expect(200);
    expect(reviewed.body).toMatchObject({
      score: 7,
      needsReview: false,
      percent: 87.5,
    });

    const results = await request(server)
      .get(`/api/elearning/quizzes/${quizId}/results`)
      .set(teacher)
      .expect(200);
    expect(results.body.summary).toMatchObject({
      students: 2,
      attempted: 1,
      needsReview: 0,
      avgPercent: 87.5,
    });
    const ayesha = results.body.students.find(
      (s: { student: { id: string } }) => s.student.id === ayeshaId,
    );
    expect(ayesha).toMatchObject({
      submitted: 1,
      best: { score: 7, maxScore: 8 },
    });
    const hina = results.body.students.find(
      (s: { student: { id: string } }) => s.student.id === hinaId,
    );
    expect(hina).toMatchObject({ submitted: 0, best: null });
    expect(results.body.questionStats[0]).toMatchObject({
      questionId: qSingle,
      answered: 1,
      correct: 1,
    });
  });

  it('enforces the time limit on the server', async () => {
    const started = await request(server)
      .post(`/api/student/quizzes/${quizId}/start`)
      .set(studentHina)
      .expect(200);
    const hinaAttempt = started.body.attemptId;
    await request(server)
      .put(`/api/student/attempts/${hinaAttempt}`)
      .set(studentHina)
      .send({ answers: { [qSingle]: [1] } })
      .expect(200);
    // Pretend she started 12 minutes ago on a 10 minute quiz.
    await prisma.quizAttempt.update({
      where: { id: hinaAttempt },
      data: { startedAt: new Date(Date.now() - 12 * 60_000) },
    });
    await request(server)
      .put(`/api/student/attempts/${hinaAttempt}`)
      .set(studentHina)
      .send({ answers: { [qMulti]: [0, 1] } })
      .expect(409);
    const result = await request(server)
      .post(`/api/student/attempts/${hinaAttempt}/submit`)
      .set(studentHina)
      .send({ answers: { [qMulti]: [0, 1], [qShort]: '1/2' } })
      .expect(200);
    // Only the answer saved in time counts.
    expect(result.body).toMatchObject({
      score: 2,
      timedOut: true,
      needsReview: false,
    });
  });

  it('shows only the total while another attempt is possible, and one start opens one attempt', async () => {
    const quiz = await request(server)
      .post('/api/elearning/quizzes')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Two tries',
        attemptsAllowed: 2,
        questions: [{ kind: 'TRUE_FALSE', prompt: '1/4 > 1/3', correct: [1] }],
      })
      .expect(201);
    await request(server)
      .put(`/api/elearning/quizzes/${quiz.body.id}/publish`)
      .set(teacher)
      .send({ isPublished: true })
      .expect(200);
    const starts = await Promise.all(
      [1, 2, 3].map(() =>
        request(server)
          .post(`/api/student/quizzes/${quiz.body.id}/start`)
          .set(studentA),
      ),
    );
    for (const r of starts) expect(r.status).toBe(200);
    expect(new Set(starts.map((r) => r.body.attemptId)).size).toBe(1);
    const first = await request(server)
      .post(`/api/student/attempts/${starts[0].body.attemptId}/submit`)
      .set(studentA)
      .send({ answers: { [starts[0].body.questions[0].id]: [0] } })
      .expect(200);
    expect(first.body).toMatchObject({
      score: 0,
      canRetry: true,
      answersVisible: false,
      questions: null,
    });
    const second = await request(server)
      .post(`/api/student/quizzes/${quiz.body.id}/start`)
      .set(studentA)
      .expect(200);
    const last = await request(server)
      .post(`/api/student/attempts/${second.body.attemptId}/submit`)
      .set(studentA)
      .send({ answers: { [second.body.questions[0].id]: [1] } })
      .expect(200);
    expect(last.body).toMatchObject({ score: 1, canRetry: false, answersVisible: true });
    expect(last.body.questions[0]).toMatchObject({ outcome: 'correct', correct: [1] });
  });

  it('hides scores when results are turned off', async () => {
    const quiz = await request(server)
      .post('/api/elearning/quizzes')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Secret check',
        showResults: false,
        attemptsAllowed: 2,
        questions: [{ kind: 'TRUE_FALSE', prompt: '1/2 > 1/3', correct: [0] }],
      })
      .expect(201);
    await request(server)
      .put(`/api/elearning/quizzes/${quiz.body.id}/publish`)
      .set(teacher)
      .send({ isPublished: true })
      .expect(200);
    const started = await request(server)
      .post(`/api/student/quizzes/${quiz.body.id}/start`)
      .set(studentA)
      .expect(200);
    const result = await request(server)
      .post(`/api/student/attempts/${started.body.attemptId}/submit`)
      .set(studentA)
      .send({ answers: { [started.body.questions[0].id]: [0] } })
      .expect(200);
    expect(result.body).toMatchObject({
      score: null,
      percent: null,
      questions: null,
      canRetry: true,
      attemptsLeft: 1,
    });
    const card = await request(server)
      .get(`/api/student/quizzes/${quiz.body.id}`)
      .set(studentA)
      .expect(200);
    expect(card.body).toMatchObject({
      best: null,
      latest: { score: null },
      attemptsLeft: 1,
    });
    const staff = await request(server)
      .get(`/api/elearning/quizzes/${quiz.body.id}/results`)
      .set(teacher)
      .expect(200);
    expect(staff.body.summary.avgPercent).toBe(100);
  });

  it('keeps every school to its own assignments and quizzes', async () => {
    expect(
      (
        await request(server)
          .get('/api/elearning/assignments')
          .set(rivalOwner)
          .expect(200)
      ).body,
    ).toEqual([]);
    expect(
      (
        await request(server)
          .get('/api/elearning/quizzes')
          .set(rivalOwner)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .get(`/api/elearning/assignments/${assignmentId}`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .get(`/api/elearning/assignments/${assignmentId}/submissions`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .patch(`/api/elearning/assignments/${assignmentId}`)
      .set(rivalOwner)
      .send({ title: 'Mine now' })
      .expect(404);
    await request(server)
      .delete(`/api/elearning/assignments/${assignmentId}`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .get(`/api/elearning/quizzes/${quizId}`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .get(`/api/elearning/quizzes/${quizId}/results`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .delete(`/api/elearning/quizzes/${quizId}`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .post(`/api/elearning/quizzes/${quizId}/questions`)
      .set(rivalOwner)
      .send({ kind: 'TRUE_FALSE', prompt: 'x', correct: [0] })
      .expect(404);
    await request(server)
      .post('/api/elearning/assignments')
      .set(rivalOwner)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Sneaky',
        dueAt: inDays(1),
      })
      .expect(404);
  });

  it('cleans up with delete', async () => {
    await request(server)
      .delete(`/api/elearning/quizzes/${quizId}`)
      .set(teacher)
      .expect(200);
    await request(server)
      .delete(`/api/elearning/assignments/${assignmentId}`)
      .set(teacher)
      .expect(200);
    expect(await prisma.quizAttempt.count({ where: { quizId } })).toBe(0);
    expect(await prisma.submission.count({ where: { assignmentId } })).toBe(0);
  });
});
