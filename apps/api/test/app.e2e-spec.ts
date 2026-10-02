import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Runs against the database in DATABASE_URL; each run uses unique emails.
describe('SchoolSyncer API (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  // Test files run in parallel; a random suffix keeps their schools apart.
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await deleteSchools(prisma, { email: { endsWith: `+${run}@test.pk` } });
    await app.close();
  });

  const emailFor = (prefix: string) => `${prefix}+${run}@test.pk`;

  async function registerSchool(name: string, emailPrefix: string) {
    const res = await request(server)
      .post('/api/auth/register-school')
      .send({
        schoolName: name,
        ownerName: 'Owner',
        email: emailFor(emailPrefix),
        password: 'password123',
      })
      .expect(201);
    return res.body as { schoolSlug: string; accessToken: string };
  }

  it('reports health without a token', async () => {
    await request(server).get('/api/health').expect(200, { status: 'ok' });
  });

  it('rejects protected routes without a token', async () => {
    await request(server).get('/api/campuses').expect(401);
  });

  it('registers a school, logs in and sets up a class with a section', async () => {
    const { schoolSlug } = await registerSchool(`Alpha ${run}`, 'alpha');

    const login = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login: emailFor('alpha'), password: 'password123' })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const campuses = await request(server).get('/api/campuses').set(auth).expect(200);
    expect(campuses.body).toHaveLength(1);
    const campusId = campuses.body[0].id;

    const year = await request(server)
      .post('/api/academic-years')
      .set(auth)
      .send({ name: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31', isCurrent: true })
      .expect(201);

    const grade = await request(server)
      .post('/api/classes')
      .set(auth)
      .send({ campusId, name: 'Grade 5' })
      .expect(201);

    await request(server)
      .post(`/api/classes/${grade.body.id}/sections`)
      .set(auth)
      .send({ academicYearId: year.body.id, name: 'A', capacity: 30 })
      .expect(201);

    const classes = await request(server).get('/api/classes').set(auth).expect(200);
    expect(classes.body[0].sections[0].name).toBe('A');
  });

  it('keeps schools isolated from each other', async () => {
    const alpha = await registerSchool(`Iso A ${run}`, 'iso-a');
    const beta = await registerSchool(`Iso B ${run}`, 'iso-b');

    const alphaCampuses = await request(server)
      .get('/api/campuses')
      .set({ Authorization: `Bearer ${alpha.accessToken}` })
      .expect(200);

    // Beta cannot attach a class to Alpha's campus.
    await request(server)
      .post('/api/classes')
      .set({ Authorization: `Bearer ${beta.accessToken}` })
      .send({ campusId: alphaCampuses.body[0].id, name: 'Grade 1' })
      .expect(404);
  });

  it('stops a teacher from changing school setup', async () => {
    const { accessToken, schoolSlug } = await registerSchool(`Roles ${run}`, 'roles');
    const owner = { Authorization: `Bearer ${accessToken}` };

    await request(server)
      .post('/api/users')
      .set(owner)
      .send({
        name: 'Teacher',
        phone: '03001234567',
        password: 'password123',
        roles: [{ role: 'TEACHER' }],
      })
      .expect(201);

    const login = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login: '03001234567', password: 'password123' })
      .expect(200);

    await request(server)
      .post('/api/campuses')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .send({ name: 'North campus' })
      .expect(403);
  });
});
