import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { keyId, secretKey } from '../src/fees/gateways/school-accounts.js';
import { rotateSecrets } from '../src/platform/secret-rotation.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Rotating PAYMENTS_SECRET_KEY (with the re-encryption script) and
// JWT_SECRET while the API is running.
describe('Secret rotation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const env = { ...process.env };
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const oldKey = randomBytes(32).toString('hex');
  const newKey = randomBytes(32).toString('hex');
  let owner: Record<string, string>;
  let accessToken = '';
  let schoolId = '';
  let schoolSlug = '';

  beforeAll(async () => {
    process.env.PAYMENTS_SECRET_KEY = oldKey;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Rotation ${run}`, ownerName: 'Owner', email: `rotation+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolId = reg.body.user.schoolId;
    schoolSlug = reg.body.schoolSlug;
    accessToken = reg.body.accessToken;
    owner = { Authorization: `Bearer ${accessToken}` };
  });

  afterAll(async () => {
    process.env = env;
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  const jazzcash = async () => (await request(server).get('/api/school/payment-accounts').set(owner).expect(200)).body.gateways[0].ownAccount;
  const sender = async () => (await request(server).get('/api/school/messaging').set(owner).expect(200)).body.ownSender;
  const stored = async () => ({
    gateway: (await prisma.schoolPaymentGateway.findFirstOrThrow({ where: { schoolId, provider: 'JAZZCASH' } })).secrets,
    sender: (await prisma.schoolMessagingSender.findUniqueOrThrow({ where: { schoolId } })).secrets,
  });
  /** Ours among what the script could not open (other suites share the database, with their own keys). */
  const ourFailures = async (report: Awaited<ReturnType<typeof rotateSecrets>>) => {
    const gatewayId = (await prisma.schoolPaymentGateway.findFirstOrThrow({ where: { schoolId, provider: 'JAZZCASH' } })).id;
    return [...report.paymentAccounts.failed.filter((f) => f.id === gatewayId), ...report.messagingSenders.failed.filter((f) => f.id === schoolId)];
  };

  describe('PAYMENTS_SECRET_KEY', () => {
    it('re-encrypts saved school secrets with the new key, reading old ones meanwhile', async () => {
      await request(server)
        .put('/api/school/payment-accounts/jazzcash')
        .set(owner)
        .send({ enabled: true, settings: { merchantId: 'ROT1' }, secrets: { password: 'rot-pass', integritySalt: 'rot-salt' } })
        .expect(200);
      await request(server).put('/api/school/messaging').set(owner).send({ enabled: true, phoneNumberId: '1234567890', token: 'wa-token' }).expect(200);
      const before = await stored();
      const oldId = keyId(secretKey(oldKey)!);
      expect(before.gateway.startsWith(`v2:${oldId}:`)).toBe(true);
      expect(before.sender.startsWith(`v2:${oldId}:`)).toBe(true);

      // Step 1: deploy with the new key, the old one kept for decrypting.
      Object.assign(process.env, { PAYMENTS_SECRET_KEY: newKey, PAYMENTS_SECRET_KEY_PREVIOUS: oldKey });
      expect(await jazzcash()).toMatchObject({ missing: [], secretsSet: { password: true, integritySalt: true } });
      expect(await sender()).toMatchObject({ tokenSet: true });

      // Step 2: the script, dry run first, changes nothing.
      const dry = await rotateSecrets(prisma, { env: process.env });
      expect(dry.paymentAccounts.resealed).toBeGreaterThanOrEqual(1);
      expect(dry.messagingSenders.resealed).toBeGreaterThanOrEqual(1);
      expect(await stored()).toEqual(before);

      const applied = await rotateSecrets(prisma, { env: process.env, apply: true });
      expect(await ourFailures(applied)).toEqual([]);
      const after = await stored();
      const newId = keyId(secretKey(newKey)!);
      expect(after.gateway.startsWith(`v2:${newId}:`)).toBe(true);
      expect(after.sender.startsWith(`v2:${newId}:`)).toBe(true);

      // Step 3: drop the previous key; everything still opens.
      delete process.env.PAYMENTS_SECRET_KEY_PREVIOUS;
      expect(await jazzcash()).toMatchObject({ missing: [], secretsSet: { password: true, integritySalt: true } });
      expect(await sender()).toMatchObject({ tokenSet: true });

      // Running it again finds nothing of ours to do.
      const again = await rotateSecrets(prisma, { env: process.env });
      expect(await ourFailures(again)).toEqual([]);
      expect(await stored()).toEqual(after);
    });

    it('cannot read secrets sealed with a key that was dropped too early', async () => {
      process.env.PAYMENTS_SECRET_KEY = randomBytes(32).toString('hex');
      // The account counts as switched off rather than failing the page.
      expect(await jazzcash()).toMatchObject({ secretsSet: { password: false, integritySalt: false } });
      process.env.PAYMENTS_SECRET_KEY = newKey;
      expect(await jazzcash()).toMatchObject({ secretsSet: { password: true } });
    });
  });

  describe('JWT_SECRET', () => {
    const oldSecret = `old-jwt-${randomBytes(24).toString('hex')}`;
    const signedWithOld = () => {
      const { iat: _iat, exp: _exp, ...claims } = new JwtService().decode(accessToken) as Record<string, unknown>;
      return new JwtService({ secret: oldSecret }).sign(claims, { expiresIn: '1h' });
    };

    it('accepts sessions signed with JWT_SECRET_PREVIOUS only during the rotation window', async () => {
      const token = signedWithOld();
      await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      process.env.JWT_SECRET_PREVIOUS = oldSecret;
      const me = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(me.body.schoolId ?? me.body.user?.schoolId).toBe(schoolId);
      // New sign-ins are signed with JWT_SECRET, not the previous one.
      const login = await request(server).post('/api/auth/login').send({ schoolSlug, login: `rotation+${run}@test.pk`, password: 'password123' }).expect(200);
      expect(() => new JwtService({ secret: oldSecret }).verify(login.body.accessToken)).toThrow();
      delete process.env.JWT_SECRET_PREVIOUS;
      await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      await request(server).get('/api/auth/me').set(owner).expect(200);
    });
  });
});
