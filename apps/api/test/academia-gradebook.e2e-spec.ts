import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

// Gradebook matrix and the assignment grade upsert (module D), parent fee
// invoices (module C) and parent attendance history: happy paths, role and
// teaching-scope denials, guardian checks and tenant isolation.
describe('Gradebook, parent invoices and parent attendance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const slugs: string[] = [];
  const phone = (n: number) => `035${run.slice(-7)}${n}`;
  const day = (offset: number) => {
    const d = new Date(`${localToday()}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  };
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  let schoolId: string;
  let schoolSlug: string;
  let owner: Headers;
  let teacher: Headers;
  let otherTeacher: Headers;
  let classTeacher: Headers;
  let accountant: Headers;
  let parent: Headers;
  let rivalOwner: Headers;
  let sectionA: string;
  let sectionB: string;
  let maths: string;
  let english: string;
  let ayeshaId: string;
  let hinaId: string;
  let bilalId: string;
  let examId: string;
  let assignmentId: string;
  let quizId: string;
  let ayeshaOverdue: string;
  let ayeshaPaid: string;
  let bilalInvoice: string;
  let rivalInvoice: string;
  let rivalStudentId: string;

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
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
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

    const reg = await register(`Gradebook ${run}`, `gradebook+${run}@test.pk`);
    schoolSlug = reg.schoolSlug;
    schoolId = reg.user.schoolId;
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
    const otherTeacherId = await makeUser(2, 'TEACHER');
    const classTeacherId = await makeUser(3, 'TEACHER');
    await makeUser(4, 'ACCOUNTANT');

    const section = async (name: string, ct?: string) =>
      (
        await request(server)
          .post(`/api/classes/${classId}/sections`)
          .set(owner)
          .send({ academicYearId: yearId, name, classTeacherId: ct })
          .expect(201)
      ).body.id as string;
    sectionA = await section('A', classTeacherId);
    sectionB = await section('B');
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
    for (const [s, t] of [
      [sectionA, teacherId],
      [sectionB, otherTeacherId],
    ]) {
      await request(server)
        .put(`/api/classes/sections/${s}/subjects`)
        .set(owner)
        .send({
          subjects: [
            { subjectId: maths, teacherId: t },
            { subjectId: english },
          ],
        })
        .expect(200);
    }
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));
    classTeacher = await loginAs(phone(3));
    accountant = await loginAs(phone(4));

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
            lastName: 'Khan',
            gender: 'FEMALE',
            guardians: [
              {
                name: `${firstName}'s father`,
                phone: phone(n),
                relation: 'Father',
              },
            ],
          })
          .expect(201)
      ).body.id as string;
    ayeshaId = await addStudent(sectionA, 'Ayesha', 5);
    hinaId = await addStudent(sectionA, 'Hina', 6);
    bilalId = await addStudent(sectionB, 'Bilal', 7);

    // Ayesha's father gets a parent login.
    const guardian = await prisma.guardian.findFirstOrThrow({
      where: { schoolId, phone: phone(5) },
    });
    await request(server)
      .post(`/api/students/${ayeshaId}/guardians/${guardian.id}/invite`)
      .set(owner)
      .expect(201);
    await prisma.user.update({
      where: { schoolId_phone: { schoolId, phone: phone(5) } },
      data: { passwordHash: await bcrypt.hash('password123', 4) },
    });
    parent = await loginAs(phone(5));

    // School grade bands: A 80+, B 60+, F below.
    await request(server)
      .put('/api/exams/grade-bands')
      .set(owner)
      .send({
        bands: [
          { grade: 'A', minPercent: 80 },
          { grade: 'B', minPercent: 60 },
          { grade: 'F', minPercent: 0 },
        ],
      })
      .expect(200);

    // Midterm: Maths paper out of 50. Ayesha 40, Hina absent.
    examId = (
      await request(server)
        .post('/api/exams')
        .set(owner)
        .send({
          name: 'Midterm',
          academicYearId: yearId,
          startsOn: '2026-09-15',
        })
        .expect(201)
    ).body.id;
    await request(server)
      .put(`/api/exams/${examId}/papers`)
      .set(owner)
      .send({
        papers: [
          {
            classId,
            subjectId: maths,
            maxMarks: 50,
            passMarks: 17,
            date: '2026-09-16',
          },
        ],
      })
      .expect(200);
    await request(server)
      .put(`/api/exams/${examId}/marks`)
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        entries: [
          { studentId: ayeshaId, marks: 40 },
          { studentId: hinaId, marks: null, isAbsent: true },
        ],
      })
      .expect(200);

    // A published assignment out of 20 (nobody submitted) and a draft that must not show.
    assignmentId = (
      await request(server)
        .post('/api/elearning/assignments')
        .set(teacher)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          title: 'Fractions worksheet',
          dueAt: '2026-09-20T10:00:00.000Z',
          maxPoints: 20,
          isPublished: true,
        })
        .expect(201)
    ).body.id;
    await request(server)
      .post('/api/elearning/assignments')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Draft task',
        dueAt: '2026-09-25T10:00:00.000Z',
      })
      .expect(201);

    // A published quiz out of 10: Ayesha's best attempt is 8.
    const quiz = await prisma.quiz.create({
      data: {
        schoolId,
        sectionId: sectionA,
        subjectId: maths,
        title: 'Decimals quiz',
        isPublished: true,
        attemptsAllowed: 2,
        closesAt: new Date('2026-09-28T10:00:00.000Z'),
        questions: {
          create: [
            {
              kind: 'SINGLE',
              prompt: '0.5 + 0.25?',
              options: ['0.75', '0.7'],
              correct: [0],
              points: 10,
            },
          ],
        },
      },
    });
    quizId = quiz.id;
    await prisma.quizAttempt.createMany({
      data: [
        {
          quizId,
          studentId: ayeshaId,
          submittedAt: new Date('2026-09-27T10:00:00Z'),
          score: 5,
          maxScore: 10,
        },
        {
          quizId,
          studentId: ayeshaId,
          submittedAt: new Date('2026-09-27T11:00:00Z'),
          score: 8,
          maxScore: 10,
        },
      ],
    });

    // Invoices: Ayesha has an overdue part-paid one and a paid one; Bilal (another family) has one.
    const invoice = (
      studentId: string,
      period: string,
      data: Record<string, unknown>,
    ) =>
      prisma.invoice.create({
        data: {
          schoolId,
          studentId,
          voucherNo: `${period.replace('-', '')}-${run.slice(-6)}${studentId.slice(-3)}`,
          period,
          ...(data as { dueDate: Date; total: number }),
        },
      });
    ayeshaOverdue = (
      await invoice(ayeshaId, '2026-09', {
        dueDate: day(-5),
        total: 8700,
        paid: 2000,
        status: 'PARTIAL',
        lines: {
          create: [
            { description: 'Tuition fee', amount: 8000 },
            { description: 'Sports fee', amount: 1500 },
            { description: 'Tuition fee concession', amount: -800 },
          ],
        },
      })
    ).id;
    ayeshaPaid = (
      await invoice(ayeshaId, '2026-08', {
        dueDate: day(-40),
        total: 8000,
        paid: 8000,
        status: 'PAID',
        lines: { create: [{ description: 'Tuition fee', amount: 8000 }] },
      })
    ).id;
    bilalInvoice = (
      await invoice(bilalId, '2026-09', { dueDate: day(5), total: 8000 })
    ).id;

    // A rival school with its own student and invoice.
    const rival = await register(
      `Rival ${run}`,
      `rival-gradebook+${run}@test.pk`,
    );
    rivalOwner = { Authorization: `Bearer ${rival.accessToken}` };
    const rivalCampus = (
      await request(server).get('/api/campuses').set(rivalOwner)
    ).body[0].id;
    rivalStudentId = (
      await prisma.student.create({
        data: {
          schoolId: rival.user.schoolId,
          campusId: rivalCampus,
          admissionNo: `R-${run.slice(-5)}`,
          firstName: 'Rival',
          gender: 'MALE',
        },
      })
    ).id;
    rivalInvoice = (
      await prisma.invoice.create({
        data: {
          schoolId: rival.user.schoolId,
          studentId: rivalStudentId,
          voucherNo: `202609-R${run.slice(-8)}`,
          period: '2026-09',
          dueDate: day(5),
          total: 5000,
        },
      })
    ).id;

    // Attendance for section A: two days.
    for (const [offset, ayesha] of [
      [-2, 'PRESENT'],
      [-1, 'LATE'],
    ] as const) {
      await request(server)
        .put('/api/attendance/sheet')
        .set(teacher)
        .send({
          sectionId: sectionA,
          date: iso(day(offset)),
          records: [
            { studentId: ayeshaId, status: ayesha },
            { studentId: hinaId, status: 'ABSENT' },
          ],
        })
        .expect(200);
    }
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  describe('gradebook', () => {
    const gradebook = (h: Headers, sectionId = sectionA, subjectId = maths) =>
      request(server)
        .get('/api/gradebook')
        .query({ sectionId, subjectId })
        .set(h);

    it('builds the matrix with exam, assignment and quiz columns, overall % and letter grades', async () => {
      const res = await gradebook(teacher).expect(200);
      const { columns, rows, gradeBands, classAverage } = res.body;
      expect(res.body.section).toMatchObject({
        id: sectionA,
        name: 'Grade 8 A',
      });
      expect(res.body.subject).toEqual({ id: maths, name: 'Maths' });
      expect(gradeBands.map((b: { grade: string }) => b.grade)).toEqual([
        'A',
        'B',
        'F',
      ]);
      expect(columns).toMatchObject([
        {
          key: expect.stringMatching(/^exam:/),
          kind: 'EXAM',
          refId: examId,
          title: 'Midterm',
          maxPoints: 50,
          date: '2026-09-16',
          editable: true,
          examStatus: 'DRAFT',
        },
        {
          key: `assignment:${assignmentId}`,
          kind: 'ASSIGNMENT',
          refId: assignmentId,
          title: 'Fractions worksheet',
          maxPoints: 20,
          date: '2026-09-20',
          editable: true,
        },
        {
          key: `quiz:${quizId}`,
          kind: 'QUIZ',
          refId: quizId,
          maxPoints: 10,
          date: '2026-09-28',
          editable: false,
        },
      ]);
      const [exam, assignment, quiz] = columns.map(
        (c: { key: string }) => c.key,
      );
      const ayesha = rows.find(
        (r: { studentId: string }) => r.studentId === ayeshaId,
      );
      const hina = rows.find(
        (r: { studentId: string }) => r.studentId === hinaId,
      );
      expect(rows).toHaveLength(2);
      expect(ayesha).toMatchObject({
        name: 'Ayesha Khan',
        overallPercent: 80,
        letterGrade: 'A',
      });
      expect(ayesha.cells[exam]).toEqual({
        score: 40,
        max: 50,
        status: 'graded',
        editable: true,
      });
      expect(ayesha.cells[assignment]).toEqual({
        score: null,
        max: 20,
        status: 'missing',
        editable: true,
      });
      expect(ayesha.cells[quiz]).toEqual({
        score: 8,
        max: 10,
        status: 'graded',
        editable: false,
      });
      expect(hina).toMatchObject({ overallPercent: 0, letterGrade: 'F' });
      expect(hina.cells[exam]).toMatchObject({ score: 0, status: 'absent' });
      expect(classAverage.overallPercent).toBe(40);
    });

    it('grades an assignment from the gradebook, creating the submission when there is none', async () => {
      const put = (h: Headers, studentId: string, points: number) =>
        request(server)
          .put(`/api/elearning/assignments/${assignmentId}/grades/${studentId}`)
          .set(h)
          .send({ points });
      const created = await put(teacher, hinaId, 15).expect(200);
      expect(created.body).toMatchObject({
        studentId: hinaId,
        points: 15,
        status: 'GRADED',
        created: true,
        isLate: false,
      });
      const updated = await put(teacher, hinaId, 18).expect(200);
      expect(updated.body).toMatchObject({
        id: created.body.id,
        points: 18,
        created: false,
      });
      await put(teacher, hinaId, 21).expect(400);
      await put(teacher, bilalId, 10).expect(404);
      await put(otherTeacher, ayeshaId, 10).expect(404);
      await put(accountant, ayeshaId, 10).expect(403);
      await put(parent, ayeshaId, 10).expect(403);
      await put(rivalOwner, ayeshaId, 10).expect(404);

      const res = await gradebook(teacher).expect(200);
      const hina = res.body.rows.find(
        (r: { studentId: string }) => r.studentId === hinaId,
      );
      expect(hina.cells[`assignment:${assignmentId}`]).toMatchObject({
        score: 18,
        status: 'graded',
      });
      expect(hina.overallPercent).toBe(25.7); // (0 + 18) / (50 + 20)
    });

    it('locks exam cells once results are published, and for a class teacher who does not teach the subject', async () => {
      const ct = await gradebook(classTeacher).expect(200);
      expect(
        ct.body.columns.find((c: { kind: string }) => c.kind === 'EXAM')
          .editable,
      ).toBe(false);
      expect(
        ct.body.columns.find((c: { kind: string }) => c.kind === 'ASSIGNMENT')
          .editable,
      ).toBe(true);

      await prisma.exam.update({
        where: { id: examId },
        data: { status: 'PUBLISHED' },
      });
      try {
        const res = await gradebook(teacher).expect(200);
        const exam = res.body.columns.find(
          (c: { kind: string }) => c.kind === 'EXAM',
        );
        expect(exam).toMatchObject({
          editable: false,
          examStatus: 'PUBLISHED',
        });
        expect(res.body.rows[0].cells[exam.key].editable).toBe(false);
      } finally {
        await prisma.exam.update({
          where: { id: examId },
          data: { status: 'DRAFT' },
        });
      }
    });

    it('lists only the sections and subjects a teacher can open', async () => {
      const mine = await request(server)
        .get('/api/gradebook/sections')
        .set(teacher)
        .expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({
          id: sectionA,
          name: 'Grade 8 A',
          subjects: [{ id: maths, name: 'Maths', teachesIt: true }],
        }),
      ]);
      const ct = await request(server)
        .get('/api/gradebook/sections')
        .set(classTeacher)
        .expect(200);
      expect(ct.body).toHaveLength(1);
      expect(ct.body[0]).toMatchObject({ id: sectionA, isClassTeacher: true });
      expect(
        ct.body[0].subjects.map((s: { name: string }) => s.name).sort(),
      ).toEqual(['English', 'Maths']);
      const all = await request(server)
        .get('/api/gradebook/sections')
        .set(owner)
        .expect(200);
      expect(all.body.map((s: { id: string }) => s.id).sort()).toEqual(
        [sectionA, sectionB].sort(),
      );
    });

    it('refuses other teachers, other roles and other schools', async () => {
      await gradebook(otherTeacher).expect(403);
      await gradebook(teacher, sectionA, english).expect(403);
      await gradebook(teacher, sectionB).expect(403);
      await gradebook(classTeacher, sectionA, english).expect(200);
      await gradebook(accountant).expect(403);
      await gradebook(parent).expect(403);
      await gradebook(rivalOwner).expect(404);
      await gradebook(owner, 'nope').expect(404);
      // Missing params are a validation error, not a missing section.
      await request(server)
        .get('/api/gradebook')
        .query({ sectionId: sectionA })
        .set(owner)
        .expect(400);
      // A section belongs to one year; another year's exams are refused.
      await request(server)
        .get('/api/gradebook')
        .query({ sectionId: sectionA, subjectId: maths, academicYearId: 'x' })
        .set(owner)
        .expect(400);
      await request(server)
        .get('/api/gradebook/sections')
        .set(accountant)
        .expect(403);
      expect(
        (
          await request(server)
            .get('/api/gradebook/sections')
            .set(rivalOwner)
            .expect(200)
        ).body,
      ).toEqual([]);
    });
  });

  describe('parent invoices', () => {
    it("lists every invoice of my children with status lozenges and what's due", async () => {
      const res = await request(server)
        .get('/api/parent/invoices')
        .set(parent)
        .expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        ayeshaOverdue,
        ayeshaPaid,
      ]);
      expect(res.body.items[0]).toMatchObject({
        period: '2026-09',
        status: 'PARTIAL',
        displayStatus: 'OVERDUE',
        balance: 6700,
        student: { id: ayeshaId, name: 'Ayesha Khan', className: 'Grade 8 A' },
      });
      expect(res.body.items[1]).toMatchObject({
        displayStatus: 'PAID',
        balance: 0,
        totalDue: 0,
      });
      expect(res.body.summary).toMatchObject({
        overdueCount: 1,
        paidCount: 1,
        pendingCount: 0,
      });
    });

    it('shows one invoice with its breakdown, only to a guardian of that child', async () => {
      const res = await request(server)
        .get(`/api/parent/invoices/${ayeshaOverdue}`)
        .set(parent)
        .expect(200);
      expect(res.body).toMatchObject({
        id: ayeshaOverdue,
        displayStatus: 'OVERDUE',
        school: { name: `Gradebook ${run}` },
        student: { id: ayeshaId },
        breakdown: {
          subtotal: 9500,
          discounts: 800,
          total: 8700,
          paid: 2000,
          balance: 6700,
        },
      });
      expect(res.body.lines).toHaveLength(3);
      expect(res.body.school.lateFeePerDay).toBeUndefined();

      await request(server)
        .get(`/api/parent/invoices/${bilalInvoice}`)
        .set(parent)
        .expect(404);
      await request(server)
        .get(`/api/parent/invoices/${rivalInvoice}`)
        .set(parent)
        .expect(404);
      await request(server).get('/api/parent/invoices').set(owner).expect(403);
      await request(server)
        .get(`/api/parent/invoices/${ayeshaOverdue}`)
        .set(accountant)
        .expect(403);
      await request(server)
        .get(`/api/parent/invoices/${ayeshaOverdue}`)
        .set(rivalOwner)
        .expect(403);
    });
  });

  describe('parent attendance history', () => {
    it("returns my child's recorded days, totals and a monthly table", async () => {
      const res = await request(server)
        .get(`/api/parent/children/${ayeshaId}/attendance`)
        .set(parent)
        .expect(200);
      expect(res.body.student).toMatchObject({
        id: ayeshaId,
        className: 'Grade 8 A',
      });
      expect(res.body.to).toBe(localToday());
      expect(res.body.days).toEqual([
        { date: iso(day(-2)), status: 'PRESENT', note: null },
        { date: iso(day(-1)), status: 'LATE', note: null },
      ]);
      expect(res.body.summary).toEqual({
        present: 1,
        absent: 0,
        late: 1,
        leave: 0,
        total: 2,
        rate: 100,
      });
      expect(
        res.body.months.reduce(
          (s: number, m: { total: number }) => s + m.total,
          0,
        ),
      ).toBe(2);

      const narrow = await request(server)
        .get(`/api/parent/children/${ayeshaId}/attendance`)
        .query({ from: iso(day(-1)), to: iso(day(-1)) })
        .set(parent)
        .expect(200);
      expect(narrow.body.days).toHaveLength(1);
    });

    it('validates the range and refuses other children, roles and schools', async () => {
      const url = `/api/parent/children/${ayeshaId}/attendance`;
      await request(server)
        .get(url)
        .query({ from: '2026-10-05', to: '2026-10-01' })
        .set(parent)
        .expect(400);
      await request(server)
        .get(url)
        .query({ from: '2024-01-01', to: '2026-01-01' })
        .set(parent)
        .expect(400);
      await request(server)
        .get(url)
        .query({ from: 'yesterday' })
        .set(parent)
        .expect(400);
      await request(server)
        .get(url)
        .query({ from: '2026-02-30', to: '2026-03-10' })
        .set(parent)
        .expect(400);
      await request(server)
        .get(`/api/parent/children/${hinaId}/attendance`)
        .set(parent)
        .expect(404);
      await request(server)
        .get(`/api/parent/children/${rivalStudentId}/attendance`)
        .set(parent)
        .expect(404);
      await request(server).get(url).set(owner).expect(403);
      await request(server).get(url).set(teacher).expect(403);
      await request(server).get(url).set(rivalOwner).expect(403);
    });
  });
});
