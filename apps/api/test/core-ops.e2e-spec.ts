import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { sign } from '../src/fees/payment-webhook.controller.js';
import { NotificationsService, type OutgoingMessage } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

const WEBHOOK_SECRET = 'test-jazzcash-secret';

// Walks one school through Phase 1: admissions, attendance, fees, payments, parents.
describe('Core operations (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const sent: OutgoingMessage[] = [];
  // Test files run in parallel; a random suffix keeps their schools apart.
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const email = `ops+${run}@test.pk`;
  const phone = (n: number) => `030${run.slice(-7)}${n}`;

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let otherTeacher: Record<string, string>;
  let schoolSlug: string;
  let campusId: string;
  let sectionId: string;
  let studentA: string;
  let studentB: string;

  beforeAll(async () => {
    process.env.PAYMENT_WEBHOOK_SECRET_JAZZCASH = WEBHOOK_SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const notifications = app.get(NotificationsService);
    const original = notifications.send.bind(notifications);
    vi.spyOn(notifications, 'send').mockImplementation(async (schoolId, messages) => {
      sent.push(...messages);
      return original(schoolId, messages);
    });

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Ops ${run}`, ownerName: 'Owner', email, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  async function loginAs(login: string, password = 'password123') {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  it('sets up a year, a class, a section and two teachers', async () => {
    campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const year = await request(server)
      .post('/api/academic-years')
      .set(owner)
      .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
      .expect(201);
    const grade = await request(server)
      .post('/api/classes')
      .set(owner)
      .send({ campusId, name: 'Grade 1' })
      .expect(201);

    const makeTeacher = (n: number) =>
      request(server)
        .post('/api/users')
        .set(owner)
        .send({ name: `Teacher ${n}`, phone: phone(n), password: 'password123', roles: [{ role: 'TEACHER' }] })
        .expect(201);
    const t1 = await makeTeacher(1);
    await makeTeacher(2);

    const section = await request(server)
      .post(`/api/classes/${grade.body.id}/sections`)
      .set(owner)
      .send({ academicYearId: year.body.id, name: 'A', classTeacherId: t1.body.id })
      .expect(201);
    sectionId = section.body.id;
    teacher = await loginAs(phone(1));
    otherTeacher = await loginAs(phone(2));

    // Class options are what the public enquiry form shows.
    const options = await request(server).get(`/api/public/${schoolSlug}/admission-options`).expect(200);
    expect(options.body.campuses[0].classes[0].name).toBe('Grade 1');
  });

  it('takes a public enquiry through to admission', async () => {
    const grade = (await request(server).get('/api/classes').set(owner)).body[0];
    await request(server)
      .post(`/api/public/${schoolSlug}/enquiries`)
      .send({
        campusId,
        classId: grade.id,
        childName: 'Ali Raza',
        gender: 'MALE',
        guardianName: 'Raza Ahmed',
        guardianPhone: phone(5),
      })
      .expect(201);

    const apps = await request(server).get('/api/applications').set(owner).expect(200);
    expect(apps.body).toHaveLength(1);
    expect(apps.body[0].source).toBe('Website');

    await request(server)
      .patch(`/api/applications/${apps.body[0].id}`)
      .set(owner)
      .send({ stage: 'OFFERED', testScore: 82 })
      .expect(200);

    const admitted = await request(server)
      .post(`/api/applications/${apps.body[0].id}/admit`)
      .set(owner)
      .send({ sectionId })
      .expect(201);
    studentA = admitted.body.id;
    expect(admitted.body.admissionNo).toMatch(/^\d{4}-0001$/);

    // Admitting twice is refused.
    await request(server)
      .post(`/api/applications/${apps.body[0].id}/admit`)
      .set(owner)
      .send({ sectionId })
      .expect(400);

    const funnel = await request(server).get('/api/applications/funnel').set(owner).expect(200);
    expect(funnel.body.find((f: { stage: string }) => f.stage === 'ADMITTED').count).toBe(1);
  });

  it('reuses the guardian record for a sibling', async () => {
    const res = await request(server)
      .post('/api/students')
      .set(owner)
      .send({
        sectionId,
        firstName: 'Sara',
        lastName: 'Raza',
        gender: 'FEMALE',
        guardians: [{ name: 'Raza Ahmed', phone: phone(5), relation: 'Father' }],
      })
      .expect(201);
    studentB = res.body.id;

    const [a, b] = await Promise.all([
      request(server).get(`/api/students/${studentA}`).set(owner),
      request(server).get(`/api/students/${studentB}`).set(owner),
    ]);
    expect(a.body.guardians[0].guardianId).toBe(b.body.guardians[0].guardianId);
    expect(b.body.enrollments[0].rollNo).toBe(2);

    const list = await request(server).get(`/api/students?sectionId=${sectionId}`).set(teacher).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('lets the class teacher mark attendance and alerts parents once', async () => {
    const sheet = await request(server)
      .get(`/api/attendance/sheet?sectionId=${sectionId}&date=2026-10-05`)
      .set(teacher)
      .expect(200);
    expect(sheet.body.taken).toBe(false);
    expect(sheet.body.students).toHaveLength(2);

    const records = [
      { studentId: studentA, status: 'ABSENT' },
      { studentId: studentB, status: 'PRESENT' },
    ];
    const first = await request(server)
      .put('/api/attendance/sheet')
      .set(teacher)
      .send({ sectionId, date: '2026-10-05', records })
      .expect(200);
    expect(first.body.alertsSent).toBe(1);
    expect(sent.at(-1)?.template).toBe('attendance.absent');

    // Saving the same register again does not message the parent twice.
    const again = await request(server)
      .put('/api/attendance/sheet')
      .set(teacher)
      .send({ sectionId, date: '2026-10-05', records })
      .expect(200);
    expect(again.body.alertsSent).toBe(0);

    await request(server)
      .get(`/api/attendance/sheet?sectionId=${sectionId}&date=2026-10-05`)
      .set(otherTeacher)
      .expect(403);

    const mine = await request(server).get('/api/attendance/sections').set(teacher).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ id: sectionId, isClassTeacher: true, students: 2 })]);
    expect((await request(server).get('/api/attendance/sections').set(otherTeacher).expect(200)).body).toEqual([]);

    const day = await request(server).get('/api/dashboard/teacher').set(teacher).expect(200);
    expect(day.body.sections).toEqual([expect.objectContaining({ id: sectionId, isClassTeacher: true, students: 2 })]);
    expect((await request(server).get('/api/dashboard/teacher').set(otherTeacher).expect(200)).body.sections).toEqual([]);

    const summary = await request(server)
      .get('/api/attendance/summary?date=2026-10-05')
      .set(owner)
      .expect(200);
    expect(summary.body[0]).toMatchObject({ enrolled: 2, taken: true, present: 1, absent: 1 });
  });

  it('bills the month with concessions, takes payments and ignores replayed webhooks', async () => {
    const year = (await request(server).get('/api/academic-years').set(owner)).body[0];
    const grade = (await request(server).get('/api/classes').set(owner)).body[0];
    const head = await request(server)
      .post('/api/fees/heads')
      .set(owner)
      .send({ name: 'Tuition', frequency: 'MONTHLY' })
      .expect(201);
    await request(server)
      .put('/api/fees/structures')
      .set(owner)
      .send({ classId: grade.id, feeHeadId: head.body.id, academicYearId: year.id, amount: 5000 })
      .expect(200);
    await request(server)
      .put(`/api/fees/students/${studentB}/concessions`)
      .set(owner)
      .send({ feeHeadId: head.body.id, type: 'PERCENT', value: 20, reason: 'Sibling' })
      .expect(200);

    // Teachers cannot see fees.
    await request(server).get('/api/fees/invoices').set(teacher).expect(403);

    const gen = await request(server)
      .post('/api/fees/invoices/generate')
      .set(owner)
      .send({ period: '2026-10', sendWhatsApp: true })
      .expect(201);
    expect(gen.body).toMatchObject({ created: 2, totalBilled: 9000, messages: 2 });

    const rerun = await request(server)
      .post('/api/fees/invoices/generate')
      .set(owner)
      .send({ period: '2026-10' })
      .expect(201);
    expect(rerun.body.created).toBe(0);

    const invoices = await request(server).get('/api/fees/invoices?period=2026-10').set(owner).expect(200);
    const invoiceA = invoices.body.find((i: { studentId: string }) => i.studentId === studentA);
    expect(invoiceA.total).toBe(5000);

    const counter = await request(server)
      .post(`/api/fees/invoices/${invoiceA.id}/payments`)
      .set(owner)
      .send({ amount: 2000, method: 'CASH' })
      .expect(201);
    expect(counter.body.payment.receiptNo).toMatch(/^R-/);

    const payload = JSON.stringify({ voucherNo: invoiceA.voucherNo, amount: 3000, reference: `JC-${run}` });
    const hook = () =>
      request(server)
        .post('/api/payments/webhook/jazzcash')
        .set('Content-Type', 'application/json')
        .set('X-Signature', sign(payload, WEBHOOK_SECRET))
        .send(payload);
    expect((await hook().expect(200)).body.duplicate).toBe(false);
    expect((await hook().expect(200)).body.duplicate).toBe(true);

    await request(server)
      .post('/api/payments/webhook/jazzcash')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'not-a-signature')
      .send(payload)
      .expect(401);

    const paid = await request(server).get(`/api/fees/invoices/${invoiceA.id}`).set(owner).expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', paid: 5000, balance: 0 });
    expect(paid.body.payments).toHaveLength(2);

    const summary = await request(server).get('/api/dashboard/summary').set(owner).expect(200);
    expect(summary.body.students).toBe(2);
    expect(summary.body.feesThisMonth.collectedToday).toBe(5000);
    expect(summary.body.recentPayments).toHaveLength(2);
    expect(summary.body.recentPayments[0].student.id).toBe(studentA);
    expect(summary.body.collectionTrend).toHaveLength(6);
    expect(summary.body.studentsByClass).toEqual([expect.objectContaining({ students: 2 })]);

    // Non-fee staff get aggregates only, never individual payments.
    const teacherSummary = await request(server).get('/api/dashboard/summary').set(teacher).expect(200);
    expect(teacherSummary.body.recentPayments).toEqual([]);
    expect(teacherSummary.body.collectionTrend).toEqual([]);
    expect(teacherSummary.body.overdue).toEqual({ invoices: 0, amount: 0 });
  });

  it('sends announcements once per family and gives parents their own portal', async () => {
    const notice = await request(server)
      .post('/api/announcements')
      .set(owner)
      .send({ title: 'Holiday', body: 'School is closed on Monday.', audience: 'SCHOOL' })
      .expect(201);
    expect(notice.body.messages).toBe(1);

    const student = await request(server).get(`/api/students/${studentA}`).set(owner);
    const guardianId = student.body.guardians[0].guardianId;
    const invite = await request(server)
      .post(`/api/students/${studentA}/guardians/${guardianId}/invite`)
      .set(owner)
      .expect(201);
    expect(invite.body.invited).toBe(true);

    const message = sent.find((m) => m.template === 'parent.invite')!;
    const logs = await request(server).get('/api/notifications').set(owner).expect(200);
    const logged = logs.body.find((l: { template: string }) => l.template === 'parent.invite');
    expect(logged.body).not.toContain(message.params.password);

    const parent = await loginAs(phone(5), message.params.password);
    const children = await request(server).get('/api/parent/children').set(parent).expect(200);
    expect(children.body).toHaveLength(2);
    const sara = children.body.find((c: { name: string }) => c.name === 'Sara Raza');
    expect(sara.unpaidInvoices[0].balance).toBe(4000);

    // Parents cannot reach staff screens.
    await request(server).get('/api/students').set(parent).expect(403);
  });
});
