import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Year-end: next year's classes, deciding who moves up, and starting the new year.
describe('Promotions (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  let owner: Record<string, string>;
  let schoolSlug: string;
  let schoolId: string;
  let yearId: string;
  let grade4: string;
  let grade5: string;
  let grade4A: string;
  let grade5A: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({
        schoolName: `Promotions ${run}`,
        ownerName: 'Owner',
        email: `promo+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

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
    const klass = async (name: string, sortOrder: number) => {
      const id = (
        await request(server)
          .post('/api/classes')
          .set(owner)
          .send({ campusId, name, sortOrder })
          .expect(201)
      ).body.id;
      const sectionId = (
        await request(server)
          .post(`/api/classes/${id}/sections`)
          .set(owner)
          .send({ academicYearId: yearId, name: 'A', capacity: 30 })
          .expect(201)
      ).body.id;
      return [id, sectionId];
    };
    [grade4, grade4A] = await klass('Grade 4', 4);
    [grade5, grade5A] = await klass('Grade 5', 5);
    const add = async (firstName: string, sectionId: string, i: number) => {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({
          sectionId,
          firstName,
          gender: 'MALE',
          guardians: [
            {
              name: 'Parent',
              phone: `037${run.slice(-7)}${i}`,
              relation: 'Father',
            },
          ],
        })
        .expect(201);
      ids[firstName] = res.body.id;
    };
    await add('Ali', grade4A, 1);
    await add('Sara', grade4A, 2);
    await add('Omar', grade4A, 3);
    await add('Hina', grade5A, 4);
    await add('Zaid', grade5A, 5);

    // A fee, a subject teacher and a timetable period, to see them carried over.
    const head = await prisma.feeHead.create({
      data: { schoolId, name: `Tuition ${run}` },
    });
    await prisma.feeStructure.create({
      data: {
        schoolId,
        classId: grade4,
        feeHeadId: head.id,
        academicYearId: yearId,
        amount: 5500,
      },
    });
    const subject = await prisma.subject.create({
      data: { schoolId, name: 'Mathematics' },
    });
    await prisma.sectionSubject.create({
      data: { schoolId, sectionId: grade4A, subjectId: subject.id },
    });
    const period = await prisma.period.create({
      data: {
        schoolId,
        campusId,
        name: 'Period 1',
        startTime: '08:00',
        endTime: '08:40',
        sortOrder: 1,
      },
    });
    await prisma.timetableSlot.create({
      data: {
        schoolId,
        sectionId: grade4A,
        dayOfWeek: 1,
        periodId: period.id,
        subjectId: subject.id,
      },
    });
    // Omar failed the annual exam.
    const exam = await prisma.exam.create({
      data: {
        schoolId,
        academicYearId: yearId,
        name: 'Annual',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await prisma.examResult.createMany({
      data: [
        ['Ali', 81, true, 1],
        ['Sara', 64, true, 2],
        ['Omar', 29, false, 3],
      ].map(([name, percent, passed, position]) => ({
        examId: exam.id,
        studentId: ids[name as string],
        sectionId: grade4A,
        obtained: percent as number,
        maxTotal: 100,
        percent: percent as number,
        grade: passed ? 'B' : 'F',
        position: position as number,
        passed: passed as boolean,
        subjects: [],
      })),
    });
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('sets up next year with the same classes, teachers and fees', async () => {
    const before = await request(server)
      .get('/api/promotions')
      .set(owner)
      .expect(200);
    expect(before.body.next).toBeNull();
    await request(server)
      .get(`/api/promotions/sections/${grade4A}`)
      .set(owner)
      .expect(409);

    const next = await request(server)
      .post('/api/promotions/next-year')
      .set(owner)
      .expect(201);
    expect(next.body).toMatchObject({
      name: '2027-28',
      startsOn: '2027-04-01',
      sectionsAdded: 2,
      feesCopied: 1,
    });
    const again = await request(server)
      .post('/api/promotions/next-year')
      .set(owner)
      .expect(201);
    expect(again.body).toMatchObject({ sectionsAdded: 0, feesCopied: 0 });

    const nextSections = await prisma.section.findMany({
      where: { academicYearId: next.body.id },
      include: { subjects: true },
    });
    expect(
      nextSections.find((s) => s.classId === grade4)?.subjects,
    ).toHaveLength(1);
    // Pickers still show only this year's sections.
    const classes = await request(server).get('/api/classes').set(owner);
    expect(
      classes.body
        .flatMap((c: { sections: { id: string }[] }) =>
          c.sections.map((s) => s.id),
        )
        .sort(),
    ).toEqual([grade4A, grade5A].sort());
  });

  it('suggests moving up or graduating, and saves the school’s decisions', async () => {
    const g4 = await request(server)
      .get(`/api/promotions/sections/${grade4A}`)
      .set(owner)
      .expect(200);
    expect(g4.body.exam).toMatchObject({ name: 'Annual' });
    const omar = g4.body.students.find(
      (s: { name: string }) => s.name === 'Omar',
    );
    expect(omar).toMatchObject({
      decision: 'PROMOTE',
      saved: false,
      result: { percent: 29, passed: false },
    });
    const next5A = g4.body.targets.find(
      (t: { classId: string }) => t.classId === grade5,
    ).id;
    expect(omar.toSectionId).toBe(next5A);

    const g5 = await request(server)
      .get(`/api/promotions/sections/${grade5A}`)
      .set(owner)
      .expect(200);
    expect(g5.body.topClass).toBe(true);
    expect(
      g5.body.students.map((s: { decision: string }) => s.decision),
    ).toEqual(['GRADUATE', 'GRADUATE']);

    await request(server)
      .put(`/api/promotions/sections/${grade4A}`)
      .set(owner)
      .send({ decisions: [{ studentId: ids.Omar, decision: 'REPEAT' }] })
      .expect(400);
    await request(server)
      .put(`/api/promotions/sections/${grade4A}`)
      .set(owner)
      .send({ decisions: [{ studentId: ids.Hina, decision: 'LEAVE' }] })
      .expect(400);
    const saved = await request(server)
      .put(`/api/promotions/sections/${grade4A}`)
      .set(owner)
      .send({
        decisions: [
          {
            studentId: ids.Omar,
            decision: 'REPEAT',
            toSectionId: g4.body.repeatSectionId,
          },
          { studentId: ids.Sara, decision: 'LEAVE' },
        ],
      })
      .expect(200);
    expect(
      saved.body.students.map((s: { name: string; decision: string }) => [
        s.name,
        s.decision,
      ]),
    ).toEqual([
      ['Ali', 'PROMOTE'],
      ['Sara', 'LEAVE'],
      ['Omar', 'REPEAT'],
    ]);
  });

  it('starts the new year: moves everyone, numbers the classes and carries the timetable', async () => {
    const started = await request(server)
      .post('/api/promotions/start-year')
      .set(owner)
      .send({})
      .expect(201);
    expect(started.body).toEqual({
      year: '2027-28',
      PROMOTE: 1,
      REPEAT: 1,
      LEAVE: 1,
      GRADUATE: 2,
    });

    const current = await prisma.academicYear.findFirstOrThrow({
      where: { schoolId, isCurrent: true },
    });
    expect(current.name).toBe('2027-28');
    const students = await prisma.student.findMany({
      where: { schoolId },
      include: {
        enrollments: {
          orderBy: { createdAt: 'asc' },
          include: { section: { include: { class: true } } },
        },
      },
    });
    const of = (name: string) => students.find((s) => s.firstName === name)!;
    expect(
      of('Ali').enrollments.map((e) => [
        e.section.class.name,
        e.status,
        e.rollNo,
      ]),
    ).toEqual([
      ['Grade 4', 'PROMOTED', expect.anything()],
      ['Grade 5', 'ACTIVE', 1],
    ]);
    expect(of('Omar').enrollments.at(-1)).toMatchObject({
      status: 'ACTIVE',
      rollNo: 1,
      section: { class: { name: 'Grade 4' } },
    });
    expect(of('Omar').enrollments[0].status).toBe('REPEATED');
    expect(of('Sara').status).toBe('LEFT');
    expect(of('Hina').status).toBe('GRADUATED');
    expect(of('Zaid').enrollments.map((e) => e.status)).toEqual(['GRADUATED']);

    // Timetable and fees now hang off next year's sections.
    const slot = await prisma.timetableSlot.findFirstOrThrow({
      where: { schoolId },
      include: { section: true },
    });
    expect(slot.section.academicYearId).toBe(current.id);
    expect(
      await prisma.feeStructure.count({
        where: { academicYearId: current.id },
      }),
    ).toBe(1);
    const classes = await request(server).get('/api/classes').set(owner);
    expect(
      classes.body.every((c: { sections: { academicYearId: string }[] }) =>
        c.sections.every((s) => s.academicYearId === current.id),
      ),
    ).toBe(true);

    // Nothing to start until the year after is set up.
    await request(server)
      .post('/api/promotions/start-year')
      .set(owner)
      .send({})
      .expect(409);
  });
});
