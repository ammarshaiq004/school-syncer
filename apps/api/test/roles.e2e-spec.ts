import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// School roles and permissions: the module matrix under the @Roles ceiling.
describe('Roles and permissions (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `035${run.slice(-7)}${n}`;

  let slugA: string;
  let slugB: string;
  let schoolA: string;
  let ownerA: Record<string, string>;
  let ownerB: Record<string, string>;
  let accountant: Record<string, string>;
  let admin: Record<string, string>;
  let coordinatorId: string;
  let roleId: string;

  async function register(name: string, email: string) {
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' })
      .expect(201);
    return { slug: reg.body.schoolSlug as string, schoolId: reg.body.user.schoolId as string, auth: { Authorization: `Bearer ${reg.body.accessToken}` } };
  }

  async function addUser(owner: Record<string, string>, n: number, role: string) {
    const res = await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: `${role} ${n}`, phone: phone(n), password: 'password123', roles: [{ role }] })
      .expect(201);
    return res.body.id as string;
  }

  async function loginAs(schoolSlug: string, login: string) {
    const res = await request(server).post('/api/auth/login').send({ schoolSlug, login, password: 'password123' }).expect(200);
    await keepIssuedPassword(app, res.body);
    return { headers: { Authorization: `Bearer ${res.body.accessToken}` }, user: res.body.user };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const a = await register(`Roles A ${run}`, `roles-a+${run}@test.pk`);
    const b = await register(`Roles B ${run}`, `roles-b+${run}@test.pk`);
    slugA = a.slug;
    slugB = b.slug;
    schoolA = a.schoolId;
    ownerA = a.auth;
    ownerB = b.auth;
    await addUser(ownerA, 1, 'ACCOUNTANT');
    await addUser(ownerA, 2, 'ADMIN');
    coordinatorId = await addUser(ownerA, 3, 'TEACHER');
    await addUser(ownerB, 4, 'ACCOUNTANT');
    accountant = (await loginAs(slugA, phone(1))).headers;
    admin = (await loginAs(slugA, phone(2))).headers;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: slugA });
    await deleteSchools(prisma, { slug: slugB });
    await app.close();
  });

  it('reports effective permissions on /auth/me', async () => {
    const owner = await request(server).get('/api/auth/me').set(ownerA).expect(200);
    expect(Object.values(owner.body.permissions).every((l) => l === 'manage')).toBe(true);
    const acc = await request(server).get('/api/auth/me').set(accountant).expect(200);
    expect(acc.body.permissions).toMatchObject({ fees: 'manage', accounts: 'manage', reports: 'view', users: 'none', audit: 'none' });
    expect(acc.body.roles).toEqual([{ role: 'ACCOUNTANT', campusId: null, customRoleId: null }]);
  });

  it('lists the module catalog and the roles', async () => {
    const catalog = await request(server).get('/api/roles/modules').set(ownerA).expect(200);
    expect(catalog.body.levels).toEqual(['none', 'view', 'manage']);
    const finance = catalog.body.groups.find((g: { key: string }) => g.key === 'finance');
    expect(finance.label).toBe('Finance');
    expect(finance.modules.map((m: { key: string }) => m.key)).toContain('fees');

    const roles = await request(server).get('/api/roles').set(ownerA).expect(200);
    const byRole = Object.fromEntries(roles.body.builtin.map((r: { role: string }) => [r.role, r]));
    expect(byRole.OWNER).toMatchObject({ editable: false, memberCount: 1 });
    expect(byRole.ACCOUNTANT).toMatchObject({ name: 'Accountant', editable: true, customized: false, memberCount: 1 });
    expect(byRole.ACCOUNTANT.permissions.fees).toBe('manage');
    expect(byRole.PARENT).toBeUndefined();
    expect(roles.body.custom).toEqual([]);

    // Only setup roles reach the roles page at all.
    await request(server).get('/api/roles').set(accountant).expect(403);
  });

  it('narrows a built-in role and enforces it on the next request', async () => {
    const viewOnly = await request(server)
      .put('/api/roles/builtin/ACCOUNTANT')
      .set(ownerA)
      .send({ permissions: { fees: 'view' } })
      .expect(200);
    expect(viewOnly.body).toMatchObject({ role: 'ACCOUNTANT', customized: true });
    expect(viewOnly.body.permissions).toMatchObject({ fees: 'view', accounts: 'manage' });

    await request(server).get('/api/fees/heads').set(accountant).expect(200);
    const denied = await request(server).post('/api/fees/heads').set(accountant).send({ name: 'Lab fee' }).expect(403);
    expect(denied.body.message).toBe('Your role can view Fees but cannot change it');
    expect((await request(server).get('/api/auth/me').set(accountant)).body.permissions.fees).toBe('view');

    await request(server).put('/api/roles/builtin/ACCOUNTANT').set(ownerA).send({ permissions: { fees: 'none' } }).expect(200);
    const none = await request(server).get('/api/fees/heads').set(accountant).expect(403);
    expect(none.body.message).toBe('Your role does not have access to Fees');

    const reset = await request(server).put('/api/roles/builtin/ACCOUNTANT').set(ownerA).send({ reset: true, permissions: {} }).expect(200);
    expect(reset.body.customized).toBe(false);
    await request(server).post('/api/fees/heads').set(accountant).send({ name: 'Lab fee' }).expect(201);
    expect(await prisma.builtinRolePermission.count({ where: { schoolId: schoolA } })).toBe(0);
  });

  it('refuses invalid built-in edits', async () => {
    await request(server).put('/api/roles/builtin/OWNER').set(ownerA).send({ permissions: { fees: 'view' } }).expect(400);
    await request(server).put('/api/roles/builtin/PARENT').set(ownerA).send({ permissions: { fees: 'view' } }).expect(400);
    await request(server).put('/api/roles/builtin/TEACHER').set(ownerA).send({ permissions: { spaceships: 'view' } }).expect(400);
    await request(server).put('/api/roles/builtin/TEACHER').set(ownerA).send({ permissions: { fees: 'admin' } }).expect(400);
  });

  it('creates a custom role, applies it to its holders and protects it while assigned', async () => {
    const created = await request(server)
      .post('/api/roles')
      .set(ownerA)
      .send({ name: 'Exam coordinator', description: 'Runs exams', baseRole: 'TEACHER', permissions: { exams: 'manage', attendance: 'none' } })
      .expect(201);
    roleId = created.body.id;
    expect(created.body).toMatchObject({ name: 'Exam coordinator', baseRole: 'TEACHER', baseRoleName: 'Teacher', memberCount: 0 });
    expect(created.body.permissions).toMatchObject({ exams: 'manage', attendance: 'none', homework: 'manage' });
    // Only what differs from the base role is stored.
    expect(created.body.overrides).toEqual({ exams: 'manage', attendance: 'none' });

    await request(server).post('/api/roles').set(ownerA).send({ name: 'exam Coordinator', baseRole: 'TEACHER' }).expect(409);
    await request(server).post('/api/roles').set(ownerA).send({ name: 'Teacher', baseRole: 'TEACHER' }).expect(409);
    await request(server).post('/api/roles').set(ownerA).send({ name: 'Boss', baseRole: 'OWNER' }).expect(400);

    // Grant it the way the users API stores it: { role: baseRole, customRoleId }.
    await prisma.roleAssignment.updateMany({ where: { userId: coordinatorId }, data: { customRoleId: roleId } });
    const coordinator = await loginAs(slugA, phone(3));
    expect(coordinator.user.roles).toEqual([{ role: 'TEACHER', campusId: null, customRoleId: roleId }]);
    const me = await request(server).get('/api/auth/me').set(coordinator.headers).expect(200);
    expect(me.body.permissions).toMatchObject({ attendance: 'none', exams: 'manage' });
    const blocked = await request(server).get('/api/attendance/sections').set(coordinator.headers).expect(403);
    expect(blocked.body.message).toBe('Your role does not have access to Attendance');
    await request(server).get('/api/exams').set(coordinator.headers).expect(200);

    const patched = await request(server)
      .patch(`/api/roles/${roleId}`)
      .set(ownerA)
      .send({ permissions: { attendance: 'view' }, description: null })
      .expect(200);
    expect(patched.body).toMatchObject({ description: null, memberCount: 1, overrides: { attendance: 'view' } });
    await request(server).get('/api/attendance/sections').set(coordinator.headers).expect(200);

    const listed = await request(server).get('/api/roles').set(ownerA).expect(200);
    expect(listed.body.custom).toEqual([expect.objectContaining({ id: roleId, memberCount: 1 })]);
    expect(listed.body.builtin.find((r: { role: string }) => r.role === 'TEACHER').memberCount).toBe(0);

    const inUse = await request(server).delete(`/api/roles/${roleId}`).set(ownerA).expect(409);
    expect(inUse.body.message).toContain('Exam coordinator is assigned to 1 person');

    const copy = await request(server).post(`/api/roles/${roleId}/duplicate`).set(ownerA).send({}).expect(201);
    expect(copy.body).toMatchObject({ name: 'Exam coordinator (copy)', baseRole: 'TEACHER', memberCount: 0, overrides: { attendance: 'view' } });
    await request(server).post(`/api/roles/${roleId}/duplicate`).set(ownerA).send({ name: 'Exam coordinator (copy)' }).expect(409);
    await request(server).delete(`/api/roles/${copy.body.id}`).set(ownerA).expect(200, { deleted: true });

    const audit = await prisma.auditLog.findMany({ where: { schoolId: schoolA, entity: 'CustomRole' }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(['role.create', 'role.delete', 'role.duplicate', 'role.update']);
  });

  it('does not let an editor grant more than they hold', async () => {
    await request(server).put('/api/roles/builtin/ADMIN').set(ownerA).send({ permissions: { fees: 'view', audit: 'none' } }).expect(200);

    const raise = await request(server).put('/api/roles/builtin/TEACHER').set(admin).send({ permissions: { fees: 'manage' } }).expect(403);
    expect(raise.body.message).toBe('You cannot grant more access than you have: Fees');
    await request(server)
      .post('/api/roles')
      .set(admin)
      .send({ name: 'Auditor', baseRole: 'STAFF', permissions: { audit: 'view' } })
      .expect(403);
    await request(server).patch(`/api/roles/${roleId}`).set(admin).send({ permissions: { fees: 'manage' } }).expect(403);
    // Lowering, or keeping what is already there, is fine.
    await request(server).put('/api/roles/builtin/TEACHER').set(admin).send({ permissions: { homework: 'view', fees: 'view' } }).expect(200);
    // The owner is not limited.
    await request(server).put('/api/roles/builtin/TEACHER').set(ownerA).send({ reset: true, permissions: { fees: 'manage' } }).expect(200);
    // Editing roles needs Users and roles at manage.
    await request(server).put('/api/roles/builtin/ADMIN').set(ownerA).send({ permissions: { users: 'view' } }).expect(200);
    await request(server).post('/api/roles').set(admin).send({ name: 'Clerk', baseRole: 'STAFF' }).expect(403);
    await request(server).get('/api/roles').set(admin).expect(200);
  });

  it('keeps schools apart', async () => {
    const other = await request(server).get('/api/roles').set(ownerB).expect(200);
    expect(other.body.custom).toEqual([]);
    expect(other.body.builtin.every((r: { customized: boolean }) => !r.customized)).toBe(true);
    await request(server).patch(`/api/roles/${roleId}`).set(ownerB).send({ name: 'Taken over' }).expect(404);
    await request(server).post(`/api/roles/${roleId}/duplicate`).set(ownerB).send({}).expect(404);
    await request(server).delete(`/api/roles/${roleId}`).set(ownerB).expect(404);

    // School A's edits never reach school B's accountant.
    await request(server).put('/api/roles/builtin/ACCOUNTANT').set(ownerA).send({ permissions: { fees: 'none' } }).expect(200);
    const accountantB = (await loginAs(slugB, phone(4))).headers;
    await request(server).post('/api/fees/heads').set(accountantB).send({ name: 'Tuition' }).expect(201);
    await request(server).get('/api/fees/heads').set(accountant).expect(403);
  });
});
