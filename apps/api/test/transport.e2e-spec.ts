import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { daysBefore, localToday } from '../src/common/dates.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Vans, routes and riders, and transport on the fee voucher.
describe('Transport (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  const period = today.slice(0, 7);

  let owner: Record<string, string>;
  let schoolSlug: string;
  let schoolId: string;
  let classId: string;
  let yearId: string;
  const students: string[] = [];
  let vanId: string;
  let routeId: string;
  let stops: { id: string; name: string }[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({
        schoolName: `Transport ${run}`,
        ownerName: 'Owner',
        email: `van+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id;
    yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({
          name: 'This year',
          startsOn: `${today.slice(0, 4)}-01-01`,
          endsOn: `${today.slice(0, 4)}-12-31`,
          isCurrent: true,
        })
        .expect(201)
    ).body.id;
    classId = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 4' })
        .expect(201)
    ).body.id;
    const sectionId = (
      await request(server)
        .post(`/api/classes/${classId}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'A' })
        .expect(201)
    ).body.id;
    for (const [i, firstName] of ['Hamza', 'Iqra', 'Bilal'].entries()) {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({
          sectionId,
          firstName,
          gender: 'MALE',
          guardians: [
            {
              name: 'Parent',
              phone: `033${run.slice(-7)}${i}`,
              relation: 'Father',
            },
          ],
        })
        .expect(201);
      students.push(res.body.id);
    }
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('sets up a van, a route and its stops', async () => {
    vanId = (
      await request(server)
        .post('/api/transport/vehicles')
        .set(owner)
        .send({
          registrationNo: 'lea-1234',
          type: 'VAN',
          capacity: 2,
          driverName: 'Rafiq Ahmed',
          driverPhone: '03001112233',
        })
        .expect(201)
    ).body.id;
    await request(server)
      .post('/api/transport/vehicles')
      .set(owner)
      .send({
        registrationNo: 'LEA-1234',
        capacity: 10,
        driverName: 'Someone',
        driverPhone: '03001112234',
      })
      .expect(409);

    routeId = (
      await request(server)
        .post('/api/transport/routes')
        .set(owner)
        .send({
          name: 'Route 1: Johar Town',
          vehicleId: vanId,
          monthlyFee: 4000,
        })
        .expect(201)
    ).body.id;
    stops = (
      await request(server)
        .put(`/api/transport/routes/${routeId}/stops`)
        .set(owner)
        .send({
          stops: [
            {
              name: 'Expo Centre',
              pickupTime: '06:55',
              dropTime: '14:35',
              monthlyFee: 5000,
            },
            { name: 'Shaukat Khanum', pickupTime: '07:10', dropTime: '14:20' },
          ],
        })
        .expect(200)
    ).body;
    expect(stops.map((s) => s.name)).toEqual(['Expo Centre', 'Shaukat Khanum']);
  });

  it('puts students on the route until the van is full', async () => {
    await request(server)
      .post('/api/transport/assignments')
      .set(owner)
      .send({
        studentId: students[0],
        routeId,
        stopId: stops[0].id,
        startsOn: `${period}-01`,
      })
      .expect(201);
    await request(server)
      .post('/api/transport/assignments')
      .set(owner)
      .send({ studentId: students[1], routeId, stopId: stops[1].id })
      .expect(201);
    const full = await request(server)
      .post('/api/transport/assignments')
      .set(owner)
      .send({ studentId: students[2], routeId })
      .expect(409);
    expect(full.body.message).toMatch(/full: LEA-1234 has 2 seats/);

    const detail = await request(server)
      .get(`/api/transport/routes/${routeId}`)
      .set(owner)
      .expect(200);
    expect(
      detail.body.riders.map(
        (r: { name: string; fee: number; class: string }) => [
          r.name,
          r.fee,
          r.class,
        ],
      ),
    ).toEqual([
      ['Hamza', 5000, 'Grade 4 A'],
      ['Iqra', 4000, 'Grade 4 A'],
    ]);
    expect(detail.body.riders[0].phones).toHaveLength(1);

    const list = await request(server)
      .get('/api/transport/routes')
      .set(owner)
      .expect(200);
    expect(list.body[0]).toMatchObject({ riders: 2, monthlyBilling: 9000 });
  });

  it('refuses to shrink the van or drop a stop below its riders', async () => {
    await request(server)
      .patch(`/api/transport/vehicles/${vanId}`)
      .set(owner)
      .send({ capacity: 1 })
      .expect(409);
    const res = await request(server)
      .put(`/api/transport/routes/${routeId}/stops`)
      .set(owner)
      .send({ stops: [{ id: stops[1].id, name: 'Shaukat Khanum' }] })
      .expect(409);
    expect(res.body.message).toMatch(/picked up at Expo Centre/);
  });

  it('adds transport to the fee voucher', async () => {
    const head = await request(server)
      .post('/api/fees/heads')
      .set(owner)
      .send({ name: 'Tuition' })
      .expect(201);
    await request(server)
      .put('/api/fees/structures')
      .set(owner)
      .send({
        classId,
        feeHeadId: head.body.id,
        academicYearId: yearId,
        amount: 6000,
      })
      .expect(200);
    await request(server)
      .post('/api/fees/invoices/generate')
      .set(owner)
      .send({ period })
      .expect(201);
    const invoices = await prisma.invoice.findMany({
      where: { schoolId, period },
      include: { lines: true, student: true },
    });
    const total = (name: string) =>
      invoices.find((i) => i.student.firstName === name)?.total;
    expect([total('Hamza'), total('Iqra'), total('Bilal')]).toEqual([
      11000, 10000, 6000,
    ]);
    expect(
      invoices
        .find((i) => i.student.firstName === 'Hamza')
        ?.lines.map((l) => l.description),
    ).toContain('Transport');
  });

  it('moves a student and keeps the history', async () => {
    // Moving on the day the ride started replaces it.
    await request(server)
      .post('/api/transport/assignments')
      .set(owner)
      .send({ studentId: students[1], routeId, stopId: stops[0].id })
      .expect(201);
    let history = await request(server)
      .get(`/api/transport/students/${students[1]}`)
      .set(owner)
      .expect(200);
    expect(history.body).toMatchObject({
      current: { stop: 'Expo Centre', fee: 5000 },
      history: [],
    });

    // A ride that ends leaves a record and frees the seat.
    await request(server)
      .post(`/api/transport/assignments/${history.body.current.id}/end`)
      .set(owner)
      .send({})
      .expect(201);
    history = await request(server)
      .get(`/api/transport/students/${students[1]}`)
      .set(owner)
      .expect(200);
    expect(history.body.current).toBeNull();
    expect(history.body.history[0]).toMatchObject({ endsOn: today });
    await request(server)
      .post('/api/transport/assignments')
      .set(owner)
      .send({ studentId: students[2], routeId, startsOn: daysBefore(today, 0) })
      .expect(201);
  });

  it('is part of the Growth plan only', async () => {
    const starter = await prisma.plan.findUniqueOrThrow({
      where: { code: 'starter' },
    });
    await prisma.subscription.update({
      where: { schoolId },
      data: { planId: starter.id },
    });
    app.get(SubscriptionService).forget(schoolId);
    await request(server).get('/api/transport/routes').set(owner).expect(403);
  });
});
