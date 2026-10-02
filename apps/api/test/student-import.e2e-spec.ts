import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Moving a school's student list over from a spreadsheet.
describe('Student import (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  let owner: Record<string, string>;
  let schoolSlug: string;

  const rows = [
    {
      admissionNo: '1001',
      firstName: 'Ali',
      lastName: 'Raza',
      gender: 'Male',
      class: 'Grade 2',
      section: 'A',
      rollNo: 7,
      guardianName: 'Raza Hussain',
      guardianRelation: 'Father',
      guardianPhone: '+92 300 1112233',
    },
    {
      firstName: 'Sara',
      lastName: 'Raza',
      gender: 'F',
      dateOfBirth: '05/06/2018',
      class: 'Grade 2 A',
      guardianName: 'Raza Hussain',
      guardianRelation: 'Father',
      guardianPhone: '03001112233',
    },
    {
      admissionNo: '1002',
      firstName: 'Omar',
      gender: 'boy',
      class: 'Grade 2',
      section: 'A',
      guardianName: 'Nadia Bibi',
      guardianRelation: 'Mother',
      guardianPhone: '0321 4445566',
    },
  ];

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
        schoolName: `Import ${run}`,
        ownerName: 'Owner',
        email: `import+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({
          name: '2026-27',
          startsOn: '2026-04-01',
          endsOn: '2027-03-31',
          isCurrent: true,
        })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 2' })
        .expect(201)
    ).body.id;
    await request(server)
      .post(`/api/classes/${classId}/sections`)
      .set(owner)
      .send({ academicYearId: yearId, name: 'A' })
      .expect(201);
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('reports problems without saving anything', async () => {
    const res = await request(server)
      .post('/api/students/import')
      .set(owner)
      .send({
        rows: [
          ...rows,
          {
            firstName: 'Zoya',
            gender: 'F',
            class: 'Grade 9',
            section: 'A',
            guardianName: 'X Y',
            guardianPhone: '0300',
          },
        ],
        commit: true,
      })
      .expect(201);
    expect(res.body).toMatchObject({ valid: 3, invalid: 1, imported: 0 });
    expect(res.body.rows[3].errors).toEqual([
      'No section "Grade 9 A" this year',
      'Guardian phone "0300" should be a mobile number like 0300 1234567',
    ]);
    expect(
      (await request(server).get('/api/students').set(owner)).body,
    ).toHaveLength(0);
  });

  it('imports every row together, sharing guardians between siblings', async () => {
    const check = await request(server)
      .post('/api/students/import')
      .set(owner)
      .send({ rows })
      .expect(201);
    expect(check.body).toMatchObject({ valid: 3, invalid: 0, imported: 0 });

    const res = await request(server)
      .post('/api/students/import')
      .set(owner)
      .send({ rows, commit: true })
      .expect(201);
    expect(res.body.imported).toBe(3);

    const students = (await request(server).get('/api/students').set(owner))
      .body as {
      firstName: string;
      admissionNo: string;
      enrollments: { rollNo: number }[];
      guardians: { guardian: { phone: string } }[];
    }[];
    expect(
      students.map((s) => [
        s.firstName,
        s.admissionNo,
        s.enrollments[0].rollNo,
        s.guardians[0].guardian.phone,
      ]),
    ).toEqual([
      ['Ali', '1001', 7, '03001112233'],
      ['Omar', '1002', 8, '03214445566'],
      ['Sara', `${new Date().getFullYear()}-0001`, 9, '03001112233'],
    ]);
    expect(
      await prisma.guardian.count({ where: { school: { slug: schoolSlug } } }),
    ).toBe(2);

    // Running the same file twice is caught by the admission numbers.
    const again = await request(server)
      .post('/api/students/import')
      .set(owner)
      .send({ rows, commit: true })
      .expect(201);
    expect(again.body).toMatchObject({ invalid: 2, imported: 0 });
  });
});
