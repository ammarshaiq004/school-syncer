import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  dayStart,
  daysBefore,
  localDate,
  localToday,
} from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

// Live classes: scheduling, Jitsi links, start/end/cancel, timetable import,
// student join window, attendance register, scoping and tenant isolation.
describe('E-school live classes (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const slugs: string[] = [];
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const inMinutes = (m: number) =>
    new Date(Date.now() + m * 60_000).toISOString();

  let owner: Headers;
  let teacher: Headers;
  let otherTeacher: Headers;
  let accountant: Headers;
  let studentA: Headers;
  let studentB: Headers;
  let rivalOwner: Headers;
  let schoolSlug: string;
  let schoolId: string;
  let sectionA: string;
  let maths: string;
  let english: string;
  let teacherId: string;
  let ayeshaId: string;
  let hinaId: string;

  let soonId: string;
  let laterId: string;

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

  async function studentLogin(studentId: string, name: string) {
    const user = await prisma.user.create({
      data: {
        schoolId,
        name,
        username: `l${run}${studentId.slice(-4)}`,
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

    const reg = await register(`Live ${run}`, `live+${run}@test.pk`);
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
    teacherId = await makeUser(1, 'TEACHER');
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
    studentA = await studentLogin(ayeshaId, 'Ayesha');
    studentB = await studentLogin(bilalId, 'Bilal');

    // Timetable: Maths (teacher) on Monday period 1, English (no teacher) on Wednesday period 2; a break between.
    const period = (
      name: string,
      startTime: string,
      endTime: string,
      sortOrder: number,
      isBreak = false,
    ) =>
      prisma.period.create({
        data: {
          schoolId,
          campusId,
          name,
          startTime,
          endTime,
          sortOrder,
          isBreak,
        },
      });
    const p1 = await period('Period 1', '08:00', '08:40', 1);
    await period('Break', '08:40', '09:00', 2, true);
    const p2 = await period('Period 2', '09:00', '09:45', 3);
    await prisma.timetableSlot.createMany({
      data: [
        {
          schoolId,
          sectionId: sectionA,
          dayOfWeek: 1,
          periodId: p1.id,
          subjectId: maths,
          teacherId,
        },
        {
          schoolId,
          sectionId: sectionA,
          dayOfWeek: 3,
          periodId: p2.id,
          subjectId: english,
        },
      ],
    });

    const rival = await register(
      `Rival live ${run}`,
      `rival-live+${run}@test.pk`,
    );
    rivalOwner = { Authorization: `Bearer ${rival.accessToken}` };
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await app.close();
  });

  it('schedules a Jitsi class with a generated room for a subject the teacher teaches', async () => {
    const created = await request(server)
      .post('/api/elearning/live')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        startsAt: inMinutes(5),
        durationMin: 40,
      })
      .expect(201);
    soonId = created.body.id;
    expect(created.body).toMatchObject({
      title: 'Maths',
      provider: 'JITSI',
      status: 'SCHEDULED',
      teacher: { id: teacherId },
      subject: { id: maths },
      joinWindow: 'open',
      attendanceCount: 0,
      canManage: true,
    });
    expect(created.body.joinUrl).toMatch(
      new RegExp(
        `^https://meet\\.jit\\.si/SchoolSyncer-${schoolSlug}-[a-zA-Z0-9]{10}$`,
      ),
    );

    laterId = (
      await request(server)
        .post('/api/elearning/live')
        .set(owner)
        .send({
          sectionId: sectionA,
          subjectId: english,
          title: 'Poetry reading',
          startsAt: inMinutes(120),
          provider: 'ZOOM',
          joinUrl: 'https://us02web.zoom.us/j/81234567890',
        })
        .expect(201)
    ).body.id;
  });

  it('validates providers, subjects and who may schedule', async () => {
    const base = { sectionId: sectionA, startsAt: inMinutes(60) };
    await request(server)
      .post('/api/elearning/live')
      .set(owner)
      .send({ ...base, provider: 'ZOOM' })
      .expect(400);
    await request(server)
      .post('/api/elearning/live')
      .set(owner)
      .send({
        ...base,
        provider: 'GOOGLE_MEET',
        joinUrl: 'http://meet.google.com/abc',
      })
      .expect(400);
    await request(server)
      .post('/api/elearning/live')
      .set(teacher)
      .send({ ...base, subjectId: english })
      .expect(403);
    await request(server)
      .post('/api/elearning/live')
      .set(teacher)
      .send(base)
      .expect(400);
    await request(server)
      .post('/api/elearning/live')
      .set(otherTeacher)
      .send({ ...base, subjectId: maths })
      .expect(403);
    await request(server)
      .post('/api/elearning/live')
      .set(teacher)
      .send({ ...base, subjectId: maths, teacherId })
      .expect(403);
    await request(server)
      .post('/api/elearning/live')
      .set(accountant)
      .send({ ...base, subjectId: maths })
      .expect(403);
    await request(server)
      .post('/api/elearning/live')
      .set(rivalOwner)
      .send({ ...base, subjectId: maths })
      .expect(404);
  });

  it('scopes the staff list and blocks other schools', async () => {
    const all = await request(server)
      .get('/api/elearning/live')
      .set(owner)
      .expect(200);
    expect(all.body.map((c: { id: string }) => c.id)).toEqual([
      soonId,
      laterId,
    ]);
    const mine = await request(server)
      .get('/api/elearning/live')
      .set(teacher)
      .expect(200);
    expect(mine.body.map((c: { id: string }) => c.id)).toEqual([soonId]);
    expect(
      (
        await request(server)
          .get('/api/elearning/live')
          .set(otherTeacher)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .get(`/api/elearning/live/${soonId}`)
      .set(otherTeacher)
      .expect(404);
    await request(server)
      .get('/api/elearning/live')
      .set(accountant)
      .expect(403);

    expect(
      (
        await request(server)
          .get('/api/elearning/live')
          .set(rivalOwner)
          .expect(200)
      ).body,
    ).toEqual([]);
    await request(server)
      .get(`/api/elearning/live/${soonId}`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .post(`/api/elearning/live/${soonId}/start`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .get(`/api/elearning/live/${soonId}/attendance`)
      .set(rivalOwner)
      .expect(404);
  });

  it('shows students their section classes without the link and gates joining on the time window', async () => {
    const list = await request(server)
      .get('/api/student/live')
      .set(studentA)
      .expect(200);
    expect(list.body.liveNow).toEqual([]);
    expect(list.body.upcoming.map((c: { id: string }) => c.id)).toEqual([
      soonId,
      laterId,
    ]);
    expect(list.body.upcoming[0]).toMatchObject({
      joinWindow: 'open',
      attended: false,
      subject: { id: maths },
    });
    expect(list.body.upcoming[1]).toMatchObject({
      joinWindow: 'early',
      provider: 'ZOOM',
    });
    expect(list.body.upcoming[0].joinUrl).toBeUndefined();

    const other = await request(server)
      .get('/api/student/live')
      .set(studentB)
      .expect(200);
    expect(other.body.upcoming).toEqual([]);
    await request(server)
      .post(`/api/student/live/${soonId}/join`)
      .set(studentB)
      .expect(404);
    await request(server)
      .post(`/api/student/live/${laterId}/join`)
      .set(studentA)
      .expect(409);
    await request(server).get('/api/student/live').set(teacher).expect(403);
    await request(server).get('/api/elearning/live').set(studentA).expect(403);

    const joined = await request(server)
      .post(`/api/student/live/${soonId}/join`)
      .set(studentA)
      .expect(201);
    expect(joined.body).toMatchObject({
      liveClassId: soonId,
      provider: 'JITSI',
    });
    expect(joined.body.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\//);
    // Joining again keeps the first join time.
    const again = await request(server)
      .post(`/api/student/live/${soonId}/join`)
      .set(studentA)
      .expect(201);
    expect(again.body.joinedAt).toBe(joined.body.joinedAt);
    expect(
      (
        await request(server)
          .post(`/api/student/live/${soonId}/leave`)
          .set(studentA)
          .expect(201)
      ).body,
    ).toEqual({
      left: true,
    });
  });

  it('starts and ends a class, then writes the day register from who joined', async () => {
    const started = await request(server)
      .post(`/api/elearning/live/${soonId}/start`)
      .set(teacher)
      .expect(201);
    expect(started.body).toMatchObject({ status: 'LIVE', joinWindow: 'open' });
    expect(started.body.startedAt).toBeTruthy();
    const live = await request(server)
      .get('/api/student/live')
      .set(studentA)
      .expect(200);
    expect(live.body.liveNow).toMatchObject([
      { id: soonId, status: 'LIVE', attended: true },
    ]);

    await request(server)
      .post(`/api/elearning/live/${soonId}/mark-attendance`)
      .set(teacher)
      .expect(409);
    await request(server)
      .post(`/api/elearning/live/${soonId}/cancel`)
      .set(teacher)
      .expect(409);
    await request(server)
      .patch(`/api/elearning/live/${soonId}`)
      .set(teacher)
      .send({ durationMin: 60 })
      .expect(409);

    const sheet = await request(server)
      .get(`/api/elearning/live/${soonId}/attendance`)
      .set(teacher)
      .expect(200);
    expect(sheet.body).toMatchObject({
      studentCount: 2,
      joinedCount: 1,
      sheetTaken: false,
      canMarkAttendance: false,
    });
    expect(
      sheet.body.students.find((s: { id: string }) => s.id === ayeshaId),
    ).toMatchObject({ joined: true });
    expect(
      sheet.body.students.find((s: { id: string }) => s.id === hinaId),
    ).toMatchObject({ joined: false, joinedAt: null });

    const ended = await request(server)
      .post(`/api/elearning/live/${soonId}/end`)
      .set(teacher)
      .send({ recordingUrl: 'https://www.youtube.com/watch?v=n0FZhQ_GkKw' })
      .expect(201);
    expect(ended.body).toMatchObject({ status: 'ENDED', joinWindow: 'closed' });
    await request(server)
      .post(`/api/elearning/live/${soonId}/end`)
      .set(teacher)
      .expect(409);
    await request(server)
      .post(`/api/student/live/${soonId}/join`)
      .set(studentA)
      .expect(409);
    const recent = await request(server)
      .get('/api/student/live')
      .set(studentA)
      .expect(200);
    expect(recent.body.recent).toMatchObject([
      {
        id: soonId,
        recordingUrl: 'https://www.youtube.com/watch?v=n0FZhQ_GkKw',
        attended: true,
      },
    ]);

    await request(server)
      .post(`/api/elearning/live/${soonId}/mark-attendance`)
      .set(otherTeacher)
      .expect(404);
    const marked = await request(server)
      .post(`/api/elearning/live/${soonId}/mark-attendance`)
      .set(teacher)
      .expect(201);
    const date = localDate(new Date(ended.body.startsAt));
    expect(marked.body).toMatchObject({ date, present: 1, absent: 1 });
    const session = await prisma.attendanceSession.findUniqueOrThrow({
      where: { sectionId_date: { sectionId: sectionA, date: dayStart(date) } },
      include: { records: true },
    });
    expect(
      Object.fromEntries(session.records.map((r) => [r.studentId, r.status])),
    ).toEqual({
      [ayeshaId]: 'PRESENT',
      [hinaId]: 'ABSENT',
    });
    await request(server)
      .post(`/api/elearning/live/${soonId}/mark-attendance`)
      .set(teacher)
      .expect(409);
    expect(
      (
        await request(server)
          .get(`/api/elearning/live/${soonId}/attendance`)
          .set(teacher)
          .expect(200)
      ).body,
    ).toMatchObject({ sheetTaken: true, canMarkAttendance: false });
  });

  it('never overwrites a register that already exists for the day', async () => {
    const id = (
      await request(server)
        .post('/api/elearning/live')
        .set(teacher)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          startsAt: new Date(Date.now() + 60_000).toISOString(),
        })
        .expect(201)
    ).body.id;
    await request(server)
      .post(`/api/elearning/live/${id}/end`)
      .set(teacher)
      .expect(201);
    const startsAt = (
      await prisma.liveClass.findUniqueOrThrow({ where: { id } })
    ).startsAt;
    const soon = await prisma.liveClass.findUniqueOrThrow({
      where: { id: soonId },
    });
    // Same school-local day as the first class, so its register is already there.
    expect(localDate(startsAt)).toBe(localDate(soon.startsAt));
    await request(server)
      .post(`/api/elearning/live/${id}/mark-attendance`)
      .set(teacher)
      .expect(409);
  });

  it('does not write a register for a future day, nor without attendance rights', async () => {
    const id = (
      await request(server)
        .post('/api/elearning/live')
        .set(teacher)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          startsAt: inMinutes(3 * 24 * 60),
        })
        .expect(201)
    ).body.id;
    await request(server)
      .post(`/api/elearning/live/${id}/end`)
      .set(teacher)
      .expect(201);
    const future = await request(server)
      .post(`/api/elearning/live/${id}/mark-attendance`)
      .set(teacher)
      .expect(409);
    expect(future.body.message).toMatch(/on or after the day of the class/);

    await request(server)
      .put('/api/roles/builtin/TEACHER')
      .set(owner)
      .send({ permissions: { attendance: 'view' } })
      .expect(200);
    try {
      const denied = await request(server)
        .post(`/api/elearning/live/${id}/mark-attendance`)
        .set(teacher)
        .expect(403);
      expect(denied.body.message).toMatch(/permission to mark attendance/);
    } finally {
      await request(server)
        .put('/api/roles/builtin/TEACHER')
        .set(owner)
        .send({ reset: true, permissions: {} })
        .expect(200);
    }
  });

  it('cancels, edits and deletes scheduled classes', async () => {
    const edited = await request(server)
      .patch(`/api/elearning/live/${laterId}`)
      .set(owner)
      .send({ provider: 'JITSI', durationMin: 50, title: 'Poetry circle' })
      .expect(200);
    expect(edited.body).toMatchObject({
      provider: 'JITSI',
      durationMin: 50,
      title: 'Poetry circle',
    });
    expect(edited.body.joinUrl).toMatch(
      /^https:\/\/meet\.jit\.si\/SchoolSyncer-/,
    );
    await request(server)
      .patch(`/api/elearning/live/${laterId}`)
      .set(owner)
      .send({ provider: 'OTHER' })
      .expect(400);

    const cancelled = await request(server)
      .post(`/api/elearning/live/${laterId}/cancel`)
      .set(owner)
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    await request(server)
      .post(`/api/elearning/live/${laterId}/start`)
      .set(owner)
      .expect(409);
    const list = await request(server)
      .get('/api/student/live')
      .set(studentA)
      .expect(200);
    expect(list.body.upcoming).toMatchObject([
      { id: laterId, status: 'CANCELLED', joinWindow: 'closed' },
    ]);
    await request(server)
      .post(`/api/student/live/${laterId}/join`)
      .set(studentA)
      .expect(409);

    // A recording link can still be added to an ended class.
    await request(server)
      .patch(`/api/elearning/live/${soonId}`)
      .set(teacher)
      .send({ recordingUrl: 'https://vimeo.com/76979871' })
      .expect(200);
    await request(server)
      .delete(`/api/elearning/live/${soonId}`)
      .set(owner)
      .expect(409);
    await request(server)
      .delete(`/api/elearning/live/${laterId}`)
      .set(rivalOwner)
      .expect(404);
    await request(server)
      .delete(`/api/elearning/live/${laterId}`)
      .set(owner)
      .expect(200);
  });

  it('schedules a week from the timetable, skipping breaks, existing and past periods', async () => {
    const nextWeek = daysBefore(localToday(), -7);
    const mine = await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(teacher)
      .send({ sectionId: sectionA, weekStart: nextWeek })
      .expect(201);
    // The teacher only gets their own Maths period.
    expect(mine.body).toMatchObject({
      created: 1,
      skippedExisting: 0,
      skippedPast: 0,
    });
    expect(mine.body.weekStart).toBe(
      localDate(new Date(mine.body.classes[0].startsAt)),
    );
    expect(mine.body.classes).toMatchObject([
      {
        title: 'Maths',
        durationMin: 40,
        provider: 'JITSI',
        teacher: { id: teacherId },
      },
    ]);

    const all = await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(owner)
      .send({ sectionId: sectionA, weekStart: nextWeek })
      .expect(201);
    expect(all.body).toMatchObject({
      created: 1,
      skippedExisting: 1,
      skippedPast: 0,
    });
    expect(
      all.body.classes.map((c: { title: string; durationMin: number }) => [
        c.title,
        c.durationMin,
      ]),
    ).toEqual([
      ['Maths', 40],
      ['English', 45],
    ]);
    const again = await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(owner)
      .send({ sectionId: sectionA, weekStart: nextWeek })
      .expect(201);
    expect(again.body).toMatchObject({ created: 0, skippedExisting: 2 });

    // Saving the timetable recreates its slots, which unlinks older classes;
    // scheduling the week again must still see them.
    await prisma.liveClass.updateMany({
      where: { sectionId: sectionA, timetableSlotId: { not: null } },
      data: { timetableSlotId: null },
    });
    const resaved = await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(owner)
      .send({ sectionId: sectionA, weekStart: nextWeek })
      .expect(201);
    expect(resaved.body).toMatchObject({ created: 0, skippedExisting: 2 });
    expect(resaved.body.classes).toHaveLength(2);

    const past = await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(owner)
      .send({ sectionId: sectionA, weekStart: daysBefore(localToday(), 14) })
      .expect(201);
    expect(past.body).toMatchObject({ created: 0, skippedPast: 2 });

    await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(otherTeacher)
      .send({ sectionId: sectionA, weekStart: nextWeek })
      .expect(403);
    await request(server)
      .post('/api/elearning/live/from-timetable')
      .set(rivalOwner)
      .send({ sectionId: sectionA, weekStart: nextWeek })
      .expect(404);
  });
});
