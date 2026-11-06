import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

// Visitor book, post register, short leave, complaints, phone book, birthdays, localities and slips.
describe('Front office (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let frontDesk: Record<string, string>;
  let slugA: string;
  let slugB: string;
  let ownerB: Record<string, string>;
  let sectionId: string;
  let studentId: string;

  async function signIn(slug: string, login: string) {
    const res = await request(server).post('/api/auth/login').send({ schoolSlug: slug, login, password: 'password123' }).expect(200);
    await keepIssuedPassword(app, res.body);
    return bearer(res.body.accessToken);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = async (name: string, email: string) =>
      (await request(server).post('/api/auth/register-school').send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' }).expect(201)).body;
    const a = await reg(`Front ${run}`, `fo+${run}@test.pk`);
    const b = await reg(`Front B ${run}`, `fob+${run}@test.pk`);
    slugA = a.schoolSlug;
    slugB = b.schoolSlug;
    owner = bearer(a.accessToken);
    ownerB = bearer(b.accessToken);

    await request(server).post('/api/users').set(owner)
      .send({ name: 'Reception', phone: `037${run.slice(-7)}1`, password: 'password123', roles: [{ role: 'STAFF' }] }).expect(201);
    await request(server).post('/api/users').set(owner)
      .send({ name: 'Teacher', phone: `037${run.slice(-7)}2`, password: 'password123', roles: [{ role: 'TEACHER' }] }).expect(201);
    frontDesk = await signIn(slugA, `037${run.slice(-7)}1`);
    teacher = await signIn(slugA, `037${run.slice(-7)}2`);

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server).post('/api/academic-years').set(owner)
        .send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true }).expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 7' }).expect(201)).body.id;
    sectionId = (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: slugA });
    await deleteSchools(prisma, { slug: slugB });
    await app.close();
  });

  it('keeps the front desk to staff with that permission', async () => {
    await request(server).get('/api/front-office/visitors').set(teacher).expect(403);
    await request(server).get('/api/front-office/visitors').set(frontDesk).expect(200);
  });

  it('sets up localities and links a student to one', async () => {
    const loc = await request(server).post('/api/front-office/localities').set(owner).send({ name: 'Model Town' }).expect(201);
    await request(server).post('/api/front-office/localities').set(owner).send({ name: 'Model Town' }).expect(400);
    await request(server).post('/api/front-office/localities').set(frontDesk).send({ name: 'Johar' }).expect(403);

    const foreign = await request(server).post('/api/front-office/localities').set(ownerB).send({ name: 'Elsewhere' }).expect(201);
    const dob = `2014-${today.slice(5)}`;
    const student = await request(server).post('/api/students').set(owner)
      .send({
        sectionId, firstName: 'Zoya', lastName: 'Ali', gender: 'FEMALE', dateOfBirth: dob, address: 'House 9', localityId: loc.body.id,
        guardians: [{ name: 'Ali Raza', phone: `0341${run.slice(-7)}`, relation: 'Father', isPrimary: true }],
      })
      .expect(201);
    studentId = student.body.id;
    await request(server).patch(`/api/students/${studentId}`).set(owner).send({ localityId: foreign.body.id }).expect(400);

    const list = await request(server).get('/api/front-office/localities').set(owner).expect(200);
    expect(list.body).toMatchObject([{ name: 'Model Town', students: 1 }]);
  });

  it('shows today\'s birthdays and prints class information slips', async () => {
    const b = await request(server).get('/api/front-office/birthdays?days=7').set(frontDesk).expect(200);
    expect(b.body).toMatchObject([{ name: 'Zoya Ali', daysAway: 0, turning: Number(today.slice(0, 4)) - 2014, className: 'Grade 7 A' }]);

    const slips = await request(server).get(`/api/front-office/slips?sectionId=${sectionId}`).set(frontDesk).expect(200);
    expect(slips.body.className).toBe('Grade 7 A');
    expect(slips.body.slips[0]).toMatchObject({
      name: 'Zoya Ali',
      address: 'House 9, Model Town',
      guardians: [{ name: 'Ali Raza', relation: 'Father' }],
    });
    await request(server).get('/api/front-office/slips').set(frontDesk).expect(400);
    await request(server).get(`/api/front-office/slips?sectionId=${sectionId}`).set(ownerB).expect(404);
  });

  it('logs visitors in and out', async () => {
    const v = await request(server).post('/api/front-office/visitors').set(frontDesk)
      .send({ name: 'Mr Khan', purpose: 'Meet principal', meetingWith: 'Principal', cardNo: '12' }).expect(201);
    const inside = await request(server).get('/api/front-office/visitors?inside=1').set(frontDesk).expect(200);
    expect(inside.body).toMatchObject([{ name: 'Mr Khan', minutes: null }]);
    await request(server).patch(`/api/front-office/visitors/${v.body.id}/checkout`).set(frontDesk).expect(200);
    await request(server).patch(`/api/front-office/visitors/${v.body.id}/checkout`).set(frontDesk).expect(400);
    const after = await request(server).get('/api/front-office/visitors?inside=1').set(frontDesk).expect(200);
    expect(after.body).toEqual([]);
    const other = await request(server).get('/api/front-office/visitors').set(ownerB).expect(200);
    expect(other.body).toEqual([]);
  });

  it('keeps a post register', async () => {
    await request(server).post('/api/front-office/postal').set(frontDesk)
      .send({ direction: 'RECEIVED', party: 'Education Board', subject: 'Exam circular', referenceNo: 'D-44' }).expect(201);
    await request(server).post('/api/front-office/postal').set(frontDesk)
      .send({ direction: 'SENT', party: 'Parent', subject: 'Fee notice', mode: 'TCS' }).expect(201);
    const sent = await request(server).get('/api/front-office/postal?direction=SENT').set(frontDesk).expect(200);
    expect(sent.body).toMatchObject([{ subject: 'Fee notice' }]);
    const found = await request(server).get('/api/front-office/postal?search=d-44').set(frontDesk).expect(200);
    expect(found.body).toHaveLength(1);
  });

  it('records short leave for a current student', async () => {
    const leave = await request(server).post('/api/front-office/short-leaves').set(frontDesk)
      .send({ studentId, reason: 'Doctor appointment', pickedUpBy: 'Ali Raza', relation: 'Father' }).expect(201);
    await request(server).post('/api/front-office/short-leaves').set(ownerB)
      .send({ studentId, reason: 'x', pickedUpBy: 'y' }).expect(404);
    await request(server).patch(`/api/front-office/short-leaves/${leave.body.id}/return`).set(frontDesk).expect(200);
    const rows = await request(server).get('/api/front-office/short-leaves').set(frontDesk).expect(200);
    expect(rows.body).toMatchObject([{ studentName: 'Zoya Ali', className: 'Grade 7 A', reason: 'Doctor appointment' }]);
    expect(rows.body[0].returnedAt).toBeTruthy();
  });

  it('moves a complaint forward and demands a resolution', async () => {
    const c = await request(server).post('/api/front-office/complaints').set(frontDesk)
      .send({ complainant: 'Ali Raza', category: 'Transport', description: 'Van is late every day', studentId }).expect(201);
    await request(server).patch(`/api/front-office/complaints/${c.body.id}`).set(frontDesk).send({ status: 'RESOLVED' }).expect(400);
    await request(server).patch(`/api/front-office/complaints/${c.body.id}`).set(frontDesk).send({ status: 'IN_PROGRESS' }).expect(200);
    const done = await request(server).patch(`/api/front-office/complaints/${c.body.id}`).set(frontDesk)
      .send({ status: 'RESOLVED', resolution: 'Route changed' }).expect(200);
    expect(done.body.resolvedAt).toBeTruthy();
    await request(server).patch(`/api/front-office/complaints/${c.body.id}`).set(frontDesk).send({ status: 'OPEN' }).expect(400);
    const open = await request(server).get('/api/front-office/complaints?status=OPEN').set(frontDesk).expect(200);
    expect(open.body).toEqual([]);
  });

  it('keeps a phone book', async () => {
    const c = await request(server).post('/api/front-office/contacts').set(frontDesk)
      .send({ name: 'Dr Sana', category: 'Medical', phone: '042-1234567' }).expect(201);
    const found = await request(server).get('/api/front-office/contacts?search=sana').set(frontDesk).expect(200);
    expect(found.body).toHaveLength(1);
    await request(server).patch(`/api/front-office/contacts/${c.body.id}`).set(frontDesk).send({ phone: '042-7654321' }).expect(200);
    await request(server).delete(`/api/front-office/contacts/${c.body.id}`).set(ownerB).expect(404);
    await request(server).delete(`/api/front-office/contacts/${c.body.id}`).set(frontDesk).expect(200);
  });
});
