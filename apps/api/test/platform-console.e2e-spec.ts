import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Platform console: staff roles, schools created from the console, lifecycle,
// a school's people, module overrides, support sessions, audit and reports.
describe('Platform console (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ownerEmail = `owner+${run}@schoolsyncer.test`;
  const supportEmail = `support+${run}@schoolsyncer.test`;
  const staffEmail = `new+${run}@schoolsyncer.test`;
  const schoolEmailSuffix = `+${run}@console.test`;

  let owner: Record<string, string>;
  let support: Record<string, string>;
  let ownerId: string;
  const schoolA = { id: '', slug: '', owner: {} as Record<string, string> };
  const schoolB = { id: '', slug: '', campusId: '' };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const platformLogin = (email: string, password = 'password123') =>
    request(server).post('/api/platform/auth/login').send({ email, password });
  const schoolLogin = (schoolSlug: string, login: string, password: string) =>
    request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash('password123', 4);
    ownerId = (
      await prisma.platformAdmin.create({
        data: { email: ownerEmail, name: 'Sana Owner', role: 'OWNER', passwordHash },
      })
    ).id;
    await prisma.platformAdmin.create({
      data: { email: supportEmail, name: 'Bilal Support', role: 'SUPPORT', passwordHash },
    });
    const o = await platformLogin(ownerEmail).expect(200);
    expect(o.body.admin).toMatchObject({ role: 'OWNER', mustChangePassword: false });
    owner = auth(o.body.accessToken);
    support = auth((await platformLogin(supportEmail).expect(200)).body.accessToken);

    for (const [school, label] of [
      [schoolA, 'A'],
      [schoolB, 'B'],
    ] as const) {
      const reg = await request(server)
        .post('/api/auth/register-school')
        .send({
          schoolName: `Console ${label} ${run}`,
          ownerName: `Owner ${label}`,
          email: `owner${label.toLowerCase()}${schoolEmailSuffix}`,
          password: 'password123',
        })
        .expect(201);
      school.id = reg.body.user.schoolId;
      school.slug = reg.body.schoolSlug;
      if ('owner' in school) school.owner = auth(reg.body.accessToken);
    }
    schoolB.campusId = (
      await prisma.campus.findFirstOrThrow({ where: { schoolId: schoolB.id } })
    ).id;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { email: { endsWith: schoolEmailSuffix } });
    const admins = { email: { in: [ownerEmail, supportEmail, staffEmail] } };
    await prisma.platformAuditLog.deleteMany({ where: { admin: admins } });
    await prisma.platformAdmin.deleteMany({ where: admins });
    await app.close();
  });

  describe('platform staff', () => {
    it('is for owners only', async () => {
      await request(server).get('/api/platform/staff').set(support).expect(403);
      await request(server)
        .post('/api/platform/staff')
        .set(support)
        .send({ name: 'Nope', email: `nope+${run}@schoolsyncer.test` })
        .expect(403);
      await request(server).get('/api/platform/staff').set(schoolA.owner).expect(401);
      const list = await request(server).get('/api/platform/staff').set(owner).expect(200);
      expect(list.body.map((s: { email: string }) => s.email)).toContain(supportEmail);
      expect(list.body[0]).not.toHaveProperty('passwordHash');
    });

    it('creates staff with a one-time password that must be changed', async () => {
      const created = await request(server)
        .post('/api/platform/staff')
        .set(owner)
        .send({ name: 'Hamza Khan', email: staffEmail, role: 'SUPPORT' })
        .expect(201);
      expect(created.body.staff).toMatchObject({ role: 'SUPPORT', mustChangePassword: true });
      const temp = created.body.temporaryPassword as string;
      expect(temp).toHaveLength(12);
      await request(server)
        .post('/api/platform/staff')
        .set(owner)
        .send({ name: 'Hamza Again', email: staffEmail })
        .expect(409);

      const login = await platformLogin(staffEmail, temp).expect(200);
      expect(login.body.admin.mustChangePassword).toBe(true);
      const staff = auth(login.body.accessToken);
      // Nothing but /me and change-password works until the temporary password is replaced.
      await request(server).get('/api/platform/schools').set(staff).expect(403);
      await request(server).get('/api/platform/auth/me').set(staff).expect(200);
      await request(server)
        .post('/api/platform/auth/change-password')
        .set(staff)
        .send({ currentPassword: 'wrong-one', newPassword: 'a-new-password' })
        .expect(400);
      await request(server)
        .post('/api/platform/auth/change-password')
        .set(staff)
        .send({ currentPassword: temp, newPassword: 'a-new-password' })
        .expect(200);
      const me = await request(server).get('/api/platform/auth/me').set(staff).expect(200);
      expect(me.body).toMatchObject({ email: staffEmail, role: 'SUPPORT', mustChangePassword: false });
      await request(server).get('/api/platform/schools').set(staff).expect(200);

      // Deactivation takes effect on the next request, not when the token expires.
      const id = created.body.staff.id;
      await request(server)
        .patch(`/api/platform/staff/${id}`)
        .set(owner)
        .send({ isActive: false })
        .expect(200);
      await request(server).get('/api/platform/overview').set(staff).expect(401);
      await platformLogin(staffEmail, 'a-new-password').expect(401);

      const reset = await request(server)
        .post(`/api/platform/staff/${id}/reset-password`)
        .set(owner)
        .expect(201);
      expect(reset.body.temporaryPassword).toHaveLength(12);
    });

    it('stops owners locking themselves out', async () => {
      const self = await request(server)
        .patch(`/api/platform/staff/${ownerId}`)
        .set(owner)
        .send({ isActive: false })
        .expect(400);
      expect(self.body.message).toMatch(/your own account/);
      await request(server)
        .patch(`/api/platform/staff/${ownerId}`)
        .set(owner)
        .send({ role: 'SUPPORT' })
        .expect(400);
    });
  });

  it('creates a school from the console with a temporary owner password', async () => {
    const res = await request(server)
      .post('/api/platform/schools')
      .set(support)
      .send({
        schoolName: `Console C ${run}`,
        city: 'Multan',
        ownerName: 'Imran Qureshi',
        email: `ownerc${schoolEmailSuffix}`,
        planCode: 'starter',
        status: 'ACTIVE',
      })
      .expect(201);
    expect(res.body.temporaryPassword).toHaveLength(12);
    await request(server)
      .post('/api/platform/schools')
      .set(support)
      .send({
        schoolName: 'Bad plan school',
        ownerName: 'Someone',
        email: `bad${schoolEmailSuffix}`,
        planCode: `no-such-plan-${run}`,
      })
      .expect(400);
    const login = await schoolLogin(
      res.body.schoolSlug,
      `ownerc${schoolEmailSuffix}`,
      res.body.temporaryPassword,
    ).expect(200);
    const me = await request(server)
      .get('/api/auth/me')
      .set(auth(login.body.accessToken))
      .expect(200);
    expect(me.body.plan).toMatchObject({ name: 'Starter', status: 'ACTIVE' });
    expect(me.body.support).toBeNull();
  });

  describe('lifecycle', () => {
    it('needs a reason and records it', async () => {
      await request(server)
        .post(`/api/platform/schools/${schoolB.id}/suspend`)
        .set(support)
        .send({ reason: 'no' })
        .expect(400);
      const res = await request(server)
        .post(`/api/platform/schools/${schoolB.id}/suspend`)
        .set(support)
        .send({ reason: 'Unpaid since March' })
        .expect(200);
      expect(res.body.status).toBe('SUSPENDED');
      await schoolLogin(schoolB.slug, `ownerb${schoolEmailSuffix}`, 'password123').expect(403);
      await request(server)
        .post(`/api/platform/schools/${schoolB.id}/suspend`)
        .set(support)
        .send({ reason: 'Unpaid since March' })
        .expect(409);
      await request(server)
        .post(`/api/platform/schools/${schoolB.id}/reactivate`)
        .set(support)
        .send({ reason: 'Paid in full' })
        .expect(200);
      await schoolLogin(schoolB.slug, `ownerb${schoolEmailSuffix}`, 'password123').expect(200);
      const logged = await prisma.platformAuditLog.findFirstOrThrow({
        where: { schoolId: schoolB.id, action: 'school.suspend' },
      });
      expect(logged.details).toMatchObject({ reason: 'Unpaid since March' });
    });

    it('only lets owners close a school', async () => {
      await request(server)
        .post(`/api/platform/schools/${schoolB.id}/cancel`)
        .set(support)
        .send({ reason: 'Customer left' })
        .expect(403);
      await request(server)
        .patch(`/api/platform/schools/${schoolB.id}/subscription`)
        .set(support)
        .send({ status: 'CANCELLED' })
        .expect(403);
      await request(server)
        .post(`/api/platform/schools/${schoolB.id}/cancel`)
        .set(owner)
        .send({ reason: 'Customer left' })
        .expect(200);
      await request(server)
        .post(`/api/platform/schools/${schoolB.id}/reactivate`)
        .set(owner)
        .send({ reason: 'Customer came back' })
        .expect(200);
    });
  });

  describe("a school's people", () => {
    it('lists, adds and resets staff, logged in both audit trails', async () => {
      const list = await request(server)
        .get(`/api/platform/schools/${schoolA.id}/users`)
        .set(support)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].roles[0]).toMatchObject({ role: 'OWNER' });

      const created = await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users`)
        .set(support)
        .send({
          name: 'Nadia Accountant',
          email: `acct${schoolEmailSuffix}`,
          roles: [{ role: 'ACCOUNTANT' }],
        })
        .expect(201);
      const uid = created.body.user.id;
      await schoolLogin(schoolA.slug, `acct${schoolEmailSuffix}`, created.body.temporaryPassword).expect(200);

      await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users`)
        .set(support)
        .send({ name: 'Parent', email: `p${schoolEmailSuffix}`, roles: [{ role: 'PARENT' }] })
        .expect(400);

      const reset = await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users/${uid}/reset-password`)
        .set(support)
        .expect(201);
      await schoolLogin(schoolA.slug, `acct${schoolEmailSuffix}`, reset.body.temporaryPassword).expect(200);

      const updated = await request(server)
        .patch(`/api/platform/schools/${schoolA.id}/users/${uid}`)
        .set(support)
        .send({ isActive: false, roles: [{ role: 'TEACHER' }] })
        .expect(200);
      expect(updated.body).toMatchObject({ isActive: false, roles: [{ role: 'TEACHER' }] });

      const schoolLog = await prisma.auditLog.findMany({
        where: { schoolId: schoolA.id, entityId: uid },
        orderBy: { createdAt: 'asc' },
      });
      expect(schoolLog.map((l) => l.action)).toEqual([
        'user.create',
        'user.reset_password',
        'user.update',
      ]);
      expect(schoolLog[0].after).toMatchObject({ by: 'Bilal Support' });
      expect(
        await prisma.platformAuditLog.count({
          where: { schoolId: schoolA.id, action: { startsWith: 'school.user.' } },
        }),
      ).toBe(3);
    });

    it('leaves owner accounts to SchoolSyncer owners', async () => {
      const ownerRow = await prisma.user.findFirstOrThrow({
        where: { schoolId: schoolA.id, roles: { some: { role: 'OWNER' } } },
      });
      await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users/${ownerRow.id}/reset-password`)
        .set(support)
        .expect(403);
      await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users`)
        .set(support)
        .send({ name: 'Second Owner', email: `owner2${schoolEmailSuffix}`, roles: [{ role: 'OWNER' }] })
        .expect(403);
      const reset = await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users/${ownerRow.id}/reset-password`)
        .set(owner)
        .send({ reason: 'Owner lost their phone' })
        .expect(201);
      expect(reset.body.temporaryPassword).toHaveLength(12);
      expect(
        (
          await prisma.platformAuditLog.findFirstOrThrow({
            where: { schoolId: schoolA.id, action: 'school.user.reset_password' },
            orderBy: { createdAt: 'desc' },
          })
        ).details,
      ).toMatchObject({ userId: ownerRow.id, reason: 'Owner lost their phone' });
      // Put the owner's password back for later tests.
      await prisma.user.update({
        where: { id: ownerRow.id },
        data: { passwordHash: await bcrypt.hash('password123', 4) },
      });
    });

    it('keeps parent grants when changing staff roles', async () => {
      const created = await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users`)
        .set(support)
        .send({ name: 'Teacher Parent', email: `tp${schoolEmailSuffix}`, roles: [{ role: 'TEACHER' }] })
        .expect(201);
      const uid = created.body.user.id;
      await prisma.roleAssignment.create({ data: { userId: uid, role: 'PARENT' } });
      const token = auth(
        (await schoolLogin(schoolA.slug, `tp${schoolEmailSuffix}`, created.body.temporaryPassword).expect(200)).body
          .accessToken,
      );
      await request(server)
        .patch(`/api/platform/schools/${schoolA.id}/users/${uid}`)
        .set(support)
        .send({ roles: [{ role: 'ACCOUNTANT' }] })
        .expect(200);
      const roles = await prisma.roleAssignment.findMany({ where: { userId: uid } });
      expect(roles.map((r) => r.role).sort()).toEqual(['ACCOUNTANT', 'PARENT']);
      // Deactivating from the console cuts the live token off at once.
      await request(server).get('/api/auth/me').set(token).expect(200);
      await request(server)
        .patch(`/api/platform/schools/${schoolA.id}/users/${uid}`)
        .set(support)
        .send({ isActive: false })
        .expect(200);
      await request(server).get('/api/auth/me').set(token).expect(401);
    });

    it('keeps one active owner', async () => {
      const ownerRow = await prisma.user.findFirstOrThrow({
        where: { schoolId: schoolA.id, roles: { some: { role: 'OWNER' } } },
      });
      const res = await request(server)
        .patch(`/api/platform/schools/${schoolA.id}/users/${ownerRow.id}`)
        .set(owner)
        .send({ isActive: false })
        .expect(409);
      expect(res.body.message).toMatch(/at least one active owner/);
      const still = await prisma.user.findUniqueOrThrow({ where: { id: ownerRow.id } });
      expect(still.isActive).toBe(true);
    });

    it("never touches another school's people or campuses", async () => {
      const bOwner = await prisma.user.findFirstOrThrow({ where: { schoolId: schoolB.id } });
      await request(server)
        .patch(`/api/platform/schools/${schoolA.id}/users/${bOwner.id}`)
        .set(support)
        .send({ isActive: false })
        .expect(404);
      await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users/${bOwner.id}/reset-password`)
        .set(support)
        .expect(404);
      await request(server)
        .post(`/api/platform/schools/${schoolA.id}/users`)
        .set(support)
        .send({
          name: 'Cross Campus',
          email: `cross${schoolEmailSuffix}`,
          roles: [{ role: 'TEACHER', campusId: schoolB.campusId }],
        })
        .expect(404);
      await request(server).get(`/api/platform/schools/${schoolA.id}/users`).set(schoolA.owner).expect(401);
    });
  });

  it('switches modules per school, for owners only', async () => {
    await request(server)
      .put(`/api/platform/schools/${schoolA.id}/features`)
      .set(support)
      .send({ added: [], removed: ['timetable'] })
      .expect(403);
    await request(server)
      .put(`/api/platform/schools/${schoolA.id}/features`)
      .set(owner)
      .send({ added: ['fees'], removed: ['fees'] })
      .expect(400);
    const res = await request(server)
      .put(`/api/platform/schools/${schoolA.id}/features`)
      .set(owner)
      .send({ added: [], removed: ['timetable'] })
      .expect(200);
    expect(res.body.featuresRemoved).toEqual(['timetable']);
    expect(res.body.features).not.toContain('timetable');
    await request(server).get('/api/timetable/periods').set(schoolA.owner).expect(403);
    const me = await request(server).get('/api/auth/me').set(schoolA.owner).expect(200);
    expect(me.body.plan.features).not.toContain('timetable');
    expect(me.body.plan.features).toContain('fees');
    const detail = await request(server)
      .get(`/api/platform/schools/${schoolA.id}`)
      .set(support)
      .expect(200);
    expect(detail.body.subscription.featuresRemoved).toEqual(['timetable']);
    // School B is untouched.
    const other = await prisma.subscription.findUniqueOrThrow({ where: { schoolId: schoolB.id } });
    expect(other.featuresRemoved).toEqual([]);

    await request(server)
      .put(`/api/platform/schools/${schoolA.id}/features`)
      .set(owner)
      .send({ added: [], removed: [] })
      .expect(200);
    const campus = await prisma.campus.findFirstOrThrow({ where: { schoolId: schoolA.id } });
    await request(server)
      .get(`/api/timetable/periods?campusId=${campus.id}`)
      .set(schoolA.owner)
      .expect(200);
  });

  it('opens support sessions with a reason and marks the token', async () => {
    await request(server)
      .post(`/api/platform/schools/${schoolA.id}/support-login`)
      .set(support)
      .send({})
      .expect(400);
    const res = await request(server)
      .post(`/api/platform/schools/${schoolA.id}/support-login`)
      .set(support)
      .send({ reason: 'Fee voucher layout question' })
      .expect(201);
    expect(res.body.schoolSlug).toBe(schoolA.slug);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const me = await request(server)
      .get('/api/auth/me')
      .set(auth(res.body.accessToken))
      .expect(200);
    expect(me.body).toMatchObject({
      name: 'Owner A',
      support: { adminName: 'Bilal Support' },
    });
    const schoolLog = await prisma.auditLog.findFirstOrThrow({
      where: { schoolId: schoolA.id, action: 'platform.support_login' },
    });
    expect(schoolLog.after).toMatchObject({ reason: 'Fee voucher layout question' });
    // Changes made in the session name the staff member behind them.
    await request(server)
      .patch('/api/school')
      .set(auth(res.body.accessToken))
      .send({ city: 'Lahore' })
      .expect(200);
    const audit = await request(server)
      .get('/api/audit')
      .query({ action: 'school.update' })
      .set(auth(res.body.accessToken))
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      support: { adminName: 'Bilal Support' },
      actor: { kind: 'user', name: 'Owner A (via SchoolSyncer support: Bilal Support)' },
    });
    // A support token is a school token: it never reaches the console.
    await request(server).get('/api/platform/overview').set(auth(res.body.accessToken)).expect(401);
  });

  it('pages and filters the console audit trail', async () => {
    const res = await request(server)
      .get(`/api/platform/audit?schoolId=${schoolB.id}&action=school.`)
      .set(support)
      .expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 50 });
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.items.every((i: { action: string }) => i.action.startsWith('school.'))).toBe(true);
    expect(res.body.items[0].school).toMatchObject({ id: schoolB.id });
    expect(res.body.items[0].admin).toHaveProperty('name');
    expect(res.body.actions).toContain('school.suspend');
    const page2 = await request(server).get('/api/platform/audit?page=2&adminId=nobody').set(support).expect(200);
    expect(page2.body).toMatchObject({ items: [], total: 0, page: 2 });
  });

  it('reports revenue, growth and churn risk', async () => {
    const res = await request(server).get('/api/platform/reports').set(support).expect(200);
    expect(res.body.revenueByMonth).toHaveLength(12);
    expect(res.body.newSchoolsByMonth).toHaveLength(12);
    expect(res.body.newSchoolsByMonth[11].count).toBeGreaterThanOrEqual(3);
    expect(res.body.schoolsByStatus).toHaveProperty('ACTIVE');
    expect(res.body.schoolsByPlan.length).toBeGreaterThan(0);
    expect(res.body.trialConversion).toHaveProperty('rate');
    expect(typeof res.body.mrr).toBe('number');
    expect(Array.isArray(res.body.churnRisk)).toBe(true);
    await request(server).get('/api/platform/reports').set(schoolA.owner).expect(401);
  });

  describe('login rate limit', () => {
    it('refuses console sign-in after 10 failures, even with the right password', async () => {
      for (let i = 0; i < 10; i++) await platformLogin(supportEmail, 'wrong').expect(401);
      const res = await platformLogin(supportEmail).expect(429);
      expect(res.body.message).toMatch(/Too many failed sign-in attempts/);
      // Other accounts are unaffected.
      await platformLogin(ownerEmail).expect(200);
    });

    it('refuses school sign-in after 10 failures', async () => {
      const login = `ownerb${schoolEmailSuffix}`;
      for (let i = 0; i < 10; i++) await schoolLogin(schoolB.slug, login, 'wrong').expect(401);
      await schoolLogin(schoolB.slug, login, 'password123').expect(429);
      await schoolLogin(schoolA.slug, `ownera${schoolEmailSuffix}`, 'password123').expect(200);
    });
  });
});
