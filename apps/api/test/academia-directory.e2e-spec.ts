import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, dayStart, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

const daysAfter = (iso: string, days: number) => daysBefore(iso, -days);

// Attendance matrix (Module A) and the student directory with its drawer data (Module B).
describe('Attendance matrix and student directory (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `033${run.slice(-7)}${n}`;
  const today = localToday();
  // Three consecutive days early in a month well inside the last 26 weeks.
  const month = daysBefore(today, 40).slice(0, 7);
  const d1 = `${month}-01`;
  const d2 = `${month}-02`;
  const d3 = `${month}-03`;

  const slugs: string[] = [];
  let schoolId: string;
  let owner: Headers;
  let teacher: Headers;
  let accountant: Headers;
  let northPrincipal: Headers;
  let otherOwner: Headers;
  let sectionA: string;
  let sectionB: string;
  let classId: string;
  let yearId: string;
  const ids: Record<
    'ahmed' | 'sana' | 'bilal' | 'hira' | 'north' | 'stranger',
    string
  > = {
    ahmed: '',
    sana: '',
    bilal: '',
    hira: '',
    north: '',
    stranger: '',
  };
  let otherSection: string;

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
    return {
      slug: reg.body.schoolSlug as string,
      headers: { Authorization: `Bearer ${reg.body.accessToken}` },
    };
  }

  async function loginAs(schoolSlug: string, login: string) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password: 'password123' })
      .expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  async function setupSchool(headers: Headers, className: string) {
    const campusId = (await request(server).get('/api/campuses').set(headers))
      .body[0].id as string;
    const year = (
      await request(server)
        .post('/api/academic-years')
        .set(headers)
        .send({
          name: '2026-27',
          startsOn: daysBefore(today, 300),
          endsOn: daysAfter(today, 60),
          isCurrent: true,
        })
        .expect(201)
    ).body.id as string;
    const cls = (
      await request(server)
        .post('/api/classes')
        .set(headers)
        .send({ campusId, name: className })
        .expect(201)
    ).body.id as string;
    const section = async (name: string) =>
      (
        await request(server)
          .post(`/api/classes/${cls}/sections`)
          .set(headers)
          .send({ academicYearId: year, name })
          .expect(201)
      ).body.id as string;
    return { campusId, year, cls, section };
  }

  async function admit(
    headers: Headers,
    sectionId: string,
    firstName: string,
    lastName: string,
    guardianPhone: string,
  ) {
    return (
      await request(server)
        .post('/api/students')
        .set(headers)
        .send({
          sectionId,
          firstName,
          lastName,
          gender: 'MALE',
          guardians: [
            {
              name: `${lastName} Sahib`,
              phone: guardianPhone,
              relation: 'Father',
            },
          ],
        })
        .expect(201)
    ).body.id as string;
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

    const main = await register(`Directory ${run}`, `dir+${run}@test.pk`);
    owner = main.headers;
    const s = await setupSchool(owner, 'Grade 6');
    yearId = s.year;
    classId = s.cls;
    sectionA = await s.section('A');
    sectionB = await s.section('B');
    schoolId = (
      await prisma.academicYear.findUniqueOrThrow({ where: { id: yearId } })
    ).schoolId;

    const maths = (
      await request(server)
        .post('/api/subjects')
        .set(owner)
        .send({ name: 'Maths' })
        .expect(201)
    ).body.id;
    const english = (
      await request(server)
        .post('/api/subjects')
        .set(owner)
        .send({ name: 'English' })
        .expect(201)
    ).body.id;
    const user = async (
      n: number,
      roles: { role: string; campusId?: string }[],
    ) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({
            name: `User ${n}`,
            phone: phone(n),
            password: 'password123',
            roles,
          })
          .expect(201)
      ).body.id as string;
    const teacherId = await user(1, [{ role: 'TEACHER' }]);
    await user(2, [{ role: 'ACCOUNTANT' }]);
    await request(server)
      .put(`/api/classes/sections/${sectionA}/subjects`)
      .set(owner)
      .send({
        subjects: [{ subjectId: maths, teacherId }, { subjectId: english }],
      })
      .expect(200);

    // A second campus with its own principal and one student.
    const north = (
      await request(server)
        .post('/api/campuses')
        .set(owner)
        .send({ name: `North ${run}` })
        .expect(201)
    ).body.id;
    await user(3, [{ role: 'PRINCIPAL', campusId: north }]);
    const northClass = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId: north, name: 'Grade 6' })
        .expect(201)
    ).body.id;
    const northSection = (
      await request(server)
        .post(`/api/classes/${northClass}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'A' })
        .expect(201)
    ).body.id;

    teacher = await loginAs(main.slug, phone(1));
    accountant = await loginAs(main.slug, phone(2));
    northPrincipal = await loginAs(main.slug, phone(3));

    ids.ahmed = await admit(owner, sectionA, 'Ahmed', 'Khan', phone(5));
    ids.sana = await admit(owner, sectionA, 'Sana', 'Iqbal', phone(6));
    ids.bilal = await admit(owner, sectionA, 'Bilal', 'Raza', phone(7));
    ids.hira = await admit(owner, sectionB, 'Hira', 'Aslam', phone(8));
    ids.north = await admit(owner, northSection, 'Usman', 'Tariq', phone(9));

    // Another school entirely.
    const other = await register(
      `Directory other ${run}`,
      `dir-other+${run}@test.pk`,
    );
    otherOwner = other.headers;
    const o = await setupSchool(otherOwner, 'Grade 6');
    otherSection = await o.section('A');
    ids.stranger = await admit(
      otherOwner,
      otherSection,
      'Ahmed',
      'Stranger',
      `034${run.slice(-7)}1`,
    );
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  describe('GET /attendance/matrix', () => {
    beforeAll(async () => {
      const sheet = (date: string, statuses: [string, string][]) =>
        request(server)
          .put('/api/attendance/sheet')
          .set(teacher)
          .send({
            sectionId: sectionA,
            date,
            records: statuses.map(([studentId, status]) => ({
              studentId,
              status,
            })),
          })
          .expect(200);
      await sheet(d1, [
        [ids.ahmed, 'PRESENT'],
        [ids.sana, 'ABSENT'],
        [ids.bilal, 'LATE'],
      ]);
      await sheet(d2, [
        [ids.ahmed, 'PRESENT'],
        [ids.sana, 'LEAVE'],
        [ids.bilal, 'PRESENT'],
      ]);
      // Only part of the class marked on the third day.
      await sheet(d3, [[ids.ahmed, 'ABSENT']]);
    });

    it('returns the month grid with statuses, per-student rates and totals for the teacher of the section', async () => {
      const res = await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionA}&month=${month}`)
        .set(teacher)
        .expect(200);
      const body = res.body;
      expect(body.section).toEqual({
        id: sectionA,
        name: 'A',
        className: 'Grade 6',
      });
      expect(body.month).toBe(month);
      const lastDay = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
      ).getUTCDate();
      expect(body.days).toHaveLength(lastDay);
      expect(body.days[0]).toMatchObject({
        date: d1,
        isSchoolDay: true,
        sessionId: expect.any(String),
      });
      for (const day of body.days as {
        date: string;
        isSchoolDay: boolean;
        sessionId: string | null;
      }[]) {
        if (
          !day.sessionId &&
          new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0
        )
          expect(day.isSchoolDay).toBe(false);
      }

      const byName = Object.fromEntries(
        (body.students as { name: string }[]).map((s) => [s.name, s]),
      );
      expect(Object.keys(byName).sort()).toEqual([
        'Ahmed Khan',
        'Bilal Raza',
        'Sana Iqbal',
      ]);
      expect(byName['Ahmed Khan']).toMatchObject({
        id: ids.ahmed,
        admissionNo: expect.any(String),
        photoUrl: null,
        statuses: { [d1]: 'PRESENT', [d2]: 'PRESENT', [d3]: 'ABSENT' },
        counts: { PRESENT: 2, ABSENT: 1, LATE: 0, LEAVE: 0 },
        rate: 66.7,
      });
      expect(byName['Sana Iqbal']).toMatchObject({
        statuses: { [d1]: 'ABSENT', [d2]: 'LEAVE' },
        rate: 0,
      });
      expect(byName['Bilal Raza']).toMatchObject({
        statuses: { [d1]: 'LATE', [d2]: 'PRESENT' },
        rate: 100,
      });

      expect(body.totals).toMatchObject({
        students: 3,
        sessions: 3,
        PRESENT: 3,
        ABSENT: 2,
        LATE: 1,
        LEAVE: 1,
        rate: 57.1,
      });
      expect(body.totals.byDate[d1]).toEqual({
        PRESENT: 1,
        ABSENT: 1,
        LATE: 1,
        LEAVE: 0,
        unmarked: 0,
      });
      expect(body.totals.byDate[d3]).toEqual({
        PRESENT: 0,
        ABSENT: 1,
        LATE: 0,
        LEAVE: 0,
        unmarked: 2,
      });
    });

    it('lets admins see any section and validates the query', async () => {
      const res = await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionB}&month=${month}`)
        .set(owner)
        .expect(200);
      expect(res.body.students.map((s: { id: string }) => s.id)).toEqual([
        ids.hira,
      ]);
      expect(res.body.totals).toMatchObject({ sessions: 0, rate: null });
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionA}&month=2026-13`)
        .set(owner)
        .expect(400);
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionA}`)
        .set(owner)
        .expect(400);
      await request(server)
        .get(`/api/attendance/matrix?month=${month}`)
        .set(owner)
        .expect(400);
    });

    it('keeps teachers to their own sections and other roles out', async () => {
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionB}&month=${month}`)
        .set(teacher)
        .expect(403);
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionA}&month=${month}`)
        .set(accountant)
        .expect(403);
      // A campus-scoped principal does not see another campus's sections.
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionA}&month=${month}`)
        .set(northPrincipal)
        .expect(403);
    });

    it("does not reveal another school's sections", async () => {
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${otherSection}&month=${month}`)
        .set(owner)
        .expect(404);
      await request(server)
        .get(`/api/attendance/matrix?sectionId=${sectionA}&month=${month}`)
        .set(otherOwner)
        .expect(404);
    });
  });

  describe('GET /students/directory', () => {
    beforeAll(async () => {
      const invoice = (
        studentId: string,
        period: string,
        dueDate: string,
        total: number,
        paid: number,
        status: 'UNPAID' | 'PARTIAL' | 'PAID',
      ) =>
        prisma.invoice.create({
          data: {
            schoolId,
            studentId,
            voucherNo: `T${run}${studentId.slice(-6)}${period}`,
            period,
            dueDate: dayStart(dueDate),
            total,
            paid,
            status,
          },
        });
      // Ahmed: one overdue part-paid invoice. Sana: one not yet due. Bilal: all paid. Hira: no invoices.
      await invoice(
        ids.ahmed,
        '2026-01',
        daysBefore(today, 5),
        5000,
        2000,
        'PARTIAL',
      );
      await invoice(
        ids.ahmed,
        '2026-02',
        daysAfter(today, 5),
        5000,
        0,
        'UNPAID',
      );
      await invoice(
        ids.sana,
        '2026-01',
        daysAfter(today, 5),
        4500,
        0,
        'UNPAID',
      );
      await invoice(
        ids.bilal,
        '2026-01',
        daysBefore(today, 5),
        5000,
        5000,
        'PAID',
      );
    });

    type Item = {
      id: string;
      name: string;
      attendanceRate: number | null;
      feeStatus: string;
      balance: number;
    };
    const list = async (query: string, headers: Headers = owner) =>
      (
        await request(server)
          .get(`/api/students/directory${query}`)
          .set(headers)
          .expect(200)
      ).body as {
        items: Item[];
        total: number;
        page: number;
        pageSize: number;
      };

    it('returns one page with class, attendance rate, guardian and fee standing', async () => {
      const res = await list('?sort=name');
      expect(res).toMatchObject({ total: 5, page: 1, pageSize: 25 });
      expect(res.items.map((i) => i.name)).toEqual([
        'Ahmed Khan',
        'Bilal Raza',
        'Hira Aslam',
        'Sana Iqbal',
        'Usman Tariq',
      ]);
      expect(res.items[0]).toEqual({
        id: ids.ahmed,
        admissionNo: expect.any(String),
        name: 'Ahmed Khan',
        photoUrl: null,
        classId,
        className: 'Grade 6',
        sectionId: sectionA,
        sectionName: 'A',
        attendanceRate: 66.7,
        guardian: { name: 'Khan Sahib', phone: phone(5), relation: 'Father' },
        feeStatus: 'OVERDUE',
        balance: 8000,
        status: 'ACTIVE',
      });
      const by = Object.fromEntries(res.items.map((i) => [i.name, i]));
      expect(by['Sana Iqbal']).toMatchObject({
        feeStatus: 'PENDING',
        balance: 4500,
        attendanceRate: 0,
      });
      expect(by['Bilal Raza']).toMatchObject({
        feeStatus: 'PAID',
        balance: 0,
        attendanceRate: 100,
      });
      expect(by['Hira Aslam']).toMatchObject({
        feeStatus: 'PAID',
        balance: 0,
        attendanceRate: null,
      });
    });

    it('filters by fee status, section, class and search (name, admission number, guardian phone)', async () => {
      expect(
        (await list('?feeStatus=OVERDUE,PENDING')).items.map((i) => i.name),
      ).toEqual(['Ahmed Khan', 'Sana Iqbal']);
      expect(
        (await list(`?sectionId=${sectionB}`)).items.map((i) => i.name),
      ).toEqual(['Hira Aslam']);
      expect((await list(`?classId=${classId}`)).total).toBe(4);
      expect((await list('?search=ahmed%20kh')).items.map((i) => i.id)).toEqual(
        [ids.ahmed],
      );
      expect(
        (await list(`?search=${phone(6)}`)).items.map((i) => i.id),
      ).toEqual([ids.sana]);
      expect((await list('?search=100%25')).total).toBe(0);
    });

    it('sorts by attendance with no-data students last, and pages', async () => {
      const desc = await list('?sort=attendance&dir=desc');
      expect(desc.items.map((i) => i.name)).toEqual([
        'Bilal Raza',
        'Ahmed Khan',
        'Sana Iqbal',
        'Hira Aslam',
        'Usman Tariq',
      ]);
      const asc = await list('?sort=attendance&dir=asc');
      expect(asc.items.slice(0, 3).map((i) => i.name)).toEqual([
        'Sana Iqbal',
        'Ahmed Khan',
        'Bilal Raza',
      ]);
      const page2 = await list('?sort=name&pageSize=2&page=2');
      expect(page2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
      expect(page2.items.map((i) => i.name)).toEqual([
        'Hira Aslam',
        'Sana Iqbal',
      ]);
      expect(await list('?pageSize=2&page=9')).toMatchObject({
        items: [],
        total: 5,
      });
      await request(server)
        .get('/api/students/directory?pageSize=500')
        .set(owner)
        .expect(400);
      await request(server)
        .get('/api/students/directory?feeStatus=LATE')
        .set(owner)
        .expect(400);
    });

    it('lists only current students unless asked', async () => {
      await request(server)
        .patch(`/api/students/${ids.bilal}`)
        .set(owner)
        .send({ status: 'LEFT' })
        .expect(200);
      expect((await list('')).total).toBe(4);
      const left = await list('?status=LEFT');
      expect(left.items.map((i) => i.name)).toEqual(['Bilal Raza']);
      // Still shows the class they were last in.
      expect(left.items[0]).toMatchObject({
        sectionId: sectionA,
        className: 'Grade 6',
      });
      expect((await list('?status=ACTIVE,LEFT')).total).toBe(5);
    });

    it('is for admins and accountants, scoped to campus and school', async () => {
      expect((await list('', accountant)).total).toBe(4);
      await request(server)
        .get('/api/students/directory')
        .set(teacher)
        .expect(403);
      expect((await list('', northPrincipal)).items.map((i) => i.id)).toEqual([
        ids.north,
      ]);
      const other = await list('', otherOwner);
      expect(other.items.map((i) => i.id)).toEqual([ids.stranger]);
    });
  });

  describe('GET /students/:id/performance', () => {
    beforeAll(async () => {
      const [maths, english] = await Promise.all(
        ['Maths', 'English'].map((name) =>
          prisma.subject.findFirstOrThrow({ where: { schoolId, name } }),
        ),
      );
      // Ahmed has a published result; Sana only has marks in a draft exam.
      const published = await prisma.exam.create({
        data: {
          schoolId,
          academicYearId: yearId,
          name: 'Midterm',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      await prisma.examResult.create({
        data: {
          examId: published.id,
          studentId: ids.ahmed,
          sectionId: sectionA,
          obtained: 120,
          maxTotal: 200,
          percent: 60,
          grade: 'B',
          position: 1,
          passed: true,
          subjects: [
            {
              subject: 'Maths',
              max: 100,
              pass: 33,
              marks: 85,
              absent: false,
              passed: true,
            },
            {
              subject: 'English',
              max: 100,
              pass: 33,
              marks: null,
              absent: true,
              passed: false,
            },
          ],
        },
      });
      const draft = await prisma.exam.create({
        data: { schoolId, academicYearId: yearId, name: 'Monthly test' },
      });
      const paper = (subjectId: string, maxMarks: number) =>
        prisma.examPaper.create({
          data: {
            examId: draft.id,
            classId,
            subjectId,
            maxMarks,
            passMarks: maxMarks / 3,
          },
        });
      const [pm, pe] = await Promise.all([
        paper(maths.id, 50),
        paper(english.id, 25),
      ]);
      await prisma.mark.createMany({
        data: [
          { paperId: pm.id, studentId: ids.sana, marks: 45 },
          { paperId: pe.id, studentId: ids.sana, marks: 20 },
        ],
      });
      await prisma.payment.create({
        data: {
          schoolId,
          invoiceId: (
            await prisma.invoice.findFirstOrThrow({
              where: { studentId: ids.ahmed, period: '2026-01' },
            })
          ).id,
          amount: 2000,
          method: 'CASH',
          receiptNo: `R${run}`,
        },
      });
    });

    it('returns subject percents from the latest published result, attendance by day and fee summary', async () => {
      const res = await request(server)
        .get(`/api/students/${ids.ahmed}/performance`)
        .set(owner)
        .expect(200);
      expect(res.body).toMatchObject({
        examName: 'Midterm',
        overallPercent: 60,
        grade: 'B',
        subjects: [
          { subject: 'Maths', percent: 85 },
          { subject: 'English', percent: 0 },
        ],
        attendanceTo: today,
        attendanceFrom: daysBefore(today, 181),
        attendanceByDay: [
          { date: d1, status: 'PRESENT' },
          { date: d2, status: 'PRESENT' },
          { date: d3, status: 'ABSENT' },
        ],
        attendanceCounts: { PRESENT: 2, ABSENT: 1, LATE: 0, LEAVE: 0 },
        attendanceRate: 66.7,
        feeSummary: {
          totalBilled: 10000,
          totalPaid: 2000,
          balance: 8000,
          overdueBalance: 3000,
          openInvoices: 2,
          status: 'OVERDUE',
          lastPayment: {
            amount: 2000,
            receiptNo: `R${run}`,
            receivedAt: expect.any(String),
          },
        },
      });
    });

    it('falls back to marks per subject when nothing is published', async () => {
      // Unpublished marks are only for roles that manage exams.
      const restricted = await request(server)
        .get(`/api/students/${ids.sana}/performance`)
        .set(accountant)
        .expect(200);
      expect(restricted.body).toMatchObject({
        examId: null,
        subjects: [],
        feeSummary: { status: 'PENDING', balance: 4500, lastPayment: null },
      });
      const res = await request(server)
        .get(`/api/students/${ids.sana}/performance`)
        .set(owner)
        .expect(200);
      expect(res.body).toMatchObject({
        examId: null,
        examName: null,
        subjects: [
          { subject: 'English', percent: 80 },
          { subject: 'Maths', percent: 90 },
        ],
        attendanceRate: 0,
        feeSummary: { status: 'PENDING', balance: 4500, lastPayment: null },
      });
      const empty = await request(server)
        .get(`/api/students/${ids.hira}/performance`)
        .set(owner)
        .expect(200);
      expect(empty.body).toMatchObject({
        subjects: [],
        attendanceByDay: [],
        attendanceRate: null,
        feeSummary: { status: 'PAID', balance: 0 },
      });
    });

    it("leaves out fee and attendance data the viewer's role may not see", async () => {
      await request(server)
        .put('/api/roles/builtin/ACCOUNTANT')
        .set(owner)
        .send({ permissions: { attendance: 'none', exams: 'none' } })
        .expect(200);
      try {
        const res = await request(server)
          .get(`/api/students/${ids.ahmed}/performance`)
          .set(accountant)
          .expect(200);
        expect(res.body).toMatchObject({
          examId: null,
          subjects: [],
          attendanceByDay: [],
          attendanceRate: null,
          feeSummary: { balance: 8000 },
        });
        const dir = await request(server)
          .get('/api/students/directory')
          .query({ search: 'Ahmed', sort: 'attendance' })
          .set(accountant)
          .expect(200);
        expect(dir.body.items[0]).toMatchObject({
          attendanceRate: null,
          balance: 8000,
        });
      } finally {
        await request(server)
          .put('/api/roles/builtin/ACCOUNTANT')
          .set(owner)
          .send({ reset: true, permissions: {} })
          .expect(200);
      }
    });

    it('refuses teachers, other campuses and other schools', async () => {
      await request(server)
        .get(`/api/students/${ids.ahmed}/performance`)
        .set(teacher)
        .expect(403);
      await request(server)
        .get(`/api/students/${ids.ahmed}/performance`)
        .set(northPrincipal)
        .expect(403);
      await request(server)
        .get(`/api/students/${ids.north}/performance`)
        .set(northPrincipal)
        .expect(200);
      await request(server)
        .get(`/api/students/${ids.stranger}/performance`)
        .set(owner)
        .expect(404);
      await request(server)
        .get(`/api/students/${ids.ahmed}/performance`)
        .set(otherOwner)
        .expect(404);
    });
  });
});
