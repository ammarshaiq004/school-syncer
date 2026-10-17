import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Mobile app version gate: the public check, the console settings (owners
// only, audited) and the 426 every API route answers to outdated builds.
describe('Mobile app version gate (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ownerEmail = `owner+${run}@appversion.test`;
  const supportEmail = `support+${run}@appversion.test`;
  const schoolEmail = `owner+${run}@appversion-school.test`;
  let owner: Record<string, string>;
  let support: Record<string, string>;
  let ownerId: string;
  let school: Record<string, string>;
  let schoolSlug: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const android = (version: string) => ({ 'X-App-Platform': 'android', 'X-App-Version': version, 'X-App-Build': '7' });
  const ios = (version: string) => ({ 'X-App-Platform': 'ios', 'X-App-Version': version, 'X-App-Build': '7' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    // A clean slate: no console settings, so the env defaults apply.
    await prisma.appRelease.deleteMany();

    const passwordHash = await bcrypt.hash('password123', 4);
    ownerId = (
      await prisma.platformAdmin.create({
        data: { email: ownerEmail, name: 'Sana Owner', role: 'OWNER', passwordHash },
      })
    ).id;
    await prisma.platformAdmin.create({
      data: { email: supportEmail, name: 'Bilal Support', role: 'SUPPORT', passwordHash },
    });
    const login = (email: string) =>
      request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200);
    owner = auth((await login(ownerEmail)).body.accessToken);
    support = auth((await login(supportEmail)).body.accessToken);

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `App Version ${run}`, ownerName: 'Owner', email: schoolEmail, password: 'password123' })
      .expect(201);
    school = auth(reg.body.accessToken);
    schoolSlug = reg.body.schoolSlug;
  });

  afterAll(async () => {
    await prisma.appRelease.deleteMany();
    await deleteSchools(prisma, { email: { endsWith: `@appversion-school.test` } });
    const admins = { email: { in: [ownerEmail, supportEmail] } };
    await prisma.platformAuditLog.deleteMany({ where: { admin: admins } });
    await prisma.platformAdmin.deleteMany({ where: admins });
    await app.close();
  });

  it('publishes the env defaults to anyone before the console sets anything', async () => {
    const res = await request(server).get('/api/app/version').expect(200);
    expect(res.body.ios).toMatchObject({ minVersion: '0.0.0', latestVersion: '0.0.0', message: '' });
    expect(res.body.android).toMatchObject({
      minVersion: '0.0.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=pk.schoolsyncer.app',
    });
  });

  it('shows support the settings but only lets owners change them', async () => {
    const list = await request(server).get('/api/platform/app-versions').set(support).expect(200);
    expect(list.body.map((r: { platform: string }) => r.platform)).toEqual(['IOS', 'ANDROID']);
    expect(list.body[0]).toMatchObject({ source: 'default', updatedBy: null });
    await request(server)
      .put('/api/platform/app-versions/ANDROID')
      .set(support)
      .send({ minVersion: '2.0.0', latestVersion: '2.1.0' })
      .expect(403);
    // School tokens never reach the console.
    await request(server).get('/api/platform/app-versions').set(school).expect(401);
  });

  it('validates versions, links and the platform', async () => {
    const put = (platform: string, body: object) =>
      request(server).put(`/api/platform/app-versions/${platform}`).set(owner).send(body);
    await put('ANDROID', { minVersion: 'v2', latestVersion: '2.1.0' }).expect(400);
    const below = await put('ANDROID', { minVersion: '2.1.0', latestVersion: '2.0.0' }).expect(400);
    expect(JSON.stringify(below.body)).toContain('cannot be below the minimum');
    await put('ANDROID', { minVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: 'http://insecure.example' }).expect(400);
    await put('WINDOWS', { minVersion: '2.0.0', latestVersion: '2.1.0' }).expect(400);
  });

  it('saves an owner change, applies it at once and audits it', async () => {
    const saved = await request(server)
      .put('/api/platform/app-versions/ANDROID')
      .set(owner)
      .send({ minVersion: '2.0.0', latestVersion: '2.1.0', message: 'Fee receipts moved: please update' })
      .expect(200);
    expect(saved.body).toMatchObject({ minVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: expect.stringContaining('play.google.com') });

    const pub = await request(server).get('/api/app/version').expect(200);
    expect(pub.body.android).toMatchObject({ minVersion: '2.0.0', latestVersion: '2.1.0', message: 'Fee receipts moved: please update' });
    expect(pub.body.ios.minVersion).toBe('0.0.0');

    const list = await request(server).get('/api/platform/app-versions').set(owner).expect(200);
    expect(list.body[1]).toMatchObject({ platform: 'ANDROID', source: 'console', updatedBy: 'Sana Owner' });
    expect(list.body[1].defaults.minVersion).toBe('0.0.0');

    const audit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { adminId: ownerId, action: 'app_version.update' },
    });
    expect(audit.details).toMatchObject({
      platform: 'ANDROID',
      before: { minVersion: '0.0.0' },
      after: { minVersion: '2.0.0', latestVersion: '2.1.0' },
    });
  });

  it('refuses outdated Android builds with 426 APP_UPDATE_REQUIRED on every route', async () => {
    const me = await request(server).get('/api/auth/me').set(school).set(android('1.9.9')).expect(426);
    expect(me.body).toMatchObject({
      statusCode: 426,
      code: 'APP_UPDATE_REQUIRED',
      minVersion: '2.0.0',
      message: 'Fee receipts moved: please update',
      storeUrl: expect.stringContaining('play.google.com'),
    });
    // Before sign-in too, so an outdated build cannot log in.
    await request(server)
      .post('/api/auth/login')
      .set(android('1.0.0'))
      .send({ schoolSlug, login: schoolEmail, password: 'password123' })
      .expect(426);
  });

  it('still answers the version check and health checks for outdated builds', async () => {
    const res = await request(server).get('/api/app/version').set(android('1.0.0')).expect(200);
    expect(res.body.android.minVersion).toBe('2.0.0');
    await request(server).get('/api/health').set(android('1.0.0')).expect(200);
  });

  it('lets current builds, other platforms, the web and header-less clients through', async () => {
    await request(server).get('/api/auth/me').set(school).set(android('2.0.0')).expect(200);
    await request(server).get('/api/auth/me').set(school).set(android('2.0')).expect(200);
    await request(server).get('/api/auth/me').set(school).set(ios('1.0.0')).expect(200);
    await request(server).get('/api/auth/me').set(school).set({ 'X-App-Platform': 'web', 'X-App-Version': '0.1.0' }).expect(200);
    await request(server).get('/api/auth/me').set(school).expect(200);
    // An unauthenticated outdated-looking request is still a 401 once it passes the gate.
    await request(server).get('/api/auth/me').set(android('2.1.0')).expect(401);
  });

  it('lets an owner reset a platform to the env defaults', async () => {
    const reset = await request(server).delete('/api/platform/app-versions/ANDROID').set(owner).expect(200);
    expect(reset.body.minVersion).toBe('0.0.0');
    await request(server).get('/api/auth/me').set(school).set(android('1.0.0')).expect(200);
    await request(server).delete('/api/platform/app-versions/ANDROID').set(support).expect(403);
    expect(
      await prisma.platformAuditLog.count({ where: { adminId: ownerId, action: 'app_version.reset' } }),
    ).toBe(1);
  });
});
