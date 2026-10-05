import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { dayStart, localToday } from '../src/common/dates.js';
import { UserStatusService } from '../src/common/user-status.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

type Headers = Record<string, string>;

// School mode, student logins, the student workspace and the parent learning view,
// with students fenced to their own records and schools to their own data.
describe('Student portal (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const slugs: string[] = [];
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const today = localToday();

  let owner: Headers;
  let teacher: Headers;
  let schoolSlug: string;
  let schoolId: string;
  let campusId: string;
  let yearId: string;
  let sectionA: string;
  let sectionB: string;
  let maths: string;
  let aliId: string;
  let saraId: string;
  let zaraId: string;
  let aliAdmission: string;
  let ali: Headers;
  let sara: Headers;
  let parent: Headers;
  let rivalOwner: Headers;
  let rivalSlug: string;
  let rivalStudentId: string;
  let examId: string;

  async function register(name: string, email: string, mode?: string) {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123', ...(mode ? { mode } : {}) })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return reg.body as { schoolSlug: string; accessToken: string; user: { schoolId: string } };
  }

  async function login(slug: string, loginName: string, password: string, expected = 200) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug: slug, login: loginName, password })
      .expect(expected);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await register(`Portal ${run}`, `portal+${run}@test.pk`, 'HYBRID');
    schoolSlug = reg.schoolSlug;
    schoolId = reg.user.schoolId;
    owner = { Authorization: `Bearer ${reg.accessToken}` };

    campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 5' }).expect(201)
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
    await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: 'Mr Imran', phone: phone(1), password: 'password123', roles: [{ role: 'TEACHER' }] })
      .expect(201);
    teacher = await login(schoolSlug, phone(1), 'password123');

    const addStudent = async (sectionId: string, firstName: string, n: number) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId,
            firstName,
            lastName: 'Khan',
            gender: 'MALE',
            guardians: [{ name: `${firstName}'s father`, phone: phone(n), relation: 'Father' }],
          })
          .expect(201)
      ).body as { id: string; admissionNo: string };
    const a = await addStudent(sectionA, 'Ali', 5);
    aliId = a.id;
    aliAdmission = a.admissionNo;
    saraId = (await addStudent(sectionA, 'Sara', 6)).id;
    zaraId = (await addStudent(sectionB, 'Zara', 7)).id;

    const rival = await register(`Rival ${run}`, `rival+${run}@test.pk`);
    rivalSlug = rival.schoolSlug;
    rivalOwner = { Authorization: `Bearer ${rival.accessToken}` };
    const rivalCampus = (await request(server).get('/api/campuses').set(rivalOwner)).body[0].id;
    const rivalYear = (
      await request(server)
        .post('/api/academic-years')
        .set(rivalOwner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const rivalClass = (
      await request(server).post('/api/classes').set(rivalOwner).send({ campusId: rivalCampus, name: 'Grade 5' })
    ).body.id;
    const rivalSection = (
      await request(server)
        .post(`/api/classes/${rivalClass}/sections`)
        .set(rivalOwner)
        .send({ academicYearId: rivalYear, name: 'A' })
        .expect(201)
    ).body.id;
    rivalStudentId = (
      await request(server)
        .post('/api/students')
        .set(rivalOwner)
        .send({
          sectionId: rivalSection,
          firstName: 'Rival',
          gender: 'MALE',
          guardians: [{ name: 'Rival parent', phone: phone(8), relation: 'Father' }],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  describe('school mode', () => {
    it('registers in the chosen mode and reports it on /auth/me', async () => {
      const me = await request(server).get('/api/auth/me').set(owner).expect(200);
      expect(me.body.school).toMatchObject({ id: schoolId, slug: schoolSlug, mode: 'HYBRID', logoUrl: null });
      expect(me.body.studentId).toBeNull();
      const rivalMe = await request(server).get('/api/auth/me').set(rivalOwner).expect(200);
      expect(rivalMe.body.school.mode).toBe('PHYSICAL');
    });

    it('rejects an unknown mode at sign-up', async () => {
      await request(server)
        .post('/api/auth/register-school')
        .send({ schoolName: 'Bad mode', ownerName: 'Owner', email: `bad+${run}@test.pk`, password: 'password123', mode: 'REMOTE' })
        .expect(400);
    });

    it('lets setup roles change the mode, audited, and nobody else', async () => {
      await request(server).patch('/api/school').set(teacher).send({ mode: 'ONLINE' }).expect(403);
      const res = await request(server).patch('/api/school').set(owner).send({ mode: 'ONLINE' }).expect(200);
      expect(res.body.mode).toBe('ONLINE');
      expect((await request(server).get('/api/school').set(owner)).body.mode).toBe('ONLINE');
      const log = await prisma.auditLog.findFirst({ where: { schoolId, action: 'school.update' }, orderBy: { createdAt: 'desc' } });
      expect(log?.after).toMatchObject({ mode: 'ONLINE' });
      await request(server).patch('/api/school').set(owner).send({ mode: 'HYBRID' }).expect(200);
      await request(server).patch('/api/school').set(owner).send({ mode: 'SPACE' }).expect(400);
    });
  });

  describe('student logins', () => {
    it('creates a login with a one-time temp password; the username is the admission number', async () => {
      await request(server).post(`/api/students/${aliId}/login`).set(teacher).send({}).expect(403);
      const res = await request(server).post(`/api/students/${aliId}/login`).set(owner).send({}).expect(201);
      expect(res.body).toMatchObject({ studentId: aliId, username: aliAdmission.toLowerCase(), created: true, schoolCode: schoolSlug });
      expect(res.body.tempPassword).toMatch(/^[a-z]{4}[2-9]{4}$/);
      // Sign in with the admission number as typed (case does not matter).
      ali = await login(schoolSlug, aliAdmission.toUpperCase(), res.body.tempPassword);
      const me = await request(server).get('/api/auth/me').set(ali).expect(200);
      expect(me.body.roles).toEqual([{ role: 'STUDENT', campusId: null, customRoleId: null }]);
      expect(me.body.studentId).toBe(aliId);
      expect(me.body.school.mode).toBe('HYBRID');
      const profile = await request(server).get(`/api/students/${aliId}`).set(owner).expect(200);
      expect(profile.body.user).toMatchObject({ username: aliAdmission.toLowerCase(), isActive: true });
      const log = await prisma.auditLog.findFirst({ where: { schoolId, action: 'student.login', entityId: aliId } });
      expect(JSON.stringify(log?.after)).not.toContain(res.body.tempPassword);
    });

    it('sets a chosen password without echoing it, and re-issuing keeps one user', async () => {
      const res = await request(server)
        .post(`/api/students/${saraId}/login`)
        .set(owner)
        .send({ password: 'sara-pass-1' })
        .expect(201);
      expect(res.body.tempPassword).toBeNull();
      const again = await request(server)
        .post(`/api/students/${saraId}/login`)
        .set(owner)
        .send({ password: 'sara-pass-2' })
        .expect(201);
      expect(again.body).toMatchObject({ created: false, userId: res.body.userId });
      await login(schoolSlug, res.body.username, 'sara-pass-1', 401);
      sara = await login(schoolSlug, res.body.username, 'sara-pass-2');
    });

    it('bulk-creates logins for a section once and lists existing ones without passwords', async () => {
      await request(server).post('/api/students/logins/bulk').set(teacher).send({ sectionId: sectionB }).expect(403);
      const first = await request(server).post('/api/students/logins/bulk').set(owner).send({ sectionId: sectionB }).expect(201);
      expect(first.body).toMatchObject({ created: 1, existing: 0, section: { id: sectionB, name: 'Grade 5 B' } });
      expect(first.body.logins[0]).toMatchObject({ studentId: zaraId, status: 'created' });
      expect(first.body.logins[0].password).toMatch(/^[a-z]{4}[2-9]{4}$/);
      const second = await request(server).post('/api/students/logins/bulk').set(owner).send({ sectionId: sectionB }).expect(201);
      expect(second.body).toMatchObject({ created: 0, existing: 1 });
      expect(second.body.logins[0].password).toBeNull();
      // Section A: Ali and Sara already have logins.
      const a = await request(server).post('/api/students/logins/bulk').set(owner).send({ sectionId: sectionA }).expect(201);
      expect(a.body).toMatchObject({ created: 0, existing: 2 });
    });

    it('does not reach across schools', async () => {
      await request(server).post(`/api/students/${rivalStudentId}/login`).set(owner).send({}).expect(404);
      await request(server).post('/api/students/logins/bulk').set(rivalOwner).send({ sectionId: sectionA }).expect(404);
      // Ali's username means nothing at the rival school.
      await login(rivalSlug, aliAdmission, 'whatever-123', 401);
    });
  });

  describe('student workspace', () => {
    beforeAll(async () => {
      const now = Date.now();
      // E-school material for both sections (other modules create these through their own APIs).
      const course = await prisma.course.create({
        data: {
          schoolId,
          academicYearId: yearId,
          sectionId: sectionA,
          subjectId: maths,
          title: 'Maths 5A',
          isPublished: true,
          units: {
            create: {
              title: 'Fractions',
              lessons: {
                create: [
                  { title: 'What is a fraction', isPublished: true },
                  { title: 'Adding fractions', isPublished: true },
                  { title: 'Draft lesson', isPublished: false },
                ],
              },
            },
          },
        },
        include: { units: { include: { lessons: { orderBy: { title: 'desc' } } } } },
      });
      const lesson = course.units[0].lessons.find((l) => l.title === 'What is a fraction');
      await prisma.lessonProgress.create({ data: { lessonId: lesson!.id, studentId: aliId } });
      await prisma.liveClass.create({
        data: {
          schoolId,
          sectionId: sectionA,
          subjectId: maths,
          title: 'Fractions live',
          startsAt: new Date(now + 5 * 60_000),
          durationMin: 40,
          joinUrl: 'https://meet.jit.si/SchoolSyncer-secret-room',
        },
      });
      const a1 = await prisma.assignment.create({
        data: {
          schoolId,
          sectionId: sectionA,
          subjectId: maths,
          title: 'Fractions worksheet',
          dueAt: new Date(now + 2 * 86_400_000),
          isPublished: true,
        },
      });
      const a2 = await prisma.assignment.create({
        data: {
          schoolId,
          sectionId: sectionA,
          subjectId: maths,
          title: 'Times tables',
          dueAt: new Date(now - 86_400_000),
          maxPoints: 20,
          isPublished: true,
        },
      });
      await prisma.submission.create({
        data: { assignmentId: a2.id, studentId: aliId, body: 'Done', status: 'GRADED', points: 18, feedback: 'Well done' },
      });
      await prisma.submission.create({
        data: { assignmentId: a1.id, studentId: saraId, body: 'Sara work' },
      });
      await prisma.assignment.create({
        data: { schoolId, sectionId: sectionB, subjectId: maths, title: 'Section B only', dueAt: new Date(now + 86_400_000), isPublished: true },
      });
      await prisma.assignment.create({
        data: { schoolId, sectionId: sectionA, subjectId: maths, title: 'Unpublished', dueAt: new Date(now + 86_400_000) },
      });
      const quiz = await prisma.quiz.create({
        data: { schoolId, sectionId: sectionA, subjectId: maths, title: 'Fractions quiz', isPublished: true, attemptsAllowed: 2 },
      });
      await prisma.quizAttempt.create({
        data: { quizId: quiz.id, studentId: aliId, submittedAt: new Date(), score: 4, maxScore: 5 },
      });
      await prisma.quiz.create({
        data: { schoolId, sectionId: sectionA, subjectId: maths, title: 'Closed quiz', isPublished: true, closesAt: new Date(now - 60_000) },
      });

      for (const [title, audience, targetId] of [
        ['Whole school', 'SCHOOL', null],
        ['For 5A', 'SECTION', sectionA],
        ['For 5B', 'SECTION', sectionB],
        ['Other campus', 'CAMPUS', 'some-other-campus'],
      ] as const) {
        await prisma.announcement.create({ data: { schoolId, title, body: `${title} notice`, audience, targetId } });
      }

      const session = await prisma.attendanceSession.create({
        data: { schoolId, sectionId: sectionA, date: dayStart(today) },
      });
      await prisma.attendanceRecord.createMany({
        data: [
          { sessionId: session.id, studentId: aliId, status: 'PRESENT' },
          { sessionId: session.id, studentId: saraId, status: 'ABSENT' },
        ],
      });

      const exam = await prisma.exam.create({
        data: { schoolId, academicYearId: yearId, name: `Mid-term ${run}`, status: 'PUBLISHED', publishedAt: new Date() },
      });
      examId = exam.id;
      const draft = await prisma.exam.create({
        data: { schoolId, academicYearId: yearId, name: `Draft ${run}` },
      });
      const result = (studentId: string, percent: number, position: number, id = exam.id) => ({
        examId: id,
        studentId,
        sectionId: sectionA,
        obtained: percent,
        maxTotal: 100,
        percent,
        grade: percent > 80 ? 'A' : 'B',
        position,
        passed: true,
        subjects: [{ subject: 'Maths', max: 100, pass: 33, marks: percent, absent: false, passed: true }],
      });
      await prisma.examResult.createMany({
        data: [result(aliId, 85, 1), result(saraId, 72, 2), result(aliId, 50, 2, draft.id)],
      });
    });

    it('returns the signed-in student only, with section, class and school mode', async () => {
      const me = await request(server).get('/api/student/me').set(ali).expect(200);
      expect(me.body).toMatchObject({
        id: aliId,
        name: 'Ali Khan',
        admissionNo: aliAdmission,
        username: aliAdmission.toLowerCase(),
        section: { id: sectionA, name: 'A' },
        class: { name: 'Grade 5' },
        campus: { id: campusId },
        school: { mode: 'HYBRID' },
      });
      expect((await request(server).get('/api/student/me').set(sara).expect(200)).body.id).toBe(saraId);
    });

    it("aggregates today: live classes, due work, open quizzes and my section's notices", async () => {
      const res = await request(server).get('/api/student/today').set(ali).expect(200);
      expect(res.body.date).toBe(today);
      expect(res.body.section).toMatchObject({ id: sectionA, name: 'Grade 5 A' });
      expect(res.body.liveClasses).toHaveLength(1);
      expect(res.body.liveClasses[0]).toMatchObject({ title: 'Fractions live', state: 'upcoming', canJoin: true, joined: false });
      // The join link only comes from the join endpoint.
      expect(JSON.stringify(res.body)).not.toContain('secret-room');
      expect(res.body.assignmentsDue.map((a: { title: string }) => a.title)).toEqual(['Fractions worksheet']);
      expect(res.body.assignmentsDue[0].status).toBe('pending');
      expect(res.body.quizzesOpen).toHaveLength(1);
      expect(res.body.quizzesOpen[0]).toMatchObject({ title: 'Fractions quiz', attemptsUsed: 1, attemptsLeft: 1 });
      const titles = res.body.announcements.map((a: { title: string }) => a.title).sort();
      expect(titles).toEqual(['For 5A', 'Whole school']);

      // Sara sees her own submission, not Ali's.
      const saraToday = await request(server).get('/api/student/today').set(sara).expect(200);
      expect(saraToday.body.assignmentsDue[0].status).toBe('submitted');
      expect(saraToday.body.quizzesOpen[0].attemptsUsed).toBe(0);
    });

    it('shows my attendance only, and validates the month', async () => {
      const month = today.slice(0, 7);
      const res = await request(server).get(`/api/student/attendance?month=${month}`).set(ali).expect(200);
      expect(res.body.days).toEqual([{ date: today, status: 'PRESENT', note: null }]);
      expect(res.body.summary).toMatchObject({ present: 1, absent: 0, total: 1, percent: 100 });
      const saraRes = await request(server).get('/api/student/attendance').set(sara).expect(200);
      expect(saraRes.body.days).toEqual([{ date: today, status: 'ABSENT', note: null }]);
      await request(server).get('/api/student/attendance?month=2026-13').set(ali).expect(400);
    });

    it('shows my published results, my report card, and graded work', async () => {
      const res = await request(server).get('/api/student/results').set(ali).expect(200);
      expect(res.body.exams).toHaveLength(1);
      expect(res.body.exams[0]).toMatchObject({ examId, percent: 85, position: 1, reportCardApi: `/student/results/${examId}` });
      expect(res.body.assignments).toHaveLength(1);
      expect(res.body.assignments[0]).toMatchObject({ title: 'Times tables', status: 'graded', points: 18, maxPoints: 20 });
      expect(res.body.quizzes[0]).toMatchObject({ title: 'Fractions quiz', best: { score: 4, maxScore: 5, percent: 80 } });
      expect(res.body.courses[0]).toMatchObject({ title: 'Maths 5A', lessons: 2, completed: 1, percent: 50 });

      const card = await request(server).get(`/api/student/results/${examId}`).set(ali).expect(200);
      expect(card.body).toMatchObject({ student: { id: aliId, class: 'Grade 5 A' }, percent: 85, outOf: 2 });
      expect(card.body.gradeScale.length).toBeGreaterThan(0);
      const saraCard = await request(server).get(`/api/student/results/${examId}`).set(sara).expect(200);
      expect(saraCard.body.student.id).toBe(saraId);
      expect(saraCard.body.percent).toBe(72);
    });

    it('shows library loans while the school runs a campus, and hides them for online schools', async () => {
      const res = await request(server).get('/api/student/library').set(ali).expect(200);
      expect(res.body).toMatchObject({ available: true, loans: [], finesDue: 0 });
      await request(server).patch('/api/school').set(owner).send({ mode: 'ONLINE' }).expect(200);
      expect((await request(server).get('/api/student/library').set(ali).expect(200)).body.available).toBe(false);
      await request(server).patch('/api/school').set(owner).send({ mode: 'HYBRID' }).expect(200);
    });

    it('lists the notices that reach me', async () => {
      const res = await request(server).get('/api/student/announcements').set(ali).expect(200);
      expect(res.body.map((a: { title: string }) => a.title).sort()).toEqual(['For 5A', 'Whole school']);
      const zara = await prisma.student.findUniqueOrThrow({ where: { id: zaraId }, select: { userId: true } });
      expect(zara.userId).toBeTruthy();
    });

    it('keeps students out of staff and parent endpoints, and staff out of the student workspace', async () => {
      await request(server).get('/api/students').set(ali).expect(403);
      await request(server).get(`/api/students/${saraId}`).set(ali).expect(403);
      await request(server).post(`/api/students/${saraId}/login`).set(ali).send({}).expect(403);
      await request(server).patch('/api/school').set(ali).send({ mode: 'ONLINE' }).expect(403);
      await request(server).get('/api/parent/children').set(ali).expect(403);
      await request(server).get(`/api/parent/children/${saraId}/learning`).set(ali).expect(403);
      await request(server).get('/api/student/me').set(owner).expect(403);
      await request(server).get('/api/student/today').set(teacher).expect(403);
    });

    it('a disabled login stops working', async () => {
      await request(server).delete(`/api/students/${saraId}/login`).set(teacher).expect(403);
      await request(server).delete(`/api/students/${saraId}/login`).set(owner).expect(200);
      const username = (await prisma.user.findFirstOrThrow({ where: { studentProfile: { id: saraId } } })).username!;
      await login(schoolSlug, username, 'sara-pass-2', 401);
      // Tokens issued before stop at once, not after the status cache expires.
      await request(server).get('/api/student/me').set(sara).expect(401);
      await request(server).post(`/api/students/${saraId}/login`).set(owner).send({ password: 'sara-pass-3' }).expect(201);
      sara = await login(schoolSlug, username, 'sara-pass-3');
    });

    it('a student who leaves loses the workspace and the login', async () => {
      await request(server).post(`/api/students/${zaraId}/login`).set(owner).send({ password: 'zara-pass-1' }).expect(201);
      const username = (await prisma.user.findFirstOrThrow({ where: { studentProfile: { id: zaraId } } })).username!;
      const zara = await login(schoolSlug, username, 'zara-pass-1');
      await request(server).get('/api/student/me').set(zara).expect(200);
      await request(server).patch(`/api/students/${zaraId}`).set(owner).send({ status: 'LEFT' }).expect(200);
      await request(server).get('/api/student/me').set(zara).expect(401);
      await login(schoolSlug, username, 'zara-pass-1', 401);
      // Even a login switched back on directly cannot see a former student's workspace.
      await prisma.user.updateMany({ where: { username, schoolId }, data: { isActive: true } });
      app.get(UserStatusService).forget();
      const again = await login(schoolSlug, username, 'zara-pass-1');
      await request(server).get('/api/student/me').set(again).expect(404);
      await request(server).get('/api/student/courses').set(again).expect(404);
    });

    it('bulk logins report a username clash per student and still issue the rest', async () => {
      const hina = (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId: sectionB,
            firstName: 'Hina',
            lastName: 'Khan',
            gender: 'FEMALE',
            guardians: [{ name: "Hina's father", phone: phone(3), relation: 'Father' }],
          })
          .expect(201)
      ).body as { id: string; admissionNo: string };
      const zainab = (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId: sectionB,
            firstName: 'Zainab',
            lastName: 'Khan',
            gender: 'FEMALE',
            guardians: [{ name: "Zainab's father", phone: phone(4), relation: 'Father' }],
          })
          .expect(201)
      ).body as { id: string; admissionNo: string };
      await prisma.user.create({
        data: { schoolId, name: 'Someone else', username: hina.admissionNo.toLowerCase(), passwordHash: 'x' },
      });
      const res = await request(server).post('/api/students/logins/bulk').set(owner).send({ sectionId: sectionB }).expect(201);
      expect(res.body).toMatchObject({ created: 1, conflicts: 1 });
      const rows = res.body.logins as { studentId: string; status: string; password: string | null }[];
      expect(rows.find((r) => r.studentId === hina.id)).toMatchObject({ status: 'conflict', password: null });
      expect(rows.find((r) => r.studentId === zainab.id)?.password).toMatch(/^[a-z]{4}[2-9]{4}$/);
    });
  });

  describe('parent learning view', () => {
    beforeAll(async () => {
      // Ali's father gets a parent login (the invite sends the password by WhatsApp, so set one here).
      await request(server)
        .post(`/api/students/${aliId}/guardians/${(await prisma.guardian.findFirstOrThrow({ where: { schoolId, phone: phone(5) } })).id}/invite`)
        .set(owner)
        .expect(201);
      await prisma.user.update({
        where: { schoolId_phone: { schoolId, phone: phone(5) } },
        data: { passwordHash: await bcrypt.hash('password123', 4) },
      });
      parent = await login(schoolSlug, phone(5), 'password123');
    });

    it("returns my child's courses, live classes, assignments and quiz scores", async () => {
      const res = await request(server).get(`/api/parent/children/${aliId}/learning`).set(parent).expect(200);
      expect(res.body.student).toMatchObject({ id: aliId, name: 'Ali Khan', class: 'Grade 5 A' });
      expect(res.body.courses).toEqual([
        expect.objectContaining({ title: 'Maths 5A', subject: 'Maths', lessons: 2, completed: 1, percent: 50 }),
      ]);
      expect(res.body.liveClasses).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain('secret-room');
      const byTitle = Object.fromEntries(res.body.assignments.map((a: { title: string }) => [a.title, a]));
      expect(Object.keys(byTitle).sort()).toEqual(['Fractions worksheet', 'Times tables']);
      expect(byTitle['Times tables']).toMatchObject({ status: 'graded', points: 18, feedback: 'Well done' });
      expect(byTitle['Fractions worksheet']).toMatchObject({ status: 'pending', points: null });
      const quizzes = Object.fromEntries(res.body.quizzes.map((q: { title: string }) => [q.title, q]));
      expect(quizzes['Fractions quiz']).toMatchObject({ submitted: 1, best: { percent: 80 }, isOpen: true });
      expect(quizzes['Closed quiz']).toMatchObject({ submitted: 0, isOpen: false });
    });

    it("refuses other people's children and other schools' students", async () => {
      await request(server).get(`/api/parent/children/${saraId}/learning`).set(parent).expect(404);
      await request(server).get(`/api/parent/children/${rivalStudentId}/learning`).set(parent).expect(404);
      await request(server).get(`/api/parent/children/${aliId}/learning`).set(owner).expect(403);
      await request(server).get(`/api/parent/children/${aliId}/learning`).set(rivalOwner).expect(403);
    });
  });
});
