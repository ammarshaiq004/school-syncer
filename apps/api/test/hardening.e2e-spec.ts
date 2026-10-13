import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { ENQUIRY_LIMIT } from '../src/admissions/admissions.controller.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Public route limits, health and input checks that keep bad requests out of the 500s.
describe('Hardening (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let owner: Record<string, string>;
  let schoolSlug: string;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Hardening ${run}`, ownerName: 'Owner', email: `hardening+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(app.get(PrismaService), { slug: schoolSlug });
    await app.close();
  });

  it('reports health after checking the database', async () => {
    await request(server).get('/api/health').expect(200, { status: 'ok' });
  });

  it('limits public enquiries from one address', async () => {
    const send = () =>
      request(server).post(`/api/public/${schoolSlug}/enquiries`).send({
        campusId: 'nowhere',
        classId: 'nothing',
        childName: 'Ali Khan',
        gender: 'MALE',
        guardianName: 'Imran Khan',
        guardianPhone: '03001234567',
      });
    for (let i = 0; i < ENQUIRY_LIMIT; i++) expect((await send()).status).not.toBe(429);
    const limited = await send().expect(429);
    expect(limited.body.message).toMatch(/^Too many requests/);
    // Other public routes have their own allowance.
    await request(server).get('/api/verify/NOTACODE22').expect(200);
  });

  it('answers 400, not 500, for unknown filter values', async () => {
    await request(server).get('/api/fees/invoices?status=NOPE').set(owner).expect(400);
    await request(server).get('/api/fees/invoices?status=PAID').set(owner).expect(200);
    await request(server).get('/api/students?status=nope').set(owner).expect(400);
    await request(server).get('/api/students').set(owner).expect(200);
    await request(server).get('/api/applications?stage=NOPE').set(owner).expect(400);
  });
});
