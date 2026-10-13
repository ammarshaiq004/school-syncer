import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

const mp4 = (size = 2048) => {
  const b = Buffer.alloc(size, 7);
  b.write('ftypisom', 4, 'latin1');
  return b;
};
const pdf = Buffer.from('%PDF-1.7\n% worksheet\n');

/** The path and query of a signed link, so supertest can call it on the test server. */
const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

// Uploads for lessons, assignments and submissions on the local storage driver.
describe('E-school files (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const storageDir = mkdtempSync(join(tmpdir(), 'schoolsyncer-files-'));
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const slugs: string[] = [];
  const phone = (n: number) => `036${run.slice(-7)}${n}`;
  const tinyPlan = `tiny-${run}`;

  let schoolId: string;
  let owner: Headers;
  let teacher: Headers;
  let otherTeacher: Headers;
  let accountant: Headers;
  let studentA: Headers;
  let studentB: Headers;
  let rivalOwner: Headers;
  let sectionA: string;
  let maths: string;
  let courseId: string;
  let unitId: string;
  let lessonId: string;
  let videoId: string;

  const upload = (as: Headers, path: string, name: string, content: Buffer) =>
    request(server).post(path).set(as).attach('file', content, name);

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = storageDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const register = async (name: string, email: string) => {
      const reg = await request(server)
        .post('/api/auth/register-school')
        .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' })
        .expect(201);
      slugs.push(reg.body.schoolSlug);
      return reg.body as { schoolSlug: string; accessToken: string; user: { schoolId: string } };
    };
    const reg = await register(`Files ${run}`, `files+${run}@test.pk`);
    schoolId = reg.user.schoolId;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
    const loginAs = async (login: string) => {
      const res = await request(server)
        .post('/api/auth/login')
        .send({ schoolSlug: reg.schoolSlug, login, password: 'password123' })
        .expect(200);
      await keepIssuedPassword(app, res.body);
      return { Authorization: `Bearer ${res.body.accessToken}` };
    };

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 8' }).expect(201)
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
    maths = (await request(server).post('/api/subjects').set(owner).send({ name: 'Maths' }).expect(201)).body.id;
    const makeUser = async (n: number, role: string) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name: `Staff ${n}`, phone: phone(n), password: 'password123', roles: [{ role }] })
          .expect(201)
      ).body.id as string;
    const teacherId = await makeUser(1, 'TEACHER');
    await makeUser(2, 'TEACHER');
    await makeUser(3, 'ACCOUNTANT');
    await request(server)
      .put(`/api/classes/sections/${sectionA}/subjects`)
      .set(owner)
      .send({ subjects: [{ subjectId: maths, teacherId }] })
      .expect(200);
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));
    accountant = await loginAs(phone(3));

    const studentLogin = async (sectionId: string, firstName: string, n: number) => {
      const id = (
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
      const user = await prisma.user.create({
        data: { schoolId, name: firstName, username: `f${run}${n}`, roles: { create: { role: 'STUDENT' } } },
      });
      await prisma.student.update({ where: { id }, data: { userId: user.id } });
      const token = app.get(JwtService).sign({
        sub: user.id,
        schoolId,
        name: firstName,
        roles: [{ role: 'STUDENT', campusId: null, customRoleId: null }],
      });
      return { Authorization: `Bearer ${token}` };
    };
    studentA = await studentLogin(sectionA, 'Sana', 5);
    studentB = await studentLogin(sectionB, 'Zara', 6);

    const rival = await register(`Rival files ${run}`, `rival-files+${run}@test.pk`);
    rivalOwner = { Authorization: `Bearer ${rival.accessToken}` };

    courseId = (
      await request(server)
        .post('/api/elearning/courses')
        .set(teacher)
        .send({ sectionId: sectionA, subjectId: maths })
        .expect(201)
    ).body.id;
    unitId = (
      await request(server).post(`/api/elearning/courses/${courseId}/units`).set(teacher).send({ title: 'Algebra' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await prisma.plan.deleteMany({ where: { code: tinyPlan } });
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('checks the type, contents and uploader of every upload', async () => {
    await upload(teacher, '/api/elearning/files?purpose=LESSON', 'page.html', Buffer.from('<html>'))
      .expect(400);
    const spoofed = await upload(teacher, '/api/elearning/files?purpose=LESSON', 'notes.pdf', Buffer.from('MZ\x90'))
      .expect(400);
    expect(spoofed.body.message).toBe('This file does not look like a real .pdf file');
    await upload(teacher, '/api/elearning/files?purpose=SUBMISSION', 'a.pdf', pdf).expect(400);
    await upload(teacher, '/api/elearning/files', 'a.pdf', pdf).expect(400);
    await request(server).post('/api/elearning/files?purpose=LESSON').set(teacher).expect(400);
    await upload(accountant, '/api/elearning/files?purpose=LESSON', 'a.pdf', pdf).expect(403);
    await upload(studentA, '/api/elearning/files?purpose=LESSON', 'a.pdf', pdf).expect(403);

    const rules = await request(server).get('/api/files/rules').set(teacher).expect(200);
    expect(rules.body.LESSON.extensions).toContain('mp4');
    expect(rules.body.ASSIGNMENT.extensions).not.toContain('mp4');
  });

  it('uploads a lesson video and serves it through a signed link with range support', async () => {
    const res = await upload(teacher, '/api/elearning/files?purpose=LESSON', 'Linear equations.mp4', mp4(4096))
      .expect(201);
    videoId = res.body.id;
    expect(res.body).toMatchObject({ filename: 'Linear equations.mp4', mimeType: 'video/mp4', kind: 'video', size: 4096 });

    const stored = await prisma.storedFile.findUniqueOrThrow({ where: { id: videoId } });
    expect(stored.key).toMatch(new RegExp(`^schools/${schoolId}/lesson/[0-9a-f-]+\\.mp4$`));
    expect(existsSync(join(storageDir, stored.key))).toBe(true);

    const full = await request(server).get(pathOf(res.body.url)).expect(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(full.headers['content-disposition']).toContain('inline');
    const part = await request(server).get(pathOf(res.body.url)).set('Range', 'bytes=0-99').expect(206);
    expect(part.headers['content-range']).toBe('bytes 0-99/4096');

    const forged = res.body.url.replace(/sig=[^&]+/, 'sig=forged');
    await request(server).get(pathOf(forged)).expect(404);
    const expired = res.body.url.replace(/exp=\d+/, 'exp=1000');
    await request(server).get(pathOf(expired)).expect(404);

    // Not attached yet: only the uploader can open it.
    await request(server).get(`/api/files/${videoId}`).set(teacher).expect(200);
    await request(server).get(`/api/files/${videoId}`).set(owner).expect(404);
  });

  it('attaches the video to a lesson and shows it only to people who can see the lesson', async () => {
    await request(server)
      .post(`/api/elearning/units/${unitId}/lessons`)
      .set(otherTeacher)
      .send({ title: 'Stolen', kind: 'VIDEO', fileId: videoId })
      .expect(404);
    const doc = await upload(teacher, '/api/elearning/files?purpose=LESSON', 'sheet.pdf', pdf).expect(201);
    await request(server)
      .post(`/api/elearning/units/${unitId}/lessons`)
      .set(teacher)
      .send({ title: 'Wrong type', kind: 'VIDEO', fileId: doc.body.id })
      .expect(400);
    await request(server)
      .post(`/api/elearning/units/${unitId}/lessons`)
      .set(teacher)
      .send({ title: 'Reading', kind: 'TEXT', body: 'Text', fileId: doc.body.id })
      .expect(400);

    const lesson = await request(server)
      .post(`/api/elearning/units/${unitId}/lessons`)
      .set(teacher)
      .send({ title: 'Solving for x', kind: 'VIDEO', fileId: videoId, isPublished: true })
      .expect(201);
    lessonId = lesson.body.id;
    expect(lesson.body.file).toMatchObject({ id: videoId, kind: 'video' });
    expect(lesson.body.file.url).toContain(`/api/files/${videoId}/content?`);

    // The same upload cannot back a second lesson.
    await request(server)
      .post(`/api/elearning/units/${unitId}/lessons`)
      .set(teacher)
      .send({ title: 'Copy', kind: 'VIDEO', fileId: videoId })
      .expect(409);

    const detail = await request(server).get(`/api/elearning/courses/${courseId}`).set(owner).expect(200);
    expect(detail.body.units[0].lessons[0].file.id).toBe(videoId);
    await request(server).get(`/api/files/${videoId}`).set(owner).expect(200);
    await request(server).get(`/api/files/${videoId}`).set(otherTeacher).expect(404);
    await request(server).get(`/api/files/${videoId}`).set(rivalOwner).expect(404);

    // The course is still a draft, so students cannot open the file yet.
    await request(server).get(`/api/files/${videoId}`).set(studentA).expect(404);
    await request(server).patch(`/api/elearning/courses/${courseId}`).set(teacher).send({ isPublished: true }).expect(200);
    const seen = await request(server).get(`/api/student/lessons/${lessonId}`).set(studentA).expect(200);
    expect(seen.body.file).toMatchObject({ id: videoId, mimeType: 'video/mp4' });
    await request(server).get(pathOf(seen.body.file.url)).expect(200);
    await request(server).get(`/api/files/${videoId}`).set(studentA).expect(200);
    await request(server).get(`/api/files/${videoId}`).set(studentB).expect(404);

    // Turning the lesson into a link lesson needs the file removed first.
    await request(server).patch(`/api/elearning/lessons/${lessonId}`).set(teacher).send({ kind: 'LINK', url: 'https://example.com' }).expect(400);
  });

  it('removes the old file from storage when a lesson video is replaced', async () => {
    const old = await prisma.storedFile.findUniqueOrThrow({ where: { id: videoId } });
    const next = await upload(teacher, '/api/elearning/files?purpose=LESSON', 'take 2.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))
      .expect(201);
    const updated = await request(server)
      .patch(`/api/elearning/lessons/${lessonId}`)
      .set(teacher)
      .send({ fileId: next.body.id })
      .expect(200);
    expect(updated.body.file).toMatchObject({ id: next.body.id, mimeType: 'video/webm' });
    expect(await prisma.storedFile.findUnique({ where: { id: videoId } })).toBeNull();
    expect(existsSync(join(storageDir, old.key))).toBe(false);

    await request(server).delete(`/api/elearning/lessons/${lessonId}`).set(teacher).expect(200);
    expect(await prisma.storedFile.findUnique({ where: { id: next.body.id } })).toBeNull();
  });

  it('carries files on assignments and student submissions', async () => {
    const brief = await upload(teacher, '/api/elearning/files?purpose=ASSIGNMENT', 'brief.pdf', pdf).expect(201);
    const created = await request(server)
      .post('/api/elearning/assignments')
      .set(teacher)
      .send({
        sectionId: sectionA,
        subjectId: maths,
        title: 'Equations practice',
        dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        attachmentId: brief.body.id,
        isPublished: true,
      })
      .expect(201);
    expect(created.body.attachment).toMatchObject({ id: brief.body.id, filename: 'brief.pdf' });
    const assignmentId = created.body.id;

    const seen = await request(server).get(`/api/student/assignments/${assignmentId}`).set(studentA).expect(200);
    expect(seen.body.attachment.url).toBeTruthy();
    await request(server).get(`/api/files/${brief.body.id}`).set(studentB).expect(404);

    const work = await upload(studentA, '/api/student/files', 'my work.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))
      .expect(201);
    await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ fileId: brief.body.id })
      .expect(400);
    const submitted = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ fileId: work.body.id })
      .expect(200);
    expect(submitted.body.file).toMatchObject({ id: work.body.id, mimeType: 'image/jpeg' });

    // Resubmitting text only keeps the file; null removes it.
    const again = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ body: 'Also see my photo' })
      .expect(200);
    expect(again.body.file.id).toBe(work.body.id);

    const table = await request(server).get(`/api/elearning/assignments/${assignmentId}/submissions`).set(teacher).expect(200);
    const row = table.body.students.find((s: { submission: unknown }) => s.submission);
    expect(row.submission.file).toMatchObject({ id: work.body.id });
    await request(server).get(pathOf(row.submission.file.url)).expect(200);
    await request(server).get(`/api/files/${work.body.id}`).set(otherTeacher).expect(404);
    await request(server).get(`/api/files/${work.body.id}`).set(studentB).expect(404);

    const cleared = await request(server)
      .put(`/api/student/assignments/${assignmentId}/submission`)
      .set(studentA)
      .send({ body: 'Text only now', fileId: null })
      .expect(200);
    expect(cleared.body.file).toBeNull();
    expect(await prisma.storedFile.findUnique({ where: { id: work.body.id } })).toBeNull();

    await request(server).delete(`/api/elearning/assignments/${assignmentId}`).set(teacher).expect(200);
    expect(await prisma.storedFile.findUnique({ where: { id: brief.body.id } })).toBeNull();
  });

  it('lets the uploader delete an unattached file', async () => {
    const res = await upload(teacher, '/api/elearning/files?purpose=ASSIGNMENT', 'oops.pdf', pdf).expect(201);
    await request(server).delete(`/api/files/${res.body.id}`).set(otherTeacher).expect(404);
    await request(server).delete(`/api/files/${res.body.id}`).set(teacher).expect(200);
    expect(await prisma.storedFile.findUnique({ where: { id: res.body.id } })).toBeNull();
  });

  it("enforces the plan's storage allowance", async () => {
    const plan = await prisma.plan.create({
      data: {
        code: tinyPlan,
        name: 'Tiny',
        pricePerStudent: 1,
        minimumMonthly: 1,
        maxStorageMb: 1,
        features: ['elearning'],
        isPublic: false,
      },
    });
    await prisma.subscription.update({ where: { schoolId }, data: { planId: plan.id } });
    app.get(SubscriptionService).forget(schoolId);

    await upload(teacher, '/api/elearning/files?purpose=LESSON', 'a.mp4', mp4(600 * 1024)).expect(201);
    const full = await upload(teacher, '/api/elearning/files?purpose=LESSON', 'b.mp4', mp4(600 * 1024)).expect(409);
    expect(full.body.message).toContain('of its 1 MB file storage');
    const usage = await request(server).get('/api/elearning/files/usage').set(owner).expect(200);
    expect(usage.body).toMatchObject({ limitBytes: 1024 * 1024, driver: 'local' });
    expect(usage.body.usedBytes).toBeGreaterThanOrEqual(600 * 1024);
  });
});
