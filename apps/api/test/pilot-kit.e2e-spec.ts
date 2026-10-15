import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday } from '../src/common/dates.js';
import { FilesService } from '../src/elearning/files/files.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

// SCHOOL-150 pilot kit: "Report a problem" and its console inbox, the owner's
// setup checklist, the parallel-run comparison reports (campus-scoped,
// reversed payments left out) and the console's pilot health.
describe('Pilot kit (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `034${run.slice(-7)}${n}`;
  const today = localToday();
  const period = today.slice(0, 7);
  const year = today.slice(0, 4);
  // Vouchers carry their issue day as the database's date, which can be a day behind local time.
  const from = daysBefore(today, 2);
  const range = `from=${from}&to=${today}`;
  const slugs: string[] = [];
  const adminEmails = [`pilot-owner+${run}@schoolsyncer.test`, `pilot-support+${run}@schoolsyncer.test`];

  let schoolId: string;
  let schoolSlug: string;
  const h: Record<'owner' | 'teacher' | 'accountant' | 'campusAdmin' | 'northTeacher' | 'support' | 'platformOwner', Headers> =
    {} as never;
  const kid: Record<'paid' | 'part' | 'north', string> = {} as never;
  const sec: Record<'main' | 'north', string> = {} as never;
  let reportId = '';
  let screenshotId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function loginAs(login: string) {
    const res = await request(server).post('/api/auth/login').send({ schoolSlug, login, password: 'password123' }).expect(200);
    await keepIssuedPassword(app, res.body);
    return auth(res.body.accessToken);
  }
  const register = async (name: string) => {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `${name} ${run}`, ownerName: 'Owner', email: `pilot-${name.toLowerCase()}+${run}@test.pk`, password: 'password123' })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    return reg.body as { schoolSlug: string; accessToken: string; user: { schoolId: string; sub: string } };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await register('Pilot');
    schoolId = reg.user.schoolId;
    schoolSlug = reg.schoolSlug;
    const owner = auth(reg.accessToken);
    h.owner = owner;
    const post = async (path: string, body: object, as: Headers = owner) =>
      (await request(server).post(path).set(as).send(body).expect(201)).body;
    const put = async (path: string, body: object) => (await request(server).put(path).set(owner).send(body).expect(200)).body;

    const main = (await request(server).get('/api/campuses').set(owner)).body[0].id as string;
    const north = (await post('/api/campuses', { name: `North ${run}` })).id as string;
    const yearId = (await post('/api/academic-years', { name: year, startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, isCurrent: true })).id;
    const user = async (n: number, roles: { role: string; campusId?: string }[]) =>
      (await post('/api/users', { name: `User ${n}`, phone: phone(n), password: 'password123', roles })).id as string;
    await user(1, [{ role: 'TEACHER', campusId: main }]);
    await user(2, [{ role: 'ACCOUNTANT', campusId: main }]);
    await user(3, [{ role: 'ADMIN', campusId: main }]);
    await user(4, [{ role: 'TEACHER', campusId: north }]);
    h.teacher = await loginAs(phone(1));
    h.accountant = await loginAs(phone(2));
    h.campusAdmin = await loginAs(phone(3));
    h.northTeacher = await loginAs(phone(4));

    const mainClass = (await post('/api/classes', { campusId: main, name: 'Grade 1' })).id;
    const northClass = (await post('/api/classes', { campusId: north, name: 'Grade 1' })).id;
    sec.main = (await post(`/api/classes/${mainClass}/sections`, { academicYearId: yearId, name: 'A' })).id;
    sec.north = (await post(`/api/classes/${northClass}/sections`, { academicYearId: yearId, name: 'A' })).id;
    const admit = async (sectionId: string, firstName: string, n: number) =>
      (
        await post('/api/students', {
          sectionId,
          firstName,
          gender: 'MALE',
          guardians: [{ name: `Parent ${n}`, phone: `033${run.slice(-7)}${n}`, relation: 'Father' }],
        })
      ).id as string;
    kid.paid = await admit(sec.main, 'Ahmed', 1);
    kid.part = await admit(sec.main, 'Bilal', 2);
    kid.north = await admit(sec.north, 'Usman', 3);

    const tuition = (await post('/api/fees/heads', { name: 'Tuition' })).id;
    const computer = (await post('/api/fees/heads', { name: 'Computer' })).id;
    for (const classId of [mainClass, northClass]) {
      await put('/api/fees/structures', { classId, feeHeadId: tuition, academicYearId: yearId, amount: 5000 });
      await put('/api/fees/structures', { classId, feeHeadId: computer, academicYearId: yearId, amount: 1000 });
    }
    await post('/api/fees/invoices/generate', { period });
    const voucher = async (studentId: string) => (await prisma.invoice.findFirstOrThrow({ where: { studentId } })).id;
    const pay = async (studentId: string, amount: number, method: string) =>
      (await post(`/api/fees/invoices/${await voucher(studentId)}/payments`, { amount, method })).payment.id as string;
    await pay(kid.paid, 6000, 'CASH');
    await pay(kid.part, 2000, 'BANK');
    await pay(kid.north, 3000, 'CASH');
    const bounced = await pay(kid.north, 1000, 'BANK');
    await request(server).post(`/api/fees/payments/${bounced}/reverse`).set(owner).send({ reason: 'Cheque bounced' }).expect(200);

    const sheet = (sectionId: string, records: [string, string][]) =>
      request(server)
        .put('/api/attendance/sheet')
        .set(owner)
        .send({ sectionId, date: today, records: records.map(([studentId, status]) => ({ studentId, status })) })
        .expect(200);
    await sheet(sec.main, [
      [kid.paid, 'PRESENT'],
      [kid.part, 'ABSENT'],
    ]);
    await sheet(sec.north, [[kid.north, 'LATE']]);

    const passwordHash = await bcrypt.hash('password123', 4);
    await prisma.platformAdmin.create({ data: { email: adminEmails[0], name: 'Pilot Owner', role: 'OWNER', passwordHash } });
    await prisma.platformAdmin.create({ data: { email: adminEmails[1], name: 'Pilot Support', role: 'SUPPORT', passwordHash } });
    const platformLogin = async (email: string) =>
      auth((await request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken);
    h.platformOwner = await platformLogin(adminEmails[0]);
    h.support = await platformLogin(adminEmails[1]);
  });

  afterAll(async () => {
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    const admins = { email: { in: adminEmails } };
    await prisma.platformAuditLog.deleteMany({ where: { admin: admins } });
    await prisma.platformAdmin.deleteMany({ where: admins });
    await app.close();
  });

  describe('report a problem', () => {
    it('takes a screenshot through the upload checks', async () => {
      await request(server).post('/api/problem-reports/screenshot').set(h.teacher).attach('file', Buffer.from('%PDF-1.7'), 'shot.pdf').expect(400);
      await request(server).post('/api/problem-reports/screenshot').set(h.teacher).attach('file', Buffer.from('not a png'), 'shot.png').expect(400);
      const res = await request(server).post('/api/problem-reports/screenshot').set(h.teacher).attach('file', png, 'shot.png').expect(201);
      expect(res.body).toMatchObject({ filename: 'shot.png', kind: 'image' });
      screenshotId = res.body.id;
    });

    it('records the message, page, role, version, browser and screenshot', async () => {
      await request(server).post('/api/problem-reports').set(h.teacher).send({ message: 'Hi', page: '/attendance' }).expect(400);
      await request(server).post('/api/problem-reports').set(h.teacher).send({ message: 'Save button spins', page: '' }).expect(400);
      const res = await request(server)
        .post('/api/problem-reports')
        .set(h.teacher)
        .set('User-Agent', 'PilotBrowser/1.0')
        .send({ message: 'The register would not save', page: '/attendance?tab=matrix', appVersion: '0.1.0', screenshotId })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'NEW',
        source: 'WEB',
        page: '/attendance?tab=matrix',
        appVersion: '0.1.0',
        browser: 'PilotBrowser/1.0',
        roles: ['TEACHER'],
        reporterName: 'User 1',
        hasScreenshot: true,
        history: [],
      });
      reportId = res.body.id;
      const mobile = await request(server)
        .post('/api/problem-reports')
        .set(h.northTeacher)
        .send({ message: 'Homework screen is blank', page: 'teacher/homework', source: 'MOBILE', browser: 'android 14' })
        .expect(201);
      expect(mobile.body).toMatchObject({ source: 'MOBILE', browser: 'android 14', hasScreenshot: false });
    });

    it("refuses someone else's or an already attached screenshot", async () => {
      await request(server)
        .post('/api/problem-reports')
        .set(h.accountant)
        .send({ message: 'Borrowed screenshot', page: '/fees', screenshotId })
        .expect(400);
      await request(server)
        .post('/api/problem-reports')
        .set(h.teacher)
        .send({ message: 'Same screenshot twice', page: '/fees', screenshotId })
        .expect(400);
    });

    it('keeps an attached screenshot when unused uploads are cleared', async () => {
      await app.get(FilesService).release([screenshotId]);
      expect(await prisma.storedFile.count({ where: { id: screenshotId } })).toBe(1);
    });

    it('shows reporters their own reports and the owner the whole school', async () => {
      const mine = await request(server).get('/api/problem-reports').set(h.teacher).expect(200);
      expect(mine.body).toMatchObject({ canSeeSchool: false });
      expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual([reportId]);
      expect((await request(server).get('/api/problem-reports').set(h.accountant).expect(200)).body.items).toEqual([]);
      await request(server).get('/api/problem-reports?scope=school').set(h.teacher).expect(403);
      await request(server).get('/api/problem-reports?scope=school').set(h.campusAdmin).expect(403);
      const school = await request(server).get('/api/problem-reports?scope=school').set(h.owner).expect(200);
      expect(school.body.canSeeSchool).toBe(true);
      expect(school.body.items).toHaveLength(2);

      const detail = await request(server).get(`/api/problem-reports/${reportId}`).set(h.teacher).expect(200);
      expect(detail.body.screenshot).toMatchObject({ id: screenshotId, kind: 'image' });
      expect(detail.body.screenshot.url).toBeTruthy();
      await request(server).get(`/api/problem-reports/${reportId}`).set(h.owner).expect(200);
      await request(server).get(`/api/problem-reports/${reportId}`).set(h.accountant).expect(404);
      await request(server).get(`/api/problem-reports/${reportId}`).set(h.northTeacher).expect(404);
    });

    it('limits how many reports one person sends an hour', async () => {
      for (let i = 0; i < 10; i++) {
        await request(server).post('/api/problem-reports').set(h.accountant).send({ message: `Report number ${i}`, page: '/fees' }).expect(201);
      }
      const refused = await request(server).post('/api/problem-reports').set(h.accountant).send({ message: 'One too many', page: '/fees' }).expect(429);
      expect(refused.body.message).toMatch(/Too many requests/);
      // Someone else still can.
      await request(server).post('/api/problem-reports').set(h.campusAdmin).send({ message: 'Different person', page: '/classes' }).expect(201);
    });
  });

  describe('problem report inbox (console)', () => {
    it('is for SchoolSyncer staff only', async () => {
      await request(server).get('/api/platform/problem-reports').set(h.owner).expect(401);
      await request(server).patch(`/api/platform/problem-reports/${reportId}`).set(h.owner).send({ status: 'FIXED' }).expect(401);
      await request(server).get('/api/problem-reports').set(h.support).expect(401);
    });

    it('lists and filters reports with their school', async () => {
      const all = await request(server).get(`/api/platform/problem-reports?schoolId=${schoolId}`).set(h.support).expect(200);
      expect(all.body.total).toBe(13);
      expect(all.body.counts).toMatchObject({ NEW: 13, IN_PROGRESS: 0, FIXED: 0, WONT_FIX: 0 });
      expect(all.body.items[0].school).toMatchObject({ id: schoolId, slug: schoolSlug });
      const found = await request(server).get(`/api/platform/problem-reports?schoolId=${schoolId}&q=register would`).set(h.support).expect(200);
      expect(found.body.items.map((r: { id: string }) => r.id)).toEqual([reportId]);
      await request(server).get('/api/platform/problem-reports?status=DONE').set(h.support).expect(400);
      await request(server).get('/api/platform/problem-reports/nope').set(h.support).expect(404);
    });

    it('moves a report through its statuses with internal notes the school never sees', async () => {
      await request(server).patch(`/api/platform/problem-reports/${reportId}`).set(h.support).send({ status: 'DONE' }).expect(400);
      await request(server).patch(`/api/platform/problem-reports/${reportId}`).set(h.support).send({ status: 'IN_PROGRESS' }).expect(200);
      await request(server).post(`/api/platform/problem-reports/${reportId}/notes`).set(h.support).send({ note: '' }).expect(400);
      const noted = await request(server)
        .post(`/api/platform/problem-reports/${reportId}/notes`)
        .set(h.support)
        .send({ note: 'Reproduced on Chrome; save times out on slow 3G' })
        .expect(201);
      expect(noted.body.activity.map((a: { note: string | null }) => a.note)).toContain('Reproduced on Chrome; save times out on slow 3G');
      const fixed = await request(server).patch(`/api/platform/problem-reports/${reportId}`).set(h.platformOwner).send({ status: 'FIXED' }).expect(200);
      expect(fixed.body).toMatchObject({ status: 'FIXED', reporter: { name: 'User 1', phone: expect.any(String) } });
      expect(fixed.body.screenshot.url).toBeTruthy();
      // Setting the same status again records nothing.
      await request(server).patch(`/api/platform/problem-reports/${reportId}`).set(h.platformOwner).send({ status: 'FIXED' }).expect(200);
      expect(await prisma.problemReportActivity.count({ where: { reportId } })).toBe(3);
      expect(await prisma.platformAuditLog.count({ where: { action: 'problem_report.status', schoolId } })).toBe(2);

      const seen = await request(server).get(`/api/problem-reports/${reportId}`).set(h.teacher).expect(200);
      expect(seen.body.status).toBe('FIXED');
      expect(seen.body.history.map((e: { status: string }) => e.status)).toEqual(['IN_PROGRESS', 'FIXED']);
      expect(JSON.stringify(seen.body)).not.toContain('Reproduced on Chrome');
      expect(JSON.stringify(seen.body)).not.toContain('Pilot Support');
      const open = await request(server).get(`/api/platform/problem-reports?schoolId=${schoolId}&open=true`).set(h.support).expect(200);
      expect(open.body.total).toBe(12);
    });
  });

  describe('setup checklist', () => {
    it('is the owner’s only', async () => {
      await request(server).get('/api/dashboard/setup-checklist').set(h.teacher).expect(403);
      await request(server).get('/api/dashboard/setup-checklist').set(h.campusAdmin).expect(403);
      await request(server).post('/api/dashboard/setup-checklist/dismiss').set(h.accountant).expect(403);
    });

    it('shows a new school what is left, each item linking to its screen', async () => {
      const fresh = await register('Fresh');
      const res = await request(server).get('/api/dashboard/setup-checklist').set(auth(fresh.accessToken)).expect(200);
      expect(res.body).toMatchObject({ visible: true, complete: false, total: 9, dismissedAt: null });
      const done = Object.fromEntries(res.body.items.map((i: { key: string; done: boolean }) => [i.key, i.done]));
      expect(done).toMatchObject({ 'academic-year': false, classes: false, students: false, fees: false, staff: false, attendance: false, vouchers: false });
      expect(res.body.items.find((i: { key: string }) => i.key === 'fees').href).toBe('/fees?tab=setup');
    });

    it('ticks off what this school has done, and can be dismissed and brought back', async () => {
      const res = await request(server).get('/api/dashboard/setup-checklist').set(h.owner).expect(200);
      const done = Object.fromEntries(res.body.items.map((i: { key: string; done: boolean }) => [i.key, i.done]));
      expect(done).toMatchObject({ 'academic-year': true, classes: true, students: true, fees: true, staff: true, attendance: true, vouchers: true, profile: false });
      expect(res.body.visible).toBe(true);
      const hidden = await request(server).post('/api/dashboard/setup-checklist/dismiss').set(h.owner).expect(200);
      expect(hidden.body).toMatchObject({ visible: false, complete: false });
      expect(hidden.body.dismissedAt).toBeTruthy();
      const back = await request(server).delete('/api/dashboard/setup-checklist/dismiss').set(h.owner).expect(200);
      expect(back.body).toMatchObject({ visible: true, dismissedAt: null });
    });
  });

  describe('parallel-run reports', () => {
    const fees = (as: Headers) => request(server).get(`/api/reports/parallel-run/fees?${range}`).set(as).expect(200);

    it('adds up fees per day, method and head, leaving the reversed payment out', async () => {
      const r = (await fees(h.owner)).body;
      expect(r).toMatchObject({ total: 11000, receipts: 3 });
      expect(r.byMethod).toEqual([
        { name: 'CASH', total: 9000, receipts: 2 },
        { name: 'BANK', total: 2000, receipts: 1 },
      ]);
      expect(r.byDay).toEqual([{ date: today, total: 11000, receipts: 3, byMethod: { CASH: 9000, BANK: 2000 } }]);
      const heads = Object.fromEntries(r.byHead.map((b: { name: string; total: number }) => [b.name, b.total]));
      expect(Object.keys(heads).sort()).toEqual(['Computer', 'Tuition']);
      expect(heads.Tuition + heads.Computer).toBe(11000);
      // The fully paid voucher pays each head in full.
      expect(heads.Tuition).toBeGreaterThanOrEqual(5000);
      expect(heads.Computer).toBeGreaterThanOrEqual(1000);
    });

    it("covers only a campus-limited accountant's campus", async () => {
      const r = (await fees(h.accountant)).body;
      expect(r).toMatchObject({ total: 8000, receipts: 2 });
      expect(r.byHead.reduce((s: number, b: { total: number }) => s + b.total, 0)).toBe(8000);
    });

    it('counts vouchers issued against paid', async () => {
      const all = (await request(server).get(`/api/reports/parallel-run/vouchers?${range}`).set(h.owner).expect(200)).body;
      expect(all.totals).toMatchObject({ issued: 3, billed: 18000, paid: 1, partial: 2, unpaid: 0, collected: 11000, outstanding: 7000 });
      expect(all.byPeriod.map((p: { name: string }) => p.name)).toEqual([period]);
      const mine = (await request(server).get(`/api/reports/parallel-run/vouchers?${range}`).set(h.accountant).expect(200)).body;
      expect(mine.totals).toMatchObject({ issued: 2, billed: 12000, collected: 8000 });
    });

    it('grids attendance per section per day, scoped to the campuses an admin runs', async () => {
      const all = (await request(server).get(`/api/reports/parallel-run/attendance?${range}`).set(h.owner).expect(200)).body;
      expect(all.dates).toEqual([today]);
      expect(all.sections.map((s: { sectionId: string }) => s.sectionId).sort()).toEqual([sec.main, sec.north].sort());
      const main = all.sections.find((s: { sectionId: string }) => s.sectionId === sec.main);
      expect(main.cells[today]).toEqual({ present: 1, marked: 2, percent: 50 });
      // Late counts as present.
      expect(all).toMatchObject({ present: 2, marked: 3, percent: 66.7 });
      const scoped = (await request(server).get(`/api/reports/parallel-run/attendance?${range}`).set(h.campusAdmin).expect(200)).body;
      expect(scoped.sections.map((s: { sectionId: string }) => s.sectionId)).toEqual([sec.main]);
      expect(scoped.byDate).toEqual([{ date: today, sections: 1, present: 1, marked: 2, percent: 50 }]);
    });

    it('checks roles and dates', async () => {
      await request(server).get(`/api/reports/parallel-run/attendance?${range}`).set(h.teacher).expect(403);
      await request(server).get(`/api/reports/parallel-run/fees?${range}`).set(h.teacher).expect(403);
      await request(server).get(`/api/reports/parallel-run/vouchers?${range}`).set(h.campusAdmin).expect(200);
      await request(server).get(`/api/reports/parallel-run/fees?from=${today}&to=${from}`).set(h.owner).expect(400);
      await request(server).get(`/api/reports/parallel-run/fees?from=${daysBefore(today, 120)}&to=${today}`).set(h.owner).expect(400);
    });
  });

  describe('pilot health (console)', () => {
    const health = (as: Headers, id = schoolId, q = range) => request(server).get(`/api/platform/schools/${id}/pilot-health?${q}`).set(as);

    it('is for SchoolSyncer staff only', async () => {
      await health(h.owner).expect(401);
      await health(h.support, 'no-such-school').expect(404);
      await health(h.support, schoolId, `from=${daysBefore(today, 120)}&to=${today}`).expect(400);
    });

    it("sums up the school's month", async () => {
      const r = (await health(h.support).expect(200)).body;
      expect(r.school).toMatchObject({ id: schoolId, slug: schoolSlug });
      const day = r.activeUsers.days.find((d: { date: string }) => d.date === today);
      // The owner, two teachers, the accountant and the campus admin all used it today.
      expect(day).toMatchObject({ total: 5, byRole: { OWNER: 1, TEACHER: 2, ACCOUNTANT: 1, ADMIN: 1 } });
      expect(r.activeUsers.days).toHaveLength(3);
      expect(r.attendance.schoolDays).toBe(1);
      expect(r.attendance.sections).toHaveLength(2);
      expect(r.attendance.sections.every((s: { days: number; missed: number }) => s.days === 1 && s.missed === 0)).toBe(true);
      expect(r.vouchers).toMatchObject({ generated: 3, voided: 0 });
      expect(r.payments).toEqual({ recorded: 3, amount: 11000, reversed: 1 });
      expect(r.messages).toHaveProperty('FAILED');
      expect(r.messages).toHaveProperty('LOGGED');
      expect(r.problemReports).toMatchObject({ open: 12, inRange: 13 });
      expect(r.problemReports.latestOpen).toHaveLength(5);
      expect(r.lastActivity.at).toBeTruthy();
      expect(r.lastActivity.payment).toBeTruthy();
    });
  });
});
