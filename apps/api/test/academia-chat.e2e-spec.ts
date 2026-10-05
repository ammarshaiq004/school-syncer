import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

type Headers = Record<string, string>;

// Teacher lesson plans (CRUD, submit, review queue) and parent-teacher chat
// (contacts, threads, messages, read state, unread counts): happy paths, role
// and membership denials, campus scope and tenant isolation.
describe('Lesson plans and parent-teacher chat (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `034${run.slice(-7)}${n}`;
  const today = localToday();

  const slugs: string[] = [];
  let slug: string;
  let schoolId: string;
  let owner: Headers;
  let mathsTeacher: Headers; // class teacher of Grade 5 A, teaches Maths there
  let englishTeacher: Headers; // teaches English in Grade 5 A only
  let outsider: Headers; // teaches Maths in Grade 5 B only
  let accountant: Headers;
  let principal: Headers; // school-wide
  let northPrincipal: Headers; // North campus only
  let parent: Headers; // Ahmed's father
  let otherParent: Headers; // Sana's mother
  let otherOwner: Headers;
  const userIds: Record<'maths' | 'english' | 'outsider', string> = {
    maths: '',
    english: '',
    outsider: '',
  };
  let sectionA: string;
  let sectionB: string;
  let maths: string;
  let english: string;
  let science: string;
  let ahmed: string;
  let sana: string;

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

  async function loginAs(login: string) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug: slug, login, password: 'password123' })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  async function inviteParent(studentId: string, n: number) {
    const guardian = await prisma.guardian.findFirstOrThrow({
      where: { schoolId, phone: phone(n) },
    });
    await request(server)
      .post(`/api/students/${studentId}/guardians/${guardian.id}/invite`)
      .set(owner)
      .expect(201);
    await prisma.user.update({
      where: { schoolId_phone: { schoolId, phone: phone(n) } },
      data: { passwordHash: await bcrypt.hash('password123', 4) },
    });
    return loginAs(phone(n));
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

    const main = await register(`Chat ${run}`, `chat+${run}@test.pk`);
    slug = main.slug;
    owner = main.headers;
    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id as string;
    const year = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({
          name: '2026-27',
          startsOn: daysBefore(today, 60),
          endsOn: daysBefore(today, -300),
          isCurrent: true,
        })
        .expect(201)
    ).body.id as string;
    schoolId = (
      await prisma.academicYear.findUniqueOrThrow({ where: { id: year } })
    ).schoolId;

    const user = async (
      n: number,
      name: string,
      roles: { role: string; campusId?: string }[],
    ) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name, phone: phone(n), password: 'password123', roles })
          .expect(201)
      ).body.id as string;
    userIds.maths = await user(1, 'Saima Bibi', [{ role: 'TEACHER' }]);
    userIds.english = await user(2, 'Ayesha Noor', [{ role: 'TEACHER' }]);
    userIds.outsider = await user(3, 'Asif Mehmood', [{ role: 'TEACHER' }]);
    await user(4, 'Kamran Ali', [{ role: 'ACCOUNTANT' }]);
    await user(7, 'Nadia Hussain', [{ role: 'PRINCIPAL' }]);
    const north = (
      await request(server)
        .post('/api/campuses')
        .set(owner)
        .send({ name: `North ${run}` })
        .expect(201)
    ).body.id;
    await user(6, 'Farah Javed', [{ role: 'PRINCIPAL', campusId: north }]);

    const cls = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 5' })
        .expect(201)
    ).body.id as string;
    sectionA = (
      await request(server)
        .post(`/api/classes/${cls}/sections`)
        .set(owner)
        .send({
          academicYearId: year,
          name: 'A',
          classTeacherId: userIds.maths,
        })
        .expect(201)
    ).body.id;
    sectionB = (
      await request(server)
        .post(`/api/classes/${cls}/sections`)
        .set(owner)
        .send({ academicYearId: year, name: 'B' })
        .expect(201)
    ).body.id;
    const subject = async (name: string) =>
      (
        await request(server)
          .post('/api/subjects')
          .set(owner)
          .send({ name })
          .expect(201)
      ).body.id as string;
    maths = await subject('Maths');
    english = await subject('English');
    science = await subject('Science');
    await request(server)
      .put(`/api/classes/sections/${sectionA}/subjects`)
      .set(owner)
      .send({
        subjects: [
          { subjectId: maths, teacherId: userIds.maths },
          { subjectId: english, teacherId: userIds.english },
        ],
      })
      .expect(200);
    await request(server)
      .put(`/api/classes/sections/${sectionB}/subjects`)
      .set(owner)
      .send({ subjects: [{ subjectId: maths, teacherId: userIds.outsider }] })
      .expect(200);

    const admit = async (
      firstName: string,
      lastName: string,
      n: number,
      relation: string,
    ) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId: sectionA,
            firstName,
            lastName,
            gender: 'MALE',
            guardians: [
              {
                name: `${firstName}'s ${relation.toLowerCase()}`,
                phone: phone(n),
                relation,
              },
            ],
          })
          .expect(201)
      ).body.id as string;
    ahmed = await admit('Ahmed', 'Khan', 5, 'Father');
    sana = await admit('Sana', 'Iqbal', 8, 'Mother');

    mathsTeacher = await loginAs(phone(1));
    englishTeacher = await loginAs(phone(2));
    outsider = await loginAs(phone(3));
    accountant = await loginAs(phone(4));
    northPrincipal = await loginAs(phone(6));
    principal = await loginAs(phone(7));
    parent = await inviteParent(ahmed, 5);
    otherParent = await inviteParent(sana, 8);

    otherOwner = (
      await register(`Chat other ${run}`, `chat-other+${run}@test.pk`)
    ).headers;
  });

  afterAll(async () => {
    for (const s of slugs) await deleteSchools(prisma, { slug: s });
    await app.close();
  });

  describe('lesson plans', () => {
    let mathsPlan: string;
    let englishPlan: string;
    // A Wednesday; plans are stored against that week's Monday.
    const wednesday = '2026-10-07';
    const monday = '2026-10-05';

    it('lists the sections and subjects a teacher may plan for', async () => {
      const own = await request(server)
        .get('/api/lesson-plans/sections')
        .set(mathsTeacher)
        .expect(200);
      expect(own.body).toHaveLength(1);
      expect(own.body[0]).toMatchObject({
        id: sectionA,
        name: 'Grade 5 A',
        isClassTeacher: true,
      });
      expect(own.body[0].subjects.map((s: { name: string }) => s.name)).toEqual(
        ['English', 'Maths'],
      );

      const eng = await request(server)
        .get('/api/lesson-plans/sections')
        .set(englishTeacher)
        .expect(200);
      expect(eng.body[0].subjects).toEqual([
        { id: english, name: 'English', teachesIt: true },
      ]);
    });

    it('lets teachers create plans for what they teach, snapped to Monday', async () => {
      const res = await request(server)
        .post('/api/lesson-plans')
        .set(mathsTeacher)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          weekStart: wednesday,
          topic: 'Fractions: adding unlike denominators',
          objectives: 'Find common denominators',
          homework: '',
        })
        .expect(201);
      mathsPlan = res.body.id;
      expect(res.body).toMatchObject({
        weekStart: monday,
        status: 'DRAFT',
        sectionName: 'Grade 5 A',
        subjectName: 'Maths',
        homework: null,
        mine: true,
        editable: true,
        teacher: { id: userIds.maths, name: 'Saima Bibi' },
      });

      englishPlan = (
        await request(server)
          .post('/api/lesson-plans')
          .set(englishTeacher)
          .send({
            sectionId: sectionA,
            subjectId: english,
            weekStart: monday,
            topic: 'Reading comprehension',
          })
          .expect(201)
      ).body.id;
    });

    it("refuses plans outside the teacher's subjects and bad input", async () => {
      await request(server)
        .post('/api/lesson-plans')
        .set(outsider)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          weekStart: monday,
          topic: 'X',
        })
        .expect(403);
      await request(server)
        .post('/api/lesson-plans')
        .set(englishTeacher)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          weekStart: monday,
          topic: 'X',
        })
        .expect(403);
      await request(server)
        .post('/api/lesson-plans')
        .set(mathsTeacher)
        .send({
          sectionId: sectionA,
          subjectId: science,
          weekStart: monday,
          topic: 'X',
        })
        .expect(400);
      await request(server)
        .post('/api/lesson-plans')
        .set(mathsTeacher)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          weekStart: '2026-02-30',
          topic: 'X',
        })
        .expect(400);
      await request(server)
        .get('/api/lesson-plans')
        .set(accountant)
        .expect(403);
      await request(server).get('/api/lesson-plans').set(parent).expect(403);
    });

    it('shows teachers only their own plans', async () => {
      const list = await request(server)
        .get('/api/lesson-plans')
        .set(englishTeacher)
        .expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).toEqual([englishPlan]);
      await request(server)
        .get(`/api/lesson-plans/${mathsPlan}`)
        .set(englishTeacher)
        .expect(403);
      await request(server)
        .patch(`/api/lesson-plans/${mathsPlan}`)
        .set(englishTeacher)
        .send({ topic: 'Mine now' })
        .expect(403);
      await request(server)
        .delete(`/api/lesson-plans/${mathsPlan}`)
        .set(englishTeacher)
        .expect(403);
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/submit`)
        .set(englishTeacher)
        .expect(403);

      const week = await request(server)
        .get(`/api/lesson-plans?week=${wednesday}&sectionId=${sectionA}`)
        .set(principal)
        .expect(200);
      expect(week.body.map((p: { id: string }) => p.id).sort()).toEqual(
        [mathsPlan, englishPlan].sort(),
      );
    });

    it('edits, submits and locks a plan', async () => {
      await request(server)
        .patch(`/api/lesson-plans/${mathsPlan}`)
        .set(mathsTeacher)
        .send({ activities: 'Fraction strips in pairs' })
        .expect(200);
      const sub = await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/submit`)
        .set(mathsTeacher)
        .expect(200);
      expect(sub.body).toMatchObject({
        status: 'SUBMITTED',
        editable: false,
        activities: 'Fraction strips in pairs',
      });
      expect(sub.body.submittedAt).toBeTruthy();
      await request(server)
        .patch(`/api/lesson-plans/${mathsPlan}`)
        .set(mathsTeacher)
        .send({ topic: 'Changed' })
        .expect(409);
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/submit`)
        .set(mathsTeacher)
        .expect(409);
      await request(server)
        .delete(`/api/lesson-plans/${mathsPlan}`)
        .set(mathsTeacher)
        .expect(409);
    });

    it('keeps the review queue for setup roles in scope', async () => {
      await request(server)
        .get('/api/lesson-plans/review-queue')
        .set(mathsTeacher)
        .expect(403);
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(mathsTeacher)
        .send({ decision: 'APPROVED' })
        .expect(403);

      const queue = await request(server)
        .get('/api/lesson-plans/review-queue')
        .set(principal)
        .expect(200);
      expect(queue.body.items.map((p: { id: string }) => p.id)).toEqual([
        mathsPlan,
      ]);
      expect(queue.body.counts).toEqual({
        DRAFT: 1,
        SUBMITTED: 1,
        APPROVED: 0,
        NEEDS_CHANGES: 0,
      });

      // A North-campus principal sees nothing from the main campus.
      const north = await request(server)
        .get('/api/lesson-plans/review-queue')
        .set(northPrincipal)
        .expect(200);
      expect(north.body.items).toEqual([]);
      await request(server)
        .get(`/api/lesson-plans/${mathsPlan}`)
        .set(northPrincipal)
        .expect(403);
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(northPrincipal)
        .send({ decision: 'APPROVED' })
        .expect(403);
    });

    it('sends a plan back with a note, then approves the resubmission', async () => {
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(principal)
        .send({ decision: 'NEEDS_CHANGES' })
        .expect(400);
      const back = await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(principal)
        .send({ decision: 'NEEDS_CHANGES', note: 'Add a short exit quiz' })
        .expect(200);
      expect(back.body).toMatchObject({
        status: 'NEEDS_CHANGES',
        reviewerNote: 'Add a short exit quiz',
        reviewedBy: { name: 'Nadia Hussain' },
      });

      // Reviewing a plan that is not submitted is refused.
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(principal)
        .send({ decision: 'APPROVED' })
        .expect(409);

      await request(server)
        .patch(`/api/lesson-plans/${mathsPlan}`)
        .set(mathsTeacher)
        .send({ activities: 'Fraction strips, then a 5-question exit quiz' })
        .expect(200);
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/submit`)
        .set(mathsTeacher)
        .expect(200);
      const ok = await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(principal)
        .send({ decision: 'APPROVED' })
        .expect(200);
      expect(ok.body).toMatchObject({ status: 'APPROVED', reviewerNote: null });
      expect(
        await prisma.auditLog.count({
          where: { schoolId, entity: 'LessonPlan', entityId: mathsPlan },
        }),
      ).toBe(2);

      const mine = await request(server)
        .get('/api/lesson-plans?status=APPROVED')
        .set(mathsTeacher)
        .expect(200);
      expect(mine.body.map((p: { id: string }) => p.id)).toEqual([mathsPlan]);
    });

    it('deletes a draft', async () => {
      await request(server)
        .delete(`/api/lesson-plans/${englishPlan}`)
        .set(englishTeacher)
        .expect(200);
      await request(server)
        .get(`/api/lesson-plans/${englishPlan}`)
        .set(englishTeacher)
        .expect(404);
    });

    it('does not let a setup role review a plan they wrote', async () => {
      const own = await request(server)
        .post('/api/lesson-plans')
        .set(owner)
        .send({
          sectionId: sectionA,
          subjectId: english,
          weekStart: monday,
          topic: 'Reading for meaning',
        })
        .expect(201);
      await request(server)
        .post(`/api/lesson-plans/${own.body.id}/submit`)
        .set(owner)
        .expect(200);
      await request(server)
        .post(`/api/lesson-plans/${own.body.id}/review`)
        .set(owner)
        .send({ decision: 'APPROVED' })
        .expect(403);
      await prisma.lessonPlan.delete({ where: { id: own.body.id } });
    });

    it('isolates schools', async () => {
      await request(server)
        .get(`/api/lesson-plans/${mathsPlan}`)
        .set(otherOwner)
        .expect(404);
      await request(server)
        .patch(`/api/lesson-plans/${mathsPlan}`)
        .set(otherOwner)
        .send({ topic: 'X' })
        .expect(404);
      await request(server)
        .post(`/api/lesson-plans/${mathsPlan}/review`)
        .set(otherOwner)
        .send({ decision: 'NEEDS_CHANGES', note: 'X' })
        .expect(404);
      await request(server)
        .post('/api/lesson-plans')
        .set(otherOwner)
        .send({
          sectionId: sectionA,
          subjectId: maths,
          weekStart: monday,
          topic: 'X',
        })
        .expect(404);
      const list = await request(server)
        .get('/api/lesson-plans')
        .set(otherOwner)
        .expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('chat', () => {
    let threadId: string;
    let firstMessage: string;

    it("lists a parent's contacts per child", async () => {
      const res = await request(server)
        .get('/api/parent/chat/contacts')
        .set(parent)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].student).toMatchObject({
        id: ahmed,
        name: 'Ahmed Khan',
        className: 'Grade 5 A',
        relation: 'Father',
      });
      expect(res.body[0].contacts).toEqual([
        {
          userId: userIds.maths,
          name: 'Saima Bibi',
          isClassTeacher: true,
          subjects: ['Maths'],
          threadId: null,
        },
        {
          userId: userIds.english,
          name: 'Ayesha Noor',
          isClassTeacher: false,
          subjects: ['English'],
          threadId: null,
        },
      ]);
      await request(server)
        .get('/api/parent/chat/contacts')
        .set(mathsTeacher)
        .expect(403);
    });

    it("lets a parent open a thread only with their child's teachers", async () => {
      await request(server)
        .post('/api/chat/threads')
        .set(parent)
        .send({ studentId: ahmed, staffUserId: userIds.outsider })
        .expect(400);
      await request(server)
        .post('/api/chat/threads')
        .set(parent)
        .send({ studentId: sana, staffUserId: userIds.maths })
        .expect(404);
      await request(server)
        .post('/api/chat/threads')
        .set(mathsTeacher)
        .send({ studentId: ahmed, staffUserId: userIds.maths })
        .expect(403);

      const res = await request(server)
        .post('/api/chat/threads')
        .set(parent)
        .send({ studentId: ahmed, staffUserId: userIds.maths })
        .expect(201);
      threadId = res.body.id;
      expect(res.body).toMatchObject({
        role: 'PARENT',
        canPost: true,
        student: { id: ahmed, name: 'Ahmed Khan', className: 'Grade 5 A' },
        staff: { id: userIds.maths, name: 'Saima Bibi' },
        lastMessage: null,
        unread: 0,
      });
      // Opening it again returns the same conversation.
      const again = await request(server)
        .post('/api/chat/threads')
        .set(parent)
        .send({ studentId: ahmed, staffUserId: userIds.maths })
        .expect(201);
      expect(again.body.id).toBe(threadId);
      expect(
        await prisma.auditLog.count({
          where: { schoolId, action: 'chat.thread_create', entityId: threadId },
        }),
      ).toBe(1);
      const contacts = await request(server)
        .get('/api/parent/chat/contacts')
        .set(parent)
        .expect(200);
      expect(contacts.body[0].contacts[0].threadId).toBe(threadId);
    });

    it('exchanges messages with unread counts and read receipts', async () => {
      firstMessage = (
        await request(server)
          .post(`/api/chat/threads/${threadId}/messages`)
          .set(parent)
          .send({ body: '  Assalam o Alaikum, Ahmed was unwell yesterday.  ' })
          .expect(201)
      ).body.id;

      const unread = await request(server)
        .get('/api/chat/unread')
        .set(mathsTeacher)
        .expect(200);
      expect(unread.body).toEqual({ total: 1, threads: { [threadId]: 1 } });
      expect(
        (await request(server).get('/api/chat/unread').set(parent).expect(200))
          .body.total,
      ).toBe(0);

      const threads = await request(server)
        .get('/api/chat/threads')
        .set(mathsTeacher)
        .expect(200);
      expect(threads.body).toHaveLength(1);
      expect(threads.body[0]).toMatchObject({
        id: threadId,
        role: 'STAFF',
        unread: 1,
        guardian: { name: "Ahmed's father" },
        lastMessage: {
          preview: 'Assalam o Alaikum, Ahmed was unwell yesterday.',
          mine: false,
        },
      });

      const msgs = await request(server)
        .get(`/api/chat/threads/${threadId}/messages`)
        .set(mathsTeacher)
        .expect(200);
      expect(msgs.body.items).toHaveLength(1);
      expect(msgs.body.items[0]).toMatchObject({
        body: 'Assalam o Alaikum, Ahmed was unwell yesterday.',
        mine: false,
        readAt: null,
      });

      const reply = await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(mathsTeacher)
        .send({
          body: 'Walaikum Assalam. No problem, I will share the classwork.',
        })
        .expect(201);
      expect(reply.body).toMatchObject({
        mine: true,
        senderName: 'Saima Bibi',
      });

      // The parent polls for anything after their own message.
      const poll = await request(server)
        .get(`/api/chat/threads/${threadId}/messages?after=${firstMessage}`)
        .set(parent)
        .expect(200);
      expect(poll.body.items.map((m: { id: string }) => m.id)).toEqual([
        reply.body.id,
      ]);
      expect(poll.body.hasMore).toBe(false);

      const marked = await request(server)
        .post(`/api/chat/threads/${threadId}/read`)
        .set(mathsTeacher)
        .expect(200);
      expect(marked.body).toEqual({ marked: 1 });
      expect(
        (
          await request(server)
            .get('/api/chat/unread')
            .set(mathsTeacher)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (await request(server).get('/api/chat/unread').set(parent).expect(200))
          .body.total,
      ).toBe(1);
      const seen = await request(server)
        .get(`/api/chat/threads/${threadId}/messages`)
        .set(parent)
        .expect(200);
      expect(seen.body.items[0].readAt).toBeTruthy();
      expect(seen.body.items[1].readAt).toBeNull();
    });

    it('pages history with limit and before', async () => {
      for (const body of ['One', 'Two', 'Three']) {
        await request(server)
          .post(`/api/chat/threads/${threadId}/messages`)
          .set(parent)
          .send({ body })
          .expect(201);
      }
      const latest = await request(server)
        .get(`/api/chat/threads/${threadId}/messages?limit=2`)
        .set(parent)
        .expect(200);
      expect(latest.body.items.map((m: { body: string }) => m.body)).toEqual([
        'Two',
        'Three',
      ]);
      expect(latest.body.hasMore).toBe(true);
      const older = await request(server)
        .get(
          `/api/chat/threads/${threadId}/messages?limit=10&before=${latest.body.items[0].id}`,
        )
        .set(parent)
        .expect(200);
      expect(older.body.items.map((m: { body: string }) => m.body)).toEqual([
        'Assalam o Alaikum, Ahmed was unwell yesterday.',
        'Walaikum Assalam. No problem, I will share the classwork.',
        'One',
      ]);
      expect(older.body.hasMore).toBe(false);
      await request(server)
        .get(`/api/chat/threads/${threadId}/messages?after=nope`)
        .set(parent)
        .expect(400);
      await request(server)
        .get(`/api/chat/threads/${threadId}/messages?limit=500`)
        .set(parent)
        .expect(400);
    });

    it('validates the message body', async () => {
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(parent)
        .send({ body: '   ' })
        .expect(400);
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(parent)
        .send({ body: 'a'.repeat(2001) })
        .expect(400);
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(parent)
        .send({ body: 'a'.repeat(2000) })
        .expect(201);
    });

    it('hides the thread from non-members', async () => {
      for (const h of [englishTeacher, outsider, otherParent]) {
        await request(server)
          .get(`/api/chat/threads/${threadId}`)
          .set(h)
          .expect(404);
        await request(server)
          .get(`/api/chat/threads/${threadId}/messages`)
          .set(h)
          .expect(404);
        await request(server)
          .post(`/api/chat/threads/${threadId}/messages`)
          .set(h)
          .send({ body: 'Hi' })
          .expect(404);
        await request(server)
          .post(`/api/chat/threads/${threadId}/read`)
          .set(h)
          .expect(404);
        expect(
          (await request(server).get('/api/chat/threads').set(h).expect(200))
            .body,
        ).toEqual([]);
      }
      await request(server)
        .get('/api/chat/threads')
        .set(accountant)
        .expect(403);
      await request(server)
        .get('/api/chat/threads?scope=all')
        .set(mathsTeacher)
        .expect(403);
    });

    it('gives setup roles a read-only safeguarding view in their campus scope', async () => {
      const all = await request(server)
        .get('/api/chat/threads?scope=all')
        .set(principal)
        .expect(200);
      expect(all.body.map((t: { id: string }) => t.id)).toEqual([threadId]);
      expect(all.body[0]).toMatchObject({
        role: 'OBSERVER',
        canPost: false,
        unread: 0,
      });
      expect(
        (
          await request(server)
            .get('/api/chat/threads')
            .set(principal)
            .expect(200)
        ).body,
      ).toEqual([]);

      const msgs = await request(server)
        .get(`/api/chat/threads/${threadId}/messages`)
        .set(principal)
        .expect(200);
      expect(msgs.body.items.length).toBeGreaterThan(0);
      // Observers cannot post or mark read.
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(principal)
        .send({ body: 'Hi' })
        .expect(403);
      await request(server)
        .post(`/api/chat/threads/${threadId}/read`)
        .set(principal)
        .expect(403);
      // The owner has chat=manage everywhere, but is not a participant.
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(owner)
        .send({ body: 'Hi' })
        .expect(403);
      await request(server)
        .post(`/api/chat/threads/${threadId}/read`)
        .set(owner)
        .expect(403);
      // Reading as an observer does not mark anything read.
      expect(
        (
          await request(server)
            .get('/api/chat/unread')
            .set(mathsTeacher)
            .expect(200)
        ).body.total,
      ).toBeGreaterThan(0);

      // Safeguarding reads are audited, once per thread per day.
      await request(server)
        .get(`/api/chat/threads/${threadId}`)
        .set(principal)
        .expect(200);
      expect(
        await prisma.auditLog.count({
          where: { schoolId, action: 'chat.observe', entityId: threadId },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { schoolId, action: 'chat.observe', entityId: null },
        }),
      ).toBe(1);

      // Another campus's principal cannot see it.
      await request(server)
        .get(`/api/chat/threads/${threadId}`)
        .set(northPrincipal)
        .expect(404);
      expect(
        (
          await request(server)
            .get('/api/chat/threads?scope=all')
            .set(northPrincipal)
            .expect(200)
        ).body,
      ).toEqual([]);
    });

    it('isolates schools', async () => {
      await request(server)
        .get(`/api/chat/threads/${threadId}`)
        .set(otherOwner)
        .expect(404);
      await request(server)
        .get(`/api/chat/threads/${threadId}/messages`)
        .set(otherOwner)
        .expect(404);
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(otherOwner)
        .send({ body: 'Hi' })
        .expect(404);
      expect(
        (
          await request(server)
            .get('/api/chat/threads?scope=all')
            .set(otherOwner)
            .expect(200)
        ).body,
      ).toEqual([]);
    });

    it('makes the thread read-only for a teacher who no longer teaches the child', async () => {
      await prisma.section.update({
        where: { id: sectionA },
        data: { classTeacherId: null },
      });
      await prisma.sectionSubject.updateMany({
        where: { sectionId: sectionA, subjectId: maths },
        data: { teacherId: null },
      });
      try {
        const t = await request(server)
          .get(`/api/chat/threads/${threadId}`)
          .set(mathsTeacher)
          .expect(200);
        expect(t.body).toMatchObject({ role: 'STAFF', canPost: false });
        await request(server)
          .get(`/api/chat/threads/${threadId}/messages`)
          .set(mathsTeacher)
          .expect(200);
        await request(server)
          .post(`/api/chat/threads/${threadId}/messages`)
          .set(mathsTeacher)
          .send({ body: 'Still here' })
          .expect(403);
      } finally {
        await prisma.section.update({
          where: { id: sectionA },
          data: { classTeacherId: userIds.maths },
        });
        await prisma.sectionSubject.updateMany({
          where: { sectionId: sectionA, subjectId: maths },
          data: { teacherId: userIds.maths },
        });
      }
    });

    it('cuts a parent off once they are no longer a guardian, and closes threads with removed accounts', async () => {
      const guardian = await prisma.guardian.findFirstOrThrow({
        where: { schoolId, phone: phone(5) },
      });
      const link = await prisma.studentGuardian.findUniqueOrThrow({
        where: {
          studentId_guardianId: { studentId: ahmed, guardianId: guardian.id },
        },
      });
      await prisma.studentGuardian.delete({
        where: {
          studentId_guardianId: { studentId: ahmed, guardianId: guardian.id },
        },
      });
      await request(server)
        .get(`/api/chat/threads/${threadId}`)
        .set(parent)
        .expect(404);
      expect(
        (await request(server).get('/api/chat/threads').set(parent).expect(200))
          .body,
      ).toEqual([]);
      expect(
        (await request(server).get('/api/chat/unread').set(parent).expect(200))
          .body.total,
      ).toBe(0);
      // The teacher still sees the record, but the thread itself is unchanged.
      await request(server)
        .get(`/api/chat/threads/${threadId}`)
        .set(mathsTeacher)
        .expect(200);
      await prisma.studentGuardian.create({ data: link });

      // Simulate the parent's account being removed: the thread becomes read-only.
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { guardianUserId: null },
      });
      const t = await request(server)
        .get(`/api/chat/threads/${threadId}`)
        .set(mathsTeacher)
        .expect(200);
      expect(t.body).toMatchObject({ canPost: false, guardian: null });
      await request(server)
        .post(`/api/chat/threads/${threadId}/messages`)
        .set(mathsTeacher)
        .send({ body: 'Hello?' })
        .expect(403);
    });
  });
});
