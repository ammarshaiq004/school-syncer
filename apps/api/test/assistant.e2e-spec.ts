import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExamStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AssistantModel } from '../src/assistant/assistant-model.service.js';
import { dayStart, daysBefore, localToday } from '../src/common/dates.js';
import { PermissionService } from '../src/common/permission.service.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

type Headers = Record<string, string>;

/** Stands in for Claude: off by default (no API key), scripted when switched on. */
const model = {
  enabled: false,
  model: 'test-model',
  create: vi.fn(),
};

const usage = { input_tokens: 100, output_tokens: 20 };

// AI assistant (SCHOOL-27): at-risk list, template and AI drafts, the
// question tool loop, and the fences around them (teacher reach, fees for fee
// staff only, roles, plan, role matrix, daily limit).
describe('AI assistant (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `035${run.slice(-7)}${n}`;
  const today = localToday();

  const slugs: string[] = [];
  let slug: string;
  let schoolId: string;
  let owner: Headers;
  let teacherA: Headers; // class teacher of Grade 5 A
  let teacherB: Headers; // teaches Grade 5 B only
  let accountant: Headers;
  let parent: Headers;
  let sectionA: string;
  let sectionB: string;
  let ahmed: string; // A: poor attendance, failed the exam
  let sana: string; // A: fine
  let bilal: string; // B: fees long overdue
  let examId: string;

  async function loginAs(login: string) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug: slug, login, password: 'password123' })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AssistantModel)
      .useValue(model)
      .compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Assistant ${run}`, ownerName: 'Owner', email: `assistant+${run}@test.pk`, password: 'password123' })
      .expect(201);
    slug = reg.body.schoolSlug;
    slugs.push(slug);
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id as string;
    const year = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: daysBefore(today, 90), endsOn: daysBefore(today, -300), isCurrent: true })
        .expect(201)
    ).body.id as string;
    schoolId = (await prisma.academicYear.findUniqueOrThrow({ where: { id: year } })).schoolId;

    const user = async (n: number, name: string, role: string) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name, phone: phone(n), password: 'password123', roles: [{ role }] })
          .expect(201)
      ).body.id as string;
    const teacherAId = await user(1, 'Saima Bibi', 'TEACHER');
    const teacherBId = await user(2, 'Asif Mehmood', 'TEACHER');
    await user(3, 'Kamran Ali', 'ACCOUNTANT');

    const cls = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 5' }).expect(201))
      .body.id as string;
    const section = async (name: string, classTeacherId: string) =>
      (
        await request(server)
          .post(`/api/classes/${cls}/sections`)
          .set(owner)
          .send({ academicYearId: year, name, classTeacherId })
          .expect(201)
      ).body.id as string;
    sectionA = await section('A', teacherAId);
    sectionB = await section('B', teacherBId);

    const admit = async (sectionId: string, firstName: string, n: number) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId,
            firstName,
            lastName: 'Test',
            gender: 'MALE',
            guardians: [{ name: `${firstName}'s father`, phone: phone(n), relation: 'Father' }],
          })
          .expect(201)
      ).body.id as string;
    ahmed = await admit(sectionA, 'Ahmed', 5);
    sana = await admit(sectionA, 'Sana', 6);
    bilal = await admit(sectionB, 'Bilal', 7);

    // Ten school days in section A: Ahmed present on 4, Sana on all.
    for (let d = 1; d <= 10; d++) {
      await prisma.attendanceSession.create({
        data: {
          schoolId,
          sectionId: sectionA,
          date: dayStart(daysBefore(today, d)),
          records: {
            create: [
              { studentId: ahmed, status: d <= 4 ? 'PRESENT' : 'ABSENT' },
              { studentId: sana, status: 'PRESENT' },
            ],
          },
        },
      });
    }

    examId = (
      await prisma.exam.create({
        data: { schoolId, academicYearId: year, name: 'Mid-term', status: ExamStatus.PUBLISHED, publishedAt: new Date() },
      })
    ).id;
    const result = (studentId: string, percent: number, passed: boolean, position: number) => ({
      examId,
      studentId,
      sectionId: sectionA,
      obtained: percent * 2,
      maxTotal: 200,
      percent,
      grade: passed ? 'B' : 'F',
      position,
      passed,
      subjects: [
        { subject: 'Maths', max: 100, pass: 33, marks: passed ? 80 : 20, absent: false, passed },
        { subject: 'English', max: 100, pass: 33, marks: passed ? 70 : 50, absent: false, passed: true },
      ],
    });
    await prisma.examResult.createMany({ data: [result(ahmed, 35, false, 2), result(sana, 75, true, 1)] });

    await prisma.invoice.create({
      data: {
        schoolId,
        studentId: bilal,
        voucherNo: `AS-${run}`,
        period: daysBefore(today, 105).slice(0, 7),
        dueDate: dayStart(daysBefore(today, 100)),
        total: 5000,
      },
    });

    teacherA = await loginAs(phone(1));
    teacherB = await loginAs(phone(2));
    accountant = await loginAs(phone(3));

    const guardian = await prisma.guardian.findFirstOrThrow({ where: { schoolId, phone: phone(5) } });
    await request(server).post(`/api/students/${ahmed}/guardians/${guardian.id}/invite`).set(owner).expect(201);
    await prisma.user.update({
      where: { schoolId_phone: { schoolId, phone: phone(5) } },
      data: { passwordHash: await bcrypt.hash('password123', 4) },
    });
    parent = await loginAs(phone(5));
  });

  afterAll(async () => {
    for (const s of slugs) await deleteSchools(prisma, { slug: s });
    await app.close();
  });

  beforeEach(() => {
    model.enabled = false;
    model.create.mockReset();
  });

  describe('without an API key', () => {
    it('reports AI as off', async () => {
      const res = await request(server).get('/api/assistant/status').set(teacherA).expect(200);
      expect(res.body).toMatchObject({ ai: false, model: null, usedToday: 0 });
    });

    it('flags a teacher\'s at-risk students from attendance and results only', async () => {
      const res = await request(server).get('/api/assistant/at-risk').set(teacherA).expect(200);
      expect(res.body.sections.map((s: { sectionId: string }) => s.sectionId)).toEqual([sectionA]);
      expect(res.body.areas).toEqual({ attendance: true, results: true, fees: false });
      expect(res.body.checked).toBe(2);
      expect(res.body.students).toHaveLength(1);
      expect(res.body.students[0]).toMatchObject({ studentId: ahmed, level: 'high', section: 'Grade 5 A' });
      expect(res.body.students[0].flags.map((f: { area: string }) => f.area)).toEqual(['attendance', 'results']);
      await request(server).get(`/api/assistant/at-risk?sectionId=${sectionB}`).set(teacherA).expect(404);
    });

    it('shows overdue fees to fee staff', async () => {
      const res = await request(server).get('/api/assistant/at-risk').set(accountant).expect(200);
      expect(res.body.areas.fees).toBe(true);
      const ids = res.body.students.map((s: { studentId: string }) => s.studentId);
      expect(ids).toEqual(expect.arrayContaining([ahmed, bilal]));
      const b = res.body.students.find((s: { studentId: string }) => s.studentId === bilal);
      expect(b.flags).toEqual([expect.objectContaining({ area: 'fees', level: 'high' })]);
    });

    it('drafts a remark from a template', async () => {
      const res = await request(server)
        .post('/api/assistant/draft')
        .set(teacherA)
        .send({ kind: 'report_remark', studentId: ahmed, examId })
        .expect(200);
      expect(res.body.source).toBe('template');
      expect(res.body.text).toContain('Ahmed has shown weak performance in Mid-term with 35% overall.');
      expect(res.body.text.length).toBeLessThanOrEqual(300);
      expect(res.body.facts.overdueFees).toBeNull();
      expect(res.body.examId).toBe(examId);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('offers only the teacher\'s sections and students in the pickers', async () => {
      const opts = await request(server).get('/api/assistant/options').set(teacherA).expect(200);
      expect(opts.body).toEqual({
        sections: [expect.objectContaining({ sectionId: sectionA, name: 'Grade 5 A', students: 2 })],
        exams: [{ id: examId, name: 'Mid-term' }],
      });
      const all = await request(server).get('/api/assistant/students?q=Test').set(teacherA).expect(200);
      expect(all.body.map((s: { studentId: string }) => s.studentId).sort()).toEqual([ahmed, sana].sort());
      const none = await request(server).get('/api/assistant/students?q=Bilal').set(teacherA).expect(200);
      expect(none.body).toEqual([]);
    });

    it('will not draft about a student the teacher does not teach', async () => {
      await request(server)
        .post('/api/assistant/draft')
        .set(teacherA)
        .send({ kind: 'parent_message', studentId: bilal })
        .expect(404);
    });

    it('is closed to parents, Starter plans and roles the school switched off', async () => {
      await request(server).get('/api/assistant/status').set(parent).expect(403);

      await prisma.builtinRolePermission.create({ data: { schoolId, role: 'TEACHER', permissions: { assistant: 'none' } } });
      app.get(PermissionService).forget(schoolId);
      await request(server).get('/api/assistant/status').set(teacherA).expect(403);
      await prisma.builtinRolePermission.deleteMany({ where: { schoolId } });
      app.get(PermissionService).forget(schoolId);

      const sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId } });
      const starter = await prisma.plan.findUniqueOrThrow({ where: { code: 'starter' } });
      await prisma.subscription.update({ where: { schoolId }, data: { planId: starter.id, status: 'ACTIVE' } });
      app.get(SubscriptionService).forget(schoolId);
      const res = await request(server).get('/api/assistant/status').set(owner).expect(403);
      expect(res.body.message).toContain('not part of the Starter plan');
      await prisma.subscription.update({ where: { schoolId }, data: { planId: sub.planId, status: sub.status } });
      app.get(SubscriptionService).forget(schoolId);
      await request(server).get('/api/assistant/status').set(teacherA).expect(200);
    });
  });

  describe('with Claude', () => {
    it('answers through tools that only see the teacher\'s students', async () => {
      model.enabled = true;
      model.create
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage,
          content: [
            { type: 'tool_use', id: 't1', name: 'find_students', input: {} },
            { type: 'tool_use', id: 't2', name: 'fee_report', input: {} },
          ],
        })
        .mockResolvedValueOnce({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'You teach 2 students.' }] });

      const res = await request(server)
        .post('/api/assistant/ask')
        .set(teacherA)
        .send({ question: 'How many students do I teach?' })
        .expect(200);
      expect(res.body).toEqual({ answer: 'You teach 2 students.', sources: ['Student search', 'Fees'] });

      const second = model.create.mock.calls[1][0];
      const results = second.messages.at(-1).content;
      const students = JSON.parse(results[0].content).map((s: { name: string }) => s.name);
      expect(students.sort()).toEqual(['Ahmed Test', 'Sana Test']);
      expect(results[1]).toMatchObject({ tool_use_id: 't2', is_error: true, content: 'Your role does not have access to Fees' });

      const status = await request(server).get('/api/assistant/status').set(teacherA).expect(200);
      expect(status.body).toMatchObject({ ai: true, model: 'test-model', usedToday: 1 });
    });

    it('writes a draft with Claude', async () => {
      model.enabled = true;
      model.create.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        usage,
        content: [{ type: 'text', text: 'Ahmed must attend regularly and revise Maths.' }],
      });
      const res = await request(server)
        .post('/api/assistant/draft')
        .set(teacherA)
        .send({ kind: 'report_remark', studentId: ahmed, notes: 'Needs to revise Maths', language: 'en' })
        .expect(200);
      expect(res.body).toMatchObject({ source: 'ai', text: 'Ahmed must attend regularly and revise Maths.' });
      const prompt = model.create.mock.calls[0][0].messages[0].content as string;
      expect(prompt).toContain('Needs to revise Maths');
      expect(prompt).not.toContain(phone(5));
    });

    it('stops at the daily limit', async () => {
      model.enabled = true;
      const userId = (await prisma.user.findUniqueOrThrow({ where: { schoolId_phone: { schoolId, phone: phone(2) } } })).id;
      await prisma.assistantUsage.createMany({
        data: Array.from({ length: 100 }, () => ({ schoolId, userId, kind: 'ASK' as const, model: 'test-model' })),
      });
      const res = await request(server).post('/api/assistant/ask').set(teacherB).send({ question: 'Hi' }).expect(429);
      expect(res.body.message).toContain('daily limit');
      expect(model.create).not.toHaveBeenCalled();
    });
  });
});
