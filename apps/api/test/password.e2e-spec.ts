import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { BootstrapError, createPlatformOwner } from '../src/platform/bootstrap-owner.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

describe('Passwords and sessions (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ownerEmail = `pw+${run}@test.pk`;
  const teacherEmail = `pw-teacher+${run}@test.pk`;
  const consoleEmail = `pw-console+${run}@schoolsyncer.test`;
  let schoolSlug: string;
  let owner: Record<string, string>;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (loginId: string, password: string) =>
    request(server).post('/api/auth/login').send({ schoolSlug, login: loginId, password });
  const changePassword = (auth: Record<string, string>, currentPassword: string, newPassword: string) =>
    request(server).post('/api/auth/change-password').set(auth).send({ currentPassword, newPassword });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Passwords ${run}`, ownerName: 'Owner', email: ownerEmail, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = bearer(reg.body.accessToken);
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await deleteSchools(prisma, { slug: schoolSlug });
    await prisma.platformAuditLog.deleteMany({ where: { admin: { email: consoleEmail } } });
    await prisma.platformAdmin.deleteMany({ where: { email: consoleEmail } });
    await app.close();
  });

  it('lets a user change their own password and ends their other sessions', async () => {
    // A self-chosen password needs no change.
    const first = await login(ownerEmail, 'password123').expect(200);
    expect(first.body.user.mustChangePassword).toBe(false);
    const other = bearer(first.body.accessToken);
    expect((await request(server).get('/api/auth/me').set(other).expect(200)).body.mustChangePassword).toBe(false);

    await changePassword(other, 'not-my-password1', 'a-better-pass1').expect(400);
    // Too short, no digit, no letter, or unchanged.
    await changePassword(other, 'password123', 'short1').expect(400);
    await changePassword(other, 'password123', 'onlyletters').expect(400);
    await changePassword(other, 'password123', '1234567890').expect(400);
    await changePassword(other, 'password123', 'password123').expect(400);

    const changed = await changePassword(owner, 'password123', 'a-better-pass1').expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    // Both tokens issued before the change stop working; the new one carries on.
    await request(server).get('/api/campuses').set(owner).expect(401);
    await request(server).get('/api/campuses').set(other).expect(401);
    owner = bearer(changed.body.accessToken);
    await request(server).get('/api/campuses').set(owner).expect(200);

    await login(ownerEmail, 'password123').expect(401);
    await login(ownerEmail, 'a-better-pass1').expect(200);
  });

  it('holds an admin-issued password to a forced change, and a reset ends open sessions', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: 'New Teacher', email: teacherEmail, roles: [{ role: 'TEACHER' }] })
      .expect(201);
    const temp = created.body.temporaryPassword as string;

    const signedIn = await login(teacherEmail, temp).expect(200);
    expect(signedIn.body.user.mustChangePassword).toBe(true);
    let teacher = bearer(signedIn.body.accessToken);
    // Nothing but me and change-password works until the password is replaced.
    await request(server).get('/api/classes').set(teacher).expect(403);
    const me = await request(server).get('/api/auth/me').set(teacher).expect(200);
    expect(me.body.mustChangePassword).toBe(true);

    await changePassword(teacher, 'wrong-password1', 'teacher-pass1').expect(400);
    const changed = await changePassword(teacher, temp, 'teacher-pass1').expect(200);
    await request(server).get('/api/classes').set(teacher).expect(401);
    teacher = bearer(changed.body.accessToken);
    await request(server).get('/api/classes').set(teacher).expect(200);
    expect((await request(server).get('/api/auth/me').set(teacher).expect(200)).body.mustChangePassword).toBe(false);

    // An admin reset ends the session and asks for a new password again.
    const reset = await request(server).post(`/api/users/${created.body.id}/reset-password`).set(owner).expect(200);
    await request(server).get('/api/auth/me').set(teacher).expect(401);
    await login(teacherEmail, 'teacher-pass1').expect(401);
    const again = await login(teacherEmail, reset.body.temporaryPassword).expect(200);
    expect(again.body.user.mustChangePassword).toBe(true);
    await request(server).get('/api/classes').set(bearer(again.body.accessToken)).expect(403);
  });

  it('bootstraps a console owner from the command line with a one-time password', async () => {
    const prisma = app.get(PrismaService);
    // Forced, as other suites may already have created owners in this database.
    const made = await createPlatformOwner(prisma, { email: consoleEmail, name: 'First Owner', force: true });
    expect(made.password).toHaveLength(16);
    expect(made.admin).toMatchObject({ role: 'OWNER', mustChangePassword: true });
    // With an owner in place, a second one needs --force.
    await expect(createPlatformOwner(prisma, { email: `x${consoleEmail}`, name: 'Second' })).rejects.toThrow(BootstrapError);
    await expect(
      createPlatformOwner(prisma, { email: consoleEmail, name: 'First Owner', password: 'weak', force: true }),
    ).rejects.toThrow(BootstrapError);

    const signedIn = await request(server)
      .post('/api/platform/auth/login')
      .send({ email: consoleEmail, password: made.password })
      .expect(200);
    expect(signedIn.body.admin.mustChangePassword).toBe(true);
    const token = bearer(signedIn.body.accessToken);
    await request(server).get('/api/platform/schools').set(token).expect(403);

    // Recovering the account ends the session opened with the old password.
    const again = await createPlatformOwner(prisma, { email: consoleEmail, name: 'First Owner', force: true });
    expect(again.recovered).toBe(true);
    await request(server).get('/api/platform/auth/me').set(token).expect(401);
  });
});
