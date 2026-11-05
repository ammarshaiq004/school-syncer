import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// Editable message templates, the WhatsApp inbox and report, and parent login statistics.
describe('Messaging extras (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  const phone = (n: number) => `035${run.slice(-7)}${n}`;
  const appSecret = `app-secret-${run}`;
  const phoneNumberId = `55${run}`;

  let owner: Record<string, string>;
  let schoolId: string;
  let schoolSlug: string;
  const studentIds: string[] = [];

  const signed = (body: object) => {
    const raw = JSON.stringify(body);
    return { raw, sig: `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}` };
  };
  const inbound = (from: string, id: string, text: string) => ({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: 'Imran' } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }],
  });
  const post = (body: object, sig?: string) => {
    const s = signed(body);
    return request(server).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig ?? s.sig).send(s.raw);
  };

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = appSecret;
    process.env.WHATSAPP_VERIFY_TOKEN = `verify-${run}`;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Messaging ${run}`, ownerName: 'Owner', email: `msgx+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 4' }).expect(201)).body.id;
    const sectionId = (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
    for (const [i, firstName] of ['Ahmed', 'Sana', 'Bilal'].entries()) {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId, firstName, gender: 'MALE', guardians: [{ name: `Parent ${firstName}`, phone: phone(i), relation: 'Father' }] })
        .expect(201);
      studentIds.push(res.body.id);
    }
    // The school's own WhatsApp number, so inbound messages to it belong to this school.
    await prisma.schoolMessagingSender.create({ data: { schoolId, enabled: true, phoneNumberId } });
  });

  afterAll(async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  describe('message templates', () => {
    const absent = { to: '', template: 'attendance.absent' as const, params: { studentName: 'Ahmed', date: '5 Nov', schoolName: 'Bright' } };

    it('lists the editable messages with the built-in wording', async () => {
      const res = await request(server).get('/api/school/message-templates').set(owner).expect(200);
      expect(res.body.map((t: { key: string }) => t.key)).toContain('attendance.absent');
      expect(res.body.find((t: { key: string }) => t.key === 'attendance.absent')).toMatchObject({
        body: '',
        enabled: true,
        default: 'Dear parent, {studentName} was marked absent on {date}. - {schoolName}',
      });
      expect(res.body.some((t: { key: string }) => t.key === 'parent.invite')).toBe(false);
    });

    it('uses the school’s wording in the messages it sends', async () => {
      const saved = await request(server)
        .put('/api/school/message-templates/attendance.absent')
        .set(owner)
        .send({ body: '{studentName} was absent on {date}. Please call the office.' })
        .expect(200);
      expect(saved.body.preview).toBe('Ahmed Khan was absent on 5 Nov 2026. Please call the office.');
      await notifications.send(schoolId, [{ ...absent, to: phone(0) }]);
      const log = await prisma.notificationLog.findFirstOrThrow({ where: { schoolId, template: 'attendance.absent' } });
      expect(log.body).toBe('Ahmed was absent on 5 Nov. Please call the office.');
    });

    it('refuses unknown placeholders and messages that cannot be edited', async () => {
      const bad = await request(server).put('/api/school/message-templates/fees.paid').set(owner).send({ body: 'Rs {password}' }).expect(400);
      expect(bad.body.message).toMatch(/\{password\}/);
      await request(server).put('/api/school/message-templates/parent.invite').set(owner).send({ body: 'x' }).expect(404);
    });

    it('stops sending a message that is switched off, and resets to the built-in text', async () => {
      await request(server).put('/api/school/message-templates/attendance.absent').set(owner).send({ enabled: false }).expect(200);
      expect(await notifications.send(schoolId, [{ ...absent, to: phone(1) }])).toBe(0);
      const reset = await request(server).delete('/api/school/message-templates/attendance.absent').set(owner).expect(200);
      expect(reset.body).toMatchObject({ body: '', enabled: true });
      expect(await notifications.send(schoolId, [{ ...absent, to: phone(1) }])).toBe(1);
    });
  });

  describe('WhatsApp inbox', () => {
    it('answers Meta’s verification only with the right token', async () => {
      await request(server).get(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=77`).expect(403);
      const ok = await request(server).get(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-${run}&hub.challenge=77`).expect(200);
      expect(ok.text).toBe('77');
    });

    it('rejects an unsigned or wrongly signed delivery', async () => {
      await post(inbound('923351234567', 'wamid.bad', 'hi'), 'sha256=00').expect(401);
    });

    it('stores a parent’s message once, even if Meta sends it again', async () => {
      const from = `92${phone(0).slice(1)}`;
      await post(inbound(from, `wamid.${run}.1`, 'Ahmed has a fever')).expect(200);
      await post(inbound(from, `wamid.${run}.1`, 'Ahmed has a fever')).expect(200);
      const threads = await request(server).get('/api/whatsapp/threads').set(owner).expect(200);
      expect(threads.body).toHaveLength(1);
      expect(threads.body[0]).toMatchObject({
        phone: from,
        name: 'Imran',
        unread: 1,
        lastBody: 'Ahmed has a fever',
        guardian: { name: 'Parent Ahmed', students: ['Ahmed'] },
      });
    });

    it('opening a thread marks it read and says whether a free reply is allowed', async () => {
      const from = `92${phone(0).slice(1)}`;
      const thread = await request(server).get(`/api/whatsapp/threads/${from}`).set(owner).expect(200);
      expect(thread.body).toMatchObject({ canReply: true, messages: [{ direction: 'IN', body: 'Ahmed has a fever' }] });
      const after = await request(server).get('/api/whatsapp/threads').set(owner).expect(200);
      expect(after.body[0].unread).toBe(0);
    });

    it('cannot reply without a WhatsApp sender, or to a number that never wrote', async () => {
      const from = `92${phone(0).slice(1)}`;
      const res = await request(server).post(`/api/whatsapp/threads/${from}/reply`).set(owner).send({ text: 'Get well soon' }).expect(400);
      expect(res.body.message).toMatch(/not set up/);
      await request(server).post('/api/whatsapp/threads/923000000000/reply').set(owner).send({ text: 'Hello' }).expect(400);
    });

    it('ignores messages to a number it does not know', async () => {
      const body = inbound('923351234567', `wamid.${run}.x`, 'hello?');
      body.entry[0].changes[0].value.metadata.phone_number_id = 'unknown';
      await post(body).expect(200);
      expect(await prisma.whatsappMessage.count({ where: { providerMessageId: `wamid.${run}.x` } })).toBe(0);
    });

    it('records delivery receipts and reports on the message log', async () => {
      const log = await prisma.notificationLog.findFirstOrThrow({ where: { schoolId, template: 'attendance.absent' } });
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: 'SENT', providerMessageId: `wamid.out.${run}` } });
      const receipt = { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: `wamid.out.${run}`, status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] };
      await post(receipt).expect(200);
      const report = await request(server).get('/api/whatsapp/report').set(owner).expect(200);
      expect(report.body.totals).toMatchObject({ total: 2, sent: 1, delivered: 1, read: 1 });
      expect(report.body.byTemplate[0]).toMatchObject({ template: 'attendance.absent', total: 2 });
      expect(report.body.inbox).toEqual({ received: 1, replied: 0 });
      expect(report.body.byDay.at(-1).date).toBe(today);
    });
  });

  describe('parent login statistics', () => {
    it('counts families without a login, signed in and quiet', async () => {
      const guardian = await prisma.guardian.findFirstOrThrow({ where: { schoolId, phone: phone(1) } });
      await request(server).post(`/api/students/${studentIds[1]}/guardians/${guardian.id}/invite`).set(owner).expect(201);
      const before = await request(server).get('/api/school/parent-logins').set(owner).expect(200);
      expect(before.body.totals).toMatchObject({ families: 3, noAccount: 2, never: 1, active: 0 });

      await prisma.user.update({ where: { schoolId_phone: { schoolId, phone: phone(1) } }, data: { passwordHash: await bcrypt.hash('password123', 4) } });
      const login = await request(server).post('/api/auth/login').send({ schoolSlug, login: phone(1), password: 'password123' }).expect(200);
      await keepIssuedPassword(app, login.body);

      const stats = await request(server).get('/api/school/parent-logins').set(owner).expect(200);
      expect(stats.body.totals).toMatchObject({ families: 3, noAccount: 2, never: 0, active: 1, active7: 1 });
      expect(stats.body.byClass).toEqual([{ className: 'Grade 4', families: 3, withLogin: 1, active: 1 }]);
      expect(stats.body.families.at(-1)).toMatchObject({ name: 'Parent Sana', status: 'ACTIVE', students: [{ name: 'Sana', className: 'Grade 4' }] });
      expect(stats.body.daily).toHaveLength(30);
    });
  });
});
