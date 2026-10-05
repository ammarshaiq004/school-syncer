import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Staff and users: directory filters, edits, activation, password resets,
// owner rules, the school audit log and the fee settings on /school.
describe('Staff and users (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `036${run.slice(-7)}${n}`;

  let slugA: string;
  let slugB: string;
  let ownerAId: string;
  let ownerA: Record<string, string>;
  let ownerB: Record<string, string>;
  let admin: Record<string, string>;
  let teacherId: string;
  let teacher: Record<string, string>;
  let customRoleId: string;
  let foreignRoleId: string;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(name: string, email: string) {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' })
      .expect(201);
    return { slug: reg.body.schoolSlug as string, userId: reg.body.user.sub as string, auth: bearer(reg.body.accessToken) };
  }

  const login = (schoolSlug: string, loginId: string, password = 'password123') =>
    request(server).post('/api/auth/login').send({ schoolSlug, login: loginId, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const a = await register(`Staff A ${run}`, `staff-a+${run}@test.pk`);
    const b = await register(`Staff B ${run}`, `staff-b+${run}@test.pk`);
    slugA = a.slug;
    slugB = b.slug;
    ownerAId = a.userId;
    ownerA = a.auth;
    ownerB = b.auth;

    await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Imran Qureshi', phone: phone(1), password: 'password123', roles: [{ role: 'ADMIN' }] })
      .expect(201);
    admin = bearer((await login(slugA, phone(1)).expect(200)).body.accessToken);

    const t = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Ayesha Siddiqui', phone: phone(2), password: 'password123', roles: [{ role: 'TEACHER' }] })
      .expect(201);
    teacherId = t.body.id;
    teacher = bearer((await login(slugA, phone(2)).expect(200)).body.accessToken);

    customRoleId = (
      await request(server)
        .post('/api/roles')
        .set(ownerA)
        .send({ name: 'Exam coordinator', baseRole: 'TEACHER', permissions: { exams: 'manage', students: 'view' } })
        .expect(201)
    ).body.id;
    foreignRoleId = (
      await request(server)
        .post('/api/roles')
        .set(ownerB)
        .send({ name: 'Exam coordinator', baseRole: 'TEACHER' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: slugA });
    await deleteSchools(prisma, { slug: slugB });
    await app.close();
  });

  it('invites staff with a one-time temporary password', async () => {
    const res = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Bilal Ahmed', email: `bilal+${run}@test.pk`, roles: [{ customRoleId }] })
      .expect(201);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(res.body.roles).toEqual([
      expect.objectContaining({ role: 'TEACHER', customRoleId, customRole: { id: customRoleId, name: 'Exam coordinator' } }),
    ]);
    expect(res.body).not.toHaveProperty('passwordHash');
    await login(slugA, `bilal+${run}@test.pk`, res.body.temporaryPassword).expect(200);

    // A password given by the caller is not echoed back.
    const withPassword = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Sana Malik', phone: phone(3), password: 'password123', roles: [{ role: 'ACCOUNTANT' }] })
      .expect(201);
    expect(withPassword.body.temporaryPassword).toBeUndefined();
  });

  it('filters the staff directory', async () => {
    const all = await request(server).get('/api/users').set(ownerA).expect(200);
    expect(all.body.length).toBeGreaterThanOrEqual(5);
    expect(all.body[0]).toHaveProperty('lastLoginAt');
    expect(all.body[0]).toHaveProperty('staffProfile');

    const search = await request(server).get('/api/users').query({ search: 'ayesha' }).set(ownerA).expect(200);
    expect(search.body.map((u: { name: string }) => u.name)).toEqual(['Ayesha Siddiqui']);

    const teachers = await request(server).get('/api/users').query({ role: 'TEACHER' }).set(ownerA).expect(200);
    expect(teachers.body.map((u: { name: string }) => u.name).sort()).toEqual(['Ayesha Siddiqui', 'Bilal Ahmed']);

    const coordinators = await request(server).get('/api/users').query({ customRoleId }).set(ownerA).expect(200);
    expect(coordinators.body.map((u: { name: string }) => u.name)).toEqual(['Bilal Ahmed']);

    const inactive = await request(server).get('/api/users').query({ status: 'inactive', type: 'staff' }).set(ownerA).expect(200);
    expect(inactive.body).toEqual([]);

    await request(server).get('/api/users').query({ status: 'gone' }).set(ownerA).expect(400);
    await request(server).get('/api/users').set(teacher).expect(403);

    const one = await request(server).get(`/api/users/${teacherId}`).set(ownerA).expect(200);
    expect(one.body).toMatchObject({ name: 'Ayesha Siddiqui', load: { timetablePeriods: 0 } });
  });

  it('edits details and roles, including custom roles', async () => {
    const res = await request(server)
      .patch(`/api/users/${teacherId}`)
      .set(admin)
      .send({ name: 'Ayesha Siddiqui Khan', email: `ayesha+${run}@test.pk`, roles: [{ role: 'TEACHER' }, { customRoleId }] })
      .expect(200);
    expect(res.body.name).toBe('Ayesha Siddiqui Khan');
    expect(res.body.roles).toHaveLength(2);
    expect(res.body.roles).toContainEqual(expect.objectContaining({ role: 'TEACHER', customRoleId }));

    // role, when given with a custom role, must be its base role.
    await request(server)
      .patch(`/api/users/${teacherId}`)
      .set(ownerA)
      .send({ roles: [{ role: 'ACCOUNTANT', customRoleId }] })
      .expect(400);
    await request(server)
      .patch(`/api/users/${teacherId}`)
      .set(ownerA)
      .send({ roles: [{ role: 'TEACHER' }, { role: 'TEACHER' }] })
      .expect(400);
    // Another school's custom role does not exist here.
    await request(server)
      .patch(`/api/users/${teacherId}`)
      .set(ownerA)
      .send({ roles: [{ customRoleId: foreignRoleId }] })
      .expect(404);
    // Removing both email and phone is refused; a taken phone is a conflict.
    await request(server).patch(`/api/users/${teacherId}`).set(ownerA).send({ email: null, phone: null }).expect(400);
    await request(server).patch(`/api/users/${teacherId}`).set(ownerA).send({ phone: phone(1) }).expect(409);
    await request(server).patch(`/api/users/${teacherId}`).set(ownerA).send({}).expect(400);
    await request(server).patch(`/api/users/${teacherId}`).set(teacher).send({ name: 'Me' }).expect(403);

    const stored = await prisma.roleAssignment.findMany({ where: { userId: teacherId } });
    expect(stored).toHaveLength(2);
    expect(stored).toContainEqual(expect.objectContaining({ role: 'TEACHER', customRoleId }));
    expect(stored).toContainEqual(expect.objectContaining({ role: 'TEACHER', customRoleId: null }));
  });

  it('keeps owner accounts in owner hands', async () => {
    await request(server)
      .patch(`/api/users/${teacherId}`)
      .set(admin)
      .send({ roles: [{ role: 'OWNER' }] })
      .expect(403);
    await request(server)
      .post('/api/users')
      .set(admin)
      .send({ name: 'New Owner', phone: phone(4), roles: [{ role: 'OWNER' }] })
      .expect(403);
    await request(server).patch(`/api/users/${ownerAId}`).set(admin).send({ name: 'Renamed' }).expect(403);
    await request(server).post(`/api/users/${ownerAId}/deactivate`).set(admin).expect(403);
    await request(server).post(`/api/users/${ownerAId}/reset-password`).set(admin).expect(403);

    // Last active owner: cannot deactivate yourself or drop your owner role.
    await request(server).post(`/api/users/${ownerAId}/deactivate`).set(ownerA).expect(400);
    const res = await request(server)
      .patch(`/api/users/${ownerAId}`)
      .set(ownerA)
      .send({ roles: [{ role: 'PRINCIPAL' }] })
      .expect(409);
    expect(res.body.message).toBe('The school needs at least one active owner');
    const roles = await prisma.roleAssignment.findMany({ where: { userId: ownerAId } });
    expect(roles.map((r) => r.role)).toEqual(['OWNER']);

    // With a second (inactive) owner the rule still holds.
    const second = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Second Owner', phone: phone(5), roles: [{ role: 'OWNER' }] })
      .expect(201);
    await request(server).post(`/api/users/${second.body.id}/deactivate`).set(ownerA).expect(200);
    await request(server).patch(`/api/users/${ownerAId}`).set(ownerA).send({ roles: [{ role: 'PRINCIPAL' }] }).expect(409);
  });

  it('deactivates and reactivates, cutting off live tokens', async () => {
    await request(server).get('/api/auth/me').set(teacher).expect(200);
    const off = await request(server).post(`/api/users/${teacherId}/deactivate`).set(admin).expect(200);
    expect(off.body.isActive).toBe(false);
    await request(server).get('/api/auth/me').set(teacher).expect(401);
    await login(slugA, phone(2)).expect(401);

    const inactive = await request(server).get('/api/users').query({ status: 'inactive', type: 'staff' }).set(ownerA).expect(200);
    expect(inactive.body.map((u: { id: string }) => u.id)).toContain(teacherId);

    const on = await request(server).post(`/api/users/${teacherId}/activate`).set(admin).expect(200);
    expect(on.body.isActive).toBe(true);
    await request(server).get('/api/auth/me').set(teacher).expect(200);
    await login(slugA, phone(2)).expect(200);
  });

  it('resets a password and shows the new one once', async () => {
    const res = await request(server).post(`/api/users/${teacherId}/reset-password`).set(admin).expect(200);
    expect(Object.keys(res.body)).toEqual(['temporaryPassword']);
    await login(slugA, phone(2)).expect(401);
    await login(slugA, phone(2), res.body.temporaryPassword).expect(200);
    await request(server).post(`/api/users/${teacherId}/reset-password`).set(teacher).expect(403);
  });

  it('keeps schools apart', async () => {
    await request(server).get(`/api/users/${teacherId}`).set(ownerB).expect(404);
    await request(server).patch(`/api/users/${teacherId}`).set(ownerB).send({ name: 'Taken' }).expect(404);
    await request(server).post(`/api/users/${teacherId}/deactivate`).set(ownerB).expect(404);
    await request(server).post(`/api/users/${teacherId}/reset-password`).set(ownerB).expect(404);
    const list = await request(server).get('/api/users').set(ownerB).expect(200);
    expect(list.body.map((u: { id: string }) => u.id)).not.toContain(teacherId);

    const audit = await request(server).get('/api/audit').query({ entity: 'User' }).set(ownerB).expect(200);
    expect(audit.body.items.every((e: { entityId: string }) => e.entityId !== teacherId)).toBe(true);
    await request(server).get('/api/audit').query({ userId: ownerAId }).set(ownerB).expect(200).expect((r) => {
      expect(r.body.total).toBe(0);
    });
  });

  it('lists the audit log with filters and names', async () => {
    const res = await request(server)
      .get('/api/audit')
      .query({ entity: 'User', pageSize: 3 })
      .set(ownerA)
      .expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 3 });
    expect(res.body.total).toBeGreaterThan(3);
    expect(res.body.items).toHaveLength(3);
    // Newest first: the last thing done to a user was the password reset by the admin.
    expect(res.body.items[0]).toMatchObject({
      action: 'user.reset_password',
      entityId: teacherId,
      actor: { kind: 'user', name: 'Imran Qureshi' },
    });
    expect(res.body.items[0]).not.toHaveProperty('schoolId');

    const page2 = await request(server).get('/api/audit').query({ entity: 'User', pageSize: 3, page: 2 }).set(ownerA).expect(200);
    expect(page2.body.items[0].id).not.toBe(res.body.items[0].id);

    const updates = await request(server).get('/api/audit').query({ action: 'user.update' }).set(ownerA).expect(200);
    const edit = updates.body.items.find((e: { entityId: string }) => e.entityId === teacherId);
    expect(edit.before.name).toBe('Ayesha Siddiqui');
    expect(edit.after.name).toBe('Ayesha Siddiqui Khan');

    const byOwner = await request(server).get('/api/audit').query({ userId: ownerAId, action: 'role' }).set(ownerA).expect(200);
    expect(byOwner.body.items.map((e: { action: string }) => e.action)).toEqual(['role.create']);

    const today = new Date().toISOString().slice(0, 10);
    const future = await request(server).get('/api/audit').query({ from: '2099-01-01' }).set(ownerA).expect(200);
    expect(future.body.total).toBe(0);
    await request(server).get('/api/audit').query({ from: today, to: '2000-01-01' }).set(ownerA).expect(400);

    const facets = await request(server).get('/api/audit/facets').set(ownerA).expect(200);
    expect(facets.body.entities).toContain('User');
    expect(facets.body.actions).toContain('user.deactivate');

    await request(server).get('/api/audit').set(teacher).expect(403);
  });

  it('stores fee settings on the school', async () => {
    const before = await request(server).get('/api/school').set(ownerA).expect(200);
    expect(before.body).toMatchObject({ lateFeePerDay: 0, feeDueDay: 10 });
    const res = await request(server)
      .patch('/api/school')
      .set(ownerA)
      .send({ lateFeePerDay: 50, feeDueDay: 5 })
      .expect(200);
    expect(res.body).toMatchObject({ lateFeePerDay: 50, feeDueDay: 5 });
    const after = await request(server).get('/api/school').set(admin).expect(200);
    expect(after.body).toMatchObject({ lateFeePerDay: 50, feeDueDay: 5 });

    await request(server).patch('/api/school').set(ownerA).send({ feeDueDay: 32 }).expect(400);
    await request(server).patch('/api/school').set(ownerA).send({ lateFeePerDay: -1 }).expect(400);
    await request(server).patch('/api/school').set(teacher).send({ feeDueDay: 3 }).expect(403);
    const other = await request(server).get('/api/school').set(ownerB).expect(200);
    expect(other.body).toMatchObject({ lateFeePerDay: 0, feeDueDay: 10 });
  });
  it('keeps non-owners to people with no more access than they have', async () => {
    // An office manager: administrator without the school's accounts.
    const officeRole = (
      await request(server)
        .post('/api/roles')
        .set(ownerA)
        .send({ name: 'Office manager', baseRole: 'ADMIN', permissions: { accounts: 'none' } })
        .expect(201)
    ).body.id;
    await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Office Manager', phone: phone(6), password: 'password123', roles: [{ customRoleId: officeRole }] })
      .expect(201);
    const office = bearer((await login(slugA, phone(6)).expect(200)).body.accessToken);
    const accountant = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Kamran Accountant', phone: phone(7), password: 'password123', roles: [{ role: 'ACCOUNTANT' }] })
      .expect(201);

    // An accountant manages the accounts, so the office manager cannot take over their login.
    const refused = await request(server).post(`/api/users/${accountant.body.id}/reset-password`).set(office).expect(403);
    expect(refused.body.message).toMatch(/^You cannot change someone with more access than you have: /);
    await request(server).patch(`/api/users/${accountant.body.id}`).set(office).send({ phone: phone(8) }).expect(403);
    await request(server).post(`/api/users/${accountant.body.id}/deactivate`).set(office).expect(403);
    // A teacher has less access: allowed.
    await request(server).post(`/api/users/${teacherId}/reset-password`).set(office).expect(200);
    // The administrator (full access) may reset the accountant.
    await request(server).post(`/api/users/${accountant.body.id}/reset-password`).set(admin).expect(200);
  });

  it('applies role changes to live tokens', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'Demoted Admin', phone: phone(9), password: 'password123', roles: [{ role: 'ADMIN' }] })
      .expect(201);
    const demoted = bearer((await login(slugA, phone(9)).expect(200)).body.accessToken);
    await request(server).get('/api/users').set(demoted).expect(200);
    await request(server).patch(`/api/users/${created.body.id}`).set(ownerA).send({ roles: [{ role: 'TEACHER' }] }).expect(200);
    await request(server).get('/api/users').set(demoted).expect(403);
    const me = await request(server).get('/api/auth/me').set(demoted).expect(200);
    expect(me.body.roles).toEqual([expect.objectContaining({ role: 'TEACHER' })]);
  });

  it('keeps campus principals to their own campuses', async () => {
    const north = (await request(server).post('/api/campuses').set(ownerA).send({ name: `North ${run}` }).expect(201)).body.id;
    const south = (await request(server).post('/api/campuses').set(ownerA).send({ name: `South ${run}` }).expect(201)).body.id;
    const northPhone = `037${run.slice(-7)}1`;
    await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'North Principal', phone: northPhone, password: 'password123', roles: [{ role: 'PRINCIPAL', campusId: north }] })
      .expect(201);
    const southTeacher = await request(server)
      .post('/api/users')
      .set(ownerA)
      .send({ name: 'South Teacher', phone: `037${run.slice(-7)}2`, roles: [{ role: 'TEACHER', campusId: south }] })
      .expect(201);
    const principal = bearer((await login(slugA, northPhone).expect(200)).body.accessToken);

    const list = await request(server).get('/api/users').set(principal).expect(200);
    const ids = list.body.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(southTeacher.body.id);
    expect(ids).not.toContain(teacherId); // school-wide teacher
    await request(server).get(`/api/users/${southTeacher.body.id}`).set(principal).expect(404);
    await request(server).post(`/api/users/${southTeacher.body.id}/reset-password`).set(principal).expect(404);

    const grant = (roles: object[]) =>
      request(server)
        .post('/api/users')
        .set(principal)
        .send({ name: 'Campus Hire', phone: `037${run.slice(-7)}3`, roles });
    await grant([{ role: 'TEACHER' }]).expect(403);
    await grant([{ role: 'TEACHER', campusId: south }]).expect(403);
    const hired = await grant([{ role: 'TEACHER', campusId: north }]).expect(201);
    await request(server).post(`/api/users/${hired.body.id}/reset-password`).set(principal).expect(200);
    await request(server)
      .patch(`/api/users/${hired.body.id}`)
      .set(principal)
      .send({ roles: [{ role: 'TEACHER', campusId: north }, { role: 'TEACHER', campusId: south }] })
      .expect(403);
  });

  it('rejects impossible audit dates and clears school contact fields', async () => {
    await request(server).get('/api/audit').query({ from: '2026-02-31' }).set(ownerA).expect(400);
    await request(server).get('/api/audit').query({ to: '2026-13-01' }).set(ownerA).expect(400);

    await request(server)
      .patch('/api/school')
      .set(ownerA)
      .send({ city: 'Lahore', phone: '0421234567', email: `office+${run}@test.pk`, logoUrl: 'https://example.com/logo.png' })
      .expect(200);
    const cleared = await request(server).patch('/api/school').set(ownerA).send({ city: null, phone: '', email: '', logoUrl: null }).expect(200);
    expect(cleared.body).toMatchObject({ city: null, phone: null, email: null, logoUrl: null });
    await request(server).patch('/api/school').set(ownerA).send({ email: 'not-an-email' }).expect(400);
  });
});
