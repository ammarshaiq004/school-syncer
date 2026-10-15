import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Ids = Record<string, string>;

const today = localToday();
const year = Number(today.slice(0, 4));

/**
 * One row per route that takes a record id. `path` and `body` get the ids
 * created in school A; school B's owner must get 404 (or 403) for each, and
 * the GET rows must still answer school A's owner afterwards, which proves
 * the ids were real and nothing was changed or deleted by school B's calls.
 *
 * Adding a module: create one record in `beforeAll`, store its id in `ids`,
 * and add its routes here.
 */
const routes: { method: Method; path: (i: Ids) => string; body?: (i: Ids) => object }[] = [
  // Campuses, classes, people
  { method: 'patch', path: (i) => `/api/campuses/${i.campus}`, body: () => ({ name: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/campuses/${i.campus}` },
  { method: 'post', path: (i) => `/api/classes/${i.class}/sections`, body: (i) => ({ academicYearId: i.year, name: 'Z' }) },
  { method: 'get', path: (i) => `/api/classes/sections/${i.section}/subjects` },
  { method: 'put', path: (i) => `/api/classes/sections/${i.section}/subjects`, body: () => ({ subjects: [] }) },
  { method: 'get', path: (i) => `/api/students/${i.student}` },
  { method: 'get', path: (i) => `/api/students/${i.student}/performance` },
  { method: 'patch', path: (i) => `/api/students/${i.student}`, body: () => ({ firstName: 'Taken' }) },
  { method: 'post', path: (i) => `/api/students/${i.student}/login`, body: () => ({}) },
  { method: 'delete', path: (i) => `/api/students/${i.student}/login`, body: () => ({}) },
  { method: 'post', path: (i) => `/api/students/${i.student}/guardians/${i.guardian}/invite` },
  { method: 'get', path: (i) => `/api/users/${i.teacher}` },
  { method: 'patch', path: (i) => `/api/users/${i.teacher}`, body: () => ({ name: 'Taken Over' }) },
  { method: 'post', path: (i) => `/api/users/${i.teacher}/deactivate` },
  { method: 'post', path: (i) => `/api/users/${i.teacher}/reset-password` },
  { method: 'patch', path: (i) => `/api/roles/${i.role}`, body: () => ({ name: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/roles/${i.role}` },
  { method: 'post', path: (i) => `/api/roles/${i.role}/duplicate` },
  { method: 'patch', path: (i) => `/api/applications/${i.application}`, body: () => ({ stage: 'OFFERED' }) },
  { method: 'post', path: (i) => `/api/applications/${i.application}/admit`, body: (i) => ({ sectionId: i.section }) },
  // Attendance, timetable, promotions
  { method: 'get', path: (i) => `/api/attendance/students/${i.student}?month=${today.slice(0, 7)}` },
  { method: 'get', path: (i) => `/api/timetable/sections/${i.section}` },
  { method: 'put', path: (i) => `/api/timetable/sections/${i.section}`, body: () => ({ slots: [] }) },
  { method: 'get', path: (i) => `/api/timetable/teachers/${i.teacher}` },
  { method: 'get', path: (i) => `/api/timetable/students/${i.student}` },
  { method: 'get', path: (i) => `/api/promotions/sections/${i.section}` },
  // Fees
  { method: 'get', path: (i) => `/api/fees/invoices/${i.invoice}` },
  {
    method: 'post',
    path: (i) => `/api/fees/invoices/${i.invoice}/payments`,
    body: () => ({ amount: 100, method: 'CASH' }),
  },
  { method: 'post', path: (i) => `/api/fees/payments/${i.payment}/reverse`, body: () => ({ reason: 'Not ours' }) },
  { method: 'post', path: (i) => `/api/fees/invoices/${i.invoice}/cancel`, body: () => ({ reason: 'Not ours' }) },
  {
    method: 'post',
    path: (i) => `/api/fees/invoices/${i.invoice}/adjustments`,
    body: () => ({ amount: -100, reason: 'Not ours' }),
  },
  {
    method: 'put',
    path: (i) => `/api/fees/students/${i.student}/concessions`,
    body: (i) => ({ feeHeadId: i.feeHead, type: 'PERCENT', value: 50 }),
  },
  { method: 'delete', path: (i) => `/api/fees/students/${i.student}/concessions/${i.feeHead}` },
  { method: 'delete', path: (i) => `/api/accounts/entries/${i.entry}` },
  // Exams
  { method: 'get', path: (i) => `/api/exams/${i.exam}` },
  { method: 'get', path: (i) => `/api/exams/${i.exam}/marks?sectionId=${i.section}&subjectId=${i.subject}` },
  { method: 'get', path: (i) => `/api/exams/${i.exam}/progress` },
  { method: 'get', path: (i) => `/api/exams/${i.exam}/results?sectionId=${i.section}` },
  { method: 'get', path: (i) => `/api/exams/${i.exam}/report-cards/${i.student}` },
  {
    method: 'put',
    path: (i) => `/api/exams/${i.exam}/papers`,
    body: (i) => ({ papers: [{ classId: i.class, subjectId: i.subject, maxMarks: 50, passMarks: 17 }] }),
  },
  { method: 'delete', path: (i) => `/api/exams/${i.exam}/papers/${i.paper}` },
  { method: 'post', path: (i) => `/api/exams/${i.exam}/unpublish`, body: () => ({}) },
  {
    method: 'put',
    path: (i) => `/api/exams/${i.exam}/results/${i.student}/remarks`,
    body: () => ({ teacherRemark: 'Taken over' }),
  },
  // Library, transport, certificates
  { method: 'get', path: (i) => `/api/library/books/${i.book}` },
  { method: 'patch', path: (i) => `/api/library/books/${i.book}`, body: () => ({ title: 'Taken' }) },
  { method: 'post', path: (i) => `/api/library/books/${i.book}/copies`, body: () => ({ count: 1 }) },
  { method: 'patch', path: (i) => `/api/library/copies/${i.copy}`, body: () => ({ status: 'WITHDRAWN' }) },
  { method: 'get', path: (i) => `/api/library/students/${i.student}` },
  { method: 'post', path: (i) => `/api/library/loans/${i.loan}/return`, body: () => ({}) },
  { method: 'post', path: (i) => `/api/library/loans/${i.loan}/lost`, body: () => ({ charge: 500 }) },
  { method: 'patch', path: (i) => `/api/transport/vehicles/${i.vehicle}`, body: () => ({ capacity: 9 }) },
  { method: 'get', path: (i) => `/api/transport/routes/${i.route}` },
  { method: 'patch', path: (i) => `/api/transport/routes/${i.route}`, body: () => ({ monthlyFee: 1 }) },
  { method: 'put', path: (i) => `/api/transport/routes/${i.route}/stops`, body: () => ({ stops: [] }) },
  { method: 'get', path: (i) => `/api/transport/students/${i.student}` },
  { method: 'get', path: (i) => `/api/certificates/students/${i.student}/draft?type=CHARACTER` },
  { method: 'get', path: (i) => `/api/certificates/${i.certificate}` },
  { method: 'post', path: (i) => `/api/certificates/${i.certificate}/cancel`, body: () => ({ reason: 'Not ours' }) },
  // HR
  { method: 'put', path: (i) => `/api/hr/staff/${i.teacher}`, body: () => ({ designation: 'Taken over', basicSalary: 1 }) },
  { method: 'post', path: (i) => `/api/hr/leave/${i.leave}/decide`, body: () => ({ approve: true }) },
  { method: 'get', path: (i) => `/api/hr/payroll/${i.payroll}` },
  { method: 'post', path: (i) => `/api/hr/payroll/${i.payroll}/finalize` },
  // Teaching
  { method: 'get', path: (i) => `/api/lesson-plans/${i.plan}` },
  { method: 'patch', path: (i) => `/api/lesson-plans/${i.plan}`, body: () => ({ topic: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/lesson-plans/${i.plan}` },
  { method: 'post', path: (i) => `/api/lesson-plans/${i.plan}/review`, body: () => ({ decision: 'APPROVED' }) },
  { method: 'delete', path: (i) => `/api/homework/${i.homework}` },
  { method: 'get', path: (i) => `/api/chat/threads/${i.thread}` },
  { method: 'get', path: (i) => `/api/chat/threads/${i.thread}/messages` },
  { method: 'post', path: (i) => `/api/chat/threads/${i.thread}/messages`, body: () => ({ body: 'Hello' }) },
  // E-learning
  { method: 'get', path: (i) => `/api/elearning/courses/${i.course}` },
  { method: 'patch', path: (i) => `/api/elearning/courses/${i.course}`, body: () => ({ title: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/courses/${i.course}` },
  { method: 'get', path: (i) => `/api/elearning/courses/${i.course}/progress` },
  { method: 'post', path: (i) => `/api/elearning/courses/${i.course}/units`, body: () => ({ title: 'Taken over' }) },
  { method: 'patch', path: (i) => `/api/elearning/units/${i.unit}`, body: () => ({ title: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/units/${i.unit}` },
  { method: 'post', path: (i) => `/api/elearning/units/${i.unit}/lessons`, body: () => ({ title: 'Taken over', kind: 'TEXT', body: 'Text' }) },
  { method: 'patch', path: (i) => `/api/elearning/lessons/${i.lesson}`, body: () => ({ title: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/lessons/${i.lesson}` },
  { method: 'get', path: (i) => `/api/elearning/quizzes/${i.quiz}` },
  { method: 'patch', path: (i) => `/api/elearning/quizzes/${i.quiz}`, body: () => ({ title: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/quizzes/${i.quiz}` },
  { method: 'get', path: (i) => `/api/elearning/quizzes/${i.quiz}/results` },
  { method: 'patch', path: (i) => `/api/elearning/questions/${i.question}`, body: () => ({ prompt: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/questions/${i.question}` },
  { method: 'get', path: (i) => `/api/elearning/assignments/${i.assignment}` },
  { method: 'patch', path: (i) => `/api/elearning/assignments/${i.assignment}`, body: () => ({ title: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/assignments/${i.assignment}` },
  { method: 'get', path: (i) => `/api/elearning/assignments/${i.assignment}/submissions` },
  { method: 'get', path: (i) => `/api/elearning/live/${i.live}` },
  { method: 'patch', path: (i) => `/api/elearning/live/${i.live}`, body: () => ({ title: 'Taken over' }) },
  { method: 'delete', path: (i) => `/api/elearning/live/${i.live}` },
  { method: 'post', path: (i) => `/api/elearning/live/${i.live}/cancel` },
  { method: 'get', path: (i) => `/api/elearning/live/${i.live}/attendance` },
  // Pilot kit
  { method: 'get', path: (i) => `/api/problem-reports/${i.problemReport}` },
];

describe('School isolation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `037${run.slice(-7)}${n}`;
  const slugs: string[] = [];
  const ids: Ids = {};
  let ownerA: Headers;
  let ownerB: Headers;
  let teacherA: Headers;

  const register = async (name: string) => {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `${name} ${run}`, ownerName: 'Owner', email: `iso-${name}+${run}@test.pk`, password: 'password123' })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return { slug: reg.body.schoolSlug as string, headers: { Authorization: `Bearer ${reg.body.accessToken}` } };
  };

  const send = async (method: Method, as: Headers, path: string, body: object, status: number) => {
    const res = await request(server)[method](path).set(as).send(body);
    if (res.status !== status) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  // Promotions need this year and next in each school.
  const addYears = async (as: Headers) => {
    const id = (
      await create(as, '/api/academic-years', {
        name: `${year}`,
        startsOn: `${year}-01-01`,
        endsOn: `${year}-12-31`,
        isCurrent: true,
      })
    ).id as string;
    await create(as, '/api/academic-years', { name: `${year + 1}`, startsOn: `${year + 1}-01-01`, endsOn: `${year + 1}-12-31` });
    return id;
  };
  const create = (as: Headers, path: string, body: object) => send('post', as, path, body, 201);
  const put = (as: Headers, path: string, body: object) => send('put', as, path, body, 200);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const a = await register('Alpha');
    ownerA = a.headers;
    ownerB = (await register('Bravo')).headers;

    // School A: one of everything.
    const mainCampus = (await request(server).get('/api/campuses').set(ownerA)).body[0].id;
    ids.campus = (await create(ownerA, '/api/campuses', { name: `Second ${run}` })).id;
    ids.year = await addYears(ownerA);
    await addYears(ownerB);
    ids.class = (await create(ownerA, '/api/classes', { campusId: mainCampus, name: 'Grade 5' })).id;
    ids.subject = (await create(ownerA, '/api/subjects', { name: 'Maths' })).id;
    ids.teacher = (
      await create(ownerA, '/api/users', {
        name: 'Teacher A',
        phone: phone(1),
        password: 'password123',
        roles: [{ role: 'TEACHER', campusId: mainCampus }],
      })
    ).id;
    ids.section = (
      await create(ownerA, `/api/classes/${ids.class}/sections`, {
        academicYearId: ids.year,
        name: 'A',
        classTeacherId: ids.teacher,
      })
    ).id;
    await put(ownerA, `/api/classes/sections/${ids.section}/subjects`, {
      subjects: [{ subjectId: ids.subject, teacherId: ids.teacher }],
    });
    ids.student = (
      await create(ownerA, '/api/students', {
        sectionId: ids.section,
        firstName: 'Ayesha',
        gender: 'FEMALE',
        guardians: [{ name: 'Parent A', phone: phone(2), relation: 'Mother' }],
      })
    ).id;
    ids.guardian = (await request(server).get(`/api/students/${ids.student}`).set(ownerA).expect(200)).body
      .guardians[0].guardianId;
    await create(ownerA, `/api/students/${ids.student}/guardians/${ids.guardian}/invite`, {});
    const guardianUser = await prisma.guardian.findUniqueOrThrow({ where: { id: ids.guardian } });

    const login = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug: a.slug, login: phone(1), password: 'password123' })
      .expect(200);
    await keepIssuedPassword(app, login.body);
    teacherA = { Authorization: `Bearer ${login.body.accessToken}` };

    ids.role = (await create(ownerA, '/api/roles', { name: 'Clerk', baseRole: 'STAFF' })).id;
    await create(ownerA, '/api/applications', {
      campusId: mainCampus,
      classId: ids.class,
      childName: 'Applicant',
      gender: 'MALE',
      guardianName: 'Parent',
      guardianPhone: phone(3),
    });
    ids.application = (await prisma.application.findFirstOrThrow({ where: { childName: 'Applicant', class: { id: ids.class } } })).id;

    // Fees: a voucher with one payment, plus a cashbook entry.
    ids.feeHead = (await create(ownerA, '/api/fees/heads', { name: 'Tuition' })).id;
    await put(ownerA, '/api/fees/structures', {
      classId: ids.class,
      feeHeadId: ids.feeHead,
      academicYearId: ids.year,
      amount: 5000,
    });
    await create(ownerA, '/api/fees/invoices/generate', { period: `${year}-01` });
    ids.invoice = (await prisma.invoice.findFirstOrThrow({ where: { studentId: ids.student } })).id;
    ids.payment = (await create(ownerA, `/api/fees/invoices/${ids.invoice}/payments`, { amount: 1000, method: 'CASH' }))
      .payment.id;
    const category = (await create(ownerA, '/api/accounts/categories', { name: 'Repairs', kind: 'EXPENSE' })).id;
    ids.entry = (await create(ownerA, '/api/accounts/entries', { categoryId: category, amount: 700, date: today })).id;

    // Exams
    ids.exam = (await create(ownerA, '/api/exams', { name: 'Midterm', academicYearId: ids.year, startsOn: today })).id;
    ids.paper = (
      await put(ownerA, `/api/exams/${ids.exam}/papers`, {
        papers: [{ classId: ids.class, subjectId: ids.subject, maxMarks: 50, passMarks: 17 }],
      })
    ).papers[0].id;
    await put(ownerA, `/api/exams/${ids.exam}/marks`, {
      sectionId: ids.section,
      subjectId: ids.subject,
      entries: [{ studentId: ids.student, marks: 40 }],
    });
    await create(ownerA, `/api/exams/${ids.exam}/publish`, {});

    // Library, transport, certificates
    const book = await create(ownerA, '/api/library/books', { title: 'The Jungle Book', copies: 2 });
    ids.book = book.id;
    ids.copy = book.copies[0].id;
    ids.loan = (await create(ownerA, '/api/library/loans', { accessionNo: book.copies[1].accessionNo, studentId: ids.student })).id;
    ids.vehicle = (
      await create(ownerA, '/api/transport/vehicles', {
        registrationNo: `LEA-${run.slice(-4)}`,
        capacity: 10,
        driverName: 'Rafiq Ahmed',
        driverPhone: phone(4),
      })
    ).id;
    ids.route = (await create(ownerA, '/api/transport/routes', { name: 'Route 1', vehicleId: ids.vehicle, monthlyFee: 4000 })).id;
    ids.certificate = (await create(ownerA, '/api/certificates', { studentId: ids.student, type: 'CHARACTER' })).id;

    // HR
    await put(ownerA, `/api/hr/staff/${ids.teacher}`, { designation: 'Teacher', basicSalary: 30000 });
    ids.leave = (await create(teacherA, '/api/hr/leave', { type: 'CASUAL', fromDate: today, toDate: today })).id;
    ids.payroll = (await create(ownerA, '/api/hr/payroll', { period: `${year}-01` })).id;

    // Teaching
    ids.plan = (
      await create(teacherA, '/api/lesson-plans', {
        sectionId: ids.section,
        subjectId: ids.subject,
        weekStart: today,
        topic: 'Fractions',
      })
    ).id;
    await send('post', teacherA, `/api/lesson-plans/${ids.plan}/submit`, {}, 200);
    ids.homework = (
      await create(teacherA, '/api/homework', { sectionId: ids.section, subjectId: ids.subject, title: 'Exercise 1', dueDate: today })
    ).id;
    ids.thread = (await create(teacherA, '/api/chat/threads', { studentId: ids.student, guardianUserId: guardianUser.userId })).id;

    // E-learning
    ids.course = (await create(teacherA, '/api/elearning/courses', { sectionId: ids.section, subjectId: ids.subject })).id;
    ids.unit = (await create(teacherA, `/api/elearning/courses/${ids.course}/units`, { title: 'Algebra' })).id;
    ids.lesson = (await create(teacherA, `/api/elearning/units/${ids.unit}/lessons`, { title: 'Variables', kind: 'TEXT', body: 'x is a number' })).id;
    const quiz = await create(teacherA, '/api/elearning/quizzes', {
      sectionId: ids.section,
      subjectId: ids.subject,
      title: 'Check',
      questions: [{ kind: 'SINGLE', prompt: 'Half of 10?', options: ['2', '5'], correct: [1] }],
    });
    ids.quiz = quiz.id;
    ids.question = quiz.questions[0].id;
    ids.assignment = (
      await create(teacherA, '/api/elearning/assignments', {
        sectionId: ids.section,
        subjectId: ids.subject,
        title: 'Worksheet',
        dueAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        maxPoints: 10,
      })
    ).id;
    ids.live = (
      await create(teacherA, '/api/elearning/live', {
        sectionId: ids.section,
        subjectId: ids.subject,
        startsAt: new Date(Date.now() + 864e5).toISOString(),
      })
    ).id;

    // Pilot kit
    ids.problemReport = (await create(teacherA, '/api/problem-reports', { message: 'The register would not save', page: '/attendance' })).id;
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  it.each(routes.map((r) => [`${r.method.toUpperCase()} ${r.path(new Proxy({}, { get: (_, k) => `:${String(k)}` }))}`, r]))(
    "keeps school A's record from school B: %s",
    async (_name, route) => {
      let req = request(server)[route.method](route.path(ids)).set(ownerB);
      if (route.body) req = req.send(route.body(ids));
      const res = await req;
      expect([403, 404], `${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    },
  );

  it("still answers school A's owner on every GET route", async () => {
    for (const route of routes.filter((r) => r.method === 'get')) {
      const res = await request(server).get(route.path(ids)).set(ownerA);
      expect(res.status, `${route.path(ids)} ${JSON.stringify(res.body)}`).toBe(200);
    }
    // Nothing school B tried changed school A's records.
    const student = await prisma.student.findUniqueOrThrow({ where: { id: ids.student } });
    expect(student.firstName).toBe('Ayesha');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: ids.payment } })).toMatchObject({ reversedAt: null });
    expect(await prisma.campus.count({ where: { id: ids.campus } })).toBe(1);
    expect(await prisma.exam.findUniqueOrThrow({ where: { id: ids.exam } })).toMatchObject({ status: 'PUBLISHED' });
  });
});
