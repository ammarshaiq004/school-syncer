import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { dayStart, daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Leaving, character and enrolment certificates, checking them online, and ID cards.
describe('Certificates (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  const year = today.slice(0, 4);

  let owner: Record<string, string>;
  let schoolSlug: string;
  let schoolId: string;
  let ownerId: string;
  let sectionId: string;
  const students: string[] = [];

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
        schoolName: `Certificates ${run}`,
        ownerName: 'Owner',
        email: `cert+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    ownerId = reg.body.user.sub;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner))
      .body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({
          name: `${year}-${Number(year.slice(2)) + 1}`,
          startsOn: `${year}-01-01`,
          endsOn: `${year}-12-31`,
          isCurrent: true,
        })
        .expect(201)
    ).body.id;
    const classId = (
      await request(server)
        .post('/api/classes')
        .set(owner)
        .send({ campusId, name: 'Grade 8' })
        .expect(201)
    ).body.id;
    sectionId = (
      await request(server)
        .post(`/api/classes/${classId}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'B' })
        .expect(201)
    ).body.id;
    for (const [i, firstName] of ['Hamza', 'Zainab', 'Bilal'].entries()) {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({
          sectionId,
          firstName,
          lastName: 'Qureshi',
          gender: i === 1 ? 'FEMALE' : 'MALE',
          dateOfBirth: '2012-03-15',
          guardians: [
            {
              name: 'Saima Qureshi',
              phone: `035${run.slice(-7)}${i}`,
              relation: 'Mother',
              isPrimary: true,
            },
            {
              name: 'Tariq Qureshi',
              phone: `036${run.slice(-7)}${i}`,
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

  it('refuses a leaving certificate while fees or library books are owed', async () => {
    const [hamza] = students;
    await prisma.invoice.create({
      data: {
        schoolId,
        studentId: hamza,
        voucherNo: `C-${run}`,
        period: today.slice(0, 7),
        dueDate: dayStart(today),
        total: 6500,
        paid: 2500,
        status: 'PARTIAL',
      },
    });
    await request(server)
      .post('/api/library/books')
      .set(owner)
      .send({ title: 'Animal Farm', copies: 1 })
      .expect(201);
    const loan = await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '1', studentId: hamza })
      .expect(201);

    const draft = await request(server)
      .get(`/api/certificates/students/${hamza}/draft`)
      .set(owner)
      .expect(200);
    expect(draft.body).toMatchObject({
      duesOwed: 4000,
      booksOut: ['Animal Farm'],
      details: {
        studentName: 'Hamza Qureshi',
        guardianName: 'Tariq Qureshi',
        guardianRelation: 'Father',
        dateOfBirthWords: 'Fifteenth March, Two Thousand and Twelve',
        classAdmitted: 'Grade 8',
        className: 'Grade 8 B',
      },
    });

    const books = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({ studentId: hamza, type: 'LEAVING' })
      .expect(409);
    expect(books.body.message).toMatch(/not returned: Animal Farm/);
    await request(server)
      .post(`/api/library/loans/${loan.body.id}/return`)
      .set(owner)
      .send({})
      .expect(201);

    const dues = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({ studentId: hamza, type: 'LEAVING' })
      .expect(409);
    expect(dues.body.message).toMatch(/Rs 4,000 in fees is still owed/);
  });

  it('issues a leaving certificate, takes the student off the rolls and the van', async () => {
    const [hamza] = students;
    const route = await prisma.transportRoute.create({
      data: { schoolId, name: `Route ${run}`, monthlyFee: 3000 },
    });
    await prisma.transportAssignment.create({
      data: {
        schoolId,
        studentId: hamza,
        routeId: route.id,
        startsOn: dayStart(daysBefore(today, 60)),
      },
    });

    const issued = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({
        studentId: hamza,
        type: 'LEAVING',
        reason: 'Family moved to Islamabad',
        conduct: 'Very good',
        allowDues: true,
      })
      .expect(201);
    expect(issued.body).toMatchObject({
      type: 'LEAVING',
      serialNo: `SLC-${year}-0001`,
      issuedOn: today,
      details: {
        leavingOn: today,
        reason: 'Family moved to Islamabad',
        conduct: 'Very good',
        duesOwed: 4000,
      },
      school: { name: `Certificates ${run}` },
    });
    expect(issued.body.verifyCode).toMatch(/^[A-Z2-9]{10}$/);

    const student = await prisma.student.findUniqueOrThrow({
      where: { id: hamza },
      include: { enrollments: true, transport: true },
    });
    expect(student.status).toBe('LEFT');
    expect(student.enrollments.map((e) => e.status)).toEqual(['LEFT']);
    expect(student.transport[0].endsOn?.toISOString().slice(0, 10)).toBe(today);

    const again = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({ studentId: hamza, type: 'LEAVING', allowDues: true })
      .expect(409);
    expect(again.body.message).toMatch(/SLC-\d{4}-0001/);

    // Anyone can check it, without signing in.
    const check = await request(server)
      .get(`/api/verify/${issued.body.verifyCode.toLowerCase()}`)
      .expect(200);
    expect(check.body).toMatchObject({
      found: true,
      valid: true,
      serialNo: `SLC-${year}-0001`,
      studentName: 'Hamza Qureshi',
      leavingOn: today,
    });
    expect(
      (await request(server).get('/api/verify/NOTACODE22').expect(200)).body,
    ).toEqual({ found: false });

    // Cancelled: it stops verifying, and a corrected one gets the next number.
    await request(server)
      .post(`/api/certificates/${issued.body.id}/cancel`)
      .set(owner)
      .send({ reason: 'Wrong leaving date' })
      .expect(201);
    const cancelled = await request(server)
      .get(`/api/verify/${issued.body.verifyCode}`)
      .expect(200);
    expect(cancelled.body).toMatchObject({ valid: false, cancelledOn: today });
    const corrected = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({
        studentId: hamza,
        type: 'LEAVING',
        leavingOn: daysBefore(today, 3),
        allowDues: true,
      })
      .expect(201);
    expect(corrected.body.serialNo).toBe(`SLC-${year}-0002`);
  });

  it('issues enrolment and character certificates', async () => {
    const [hamza, zainab] = students;
    const enrolment = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({ studentId: zainab, type: 'ENROLMENT' })
      .expect(201);
    expect(enrolment.body).toMatchObject({
      serialNo: `EC-${year}-0001`,
      details: { studentName: 'Zainab Qureshi', className: 'Grade 8 B' },
    });
    const left = await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({ studentId: hamza, type: 'ENROLMENT' })
      .expect(409);
    expect(left.body.message).toMatch(/not studying here now/);
    await request(server)
      .post('/api/certificates')
      .set(owner)
      .send({ studentId: hamza, type: 'CHARACTER', conduct: 'Excellent' })
      .expect(201);

    const register = await request(server)
      .get('/api/certificates?search=hamza')
      .set(owner)
      .expect(200);
    expect(
      register.body.map((c: { serialNo: string }) => c.serialNo).sort(),
    ).toEqual([`CC-${year}-0001`, `SLC-${year}-0001`, `SLC-${year}-0002`]);
    const bySerial = await request(server)
      .get(`/api/certificates?search=ec-${year}-0001`)
      .set(owner)
      .expect(200);
    expect(bySerial.body).toHaveLength(1);
  });

  it('prints ID cards for a section and for staff', async () => {
    const cards = await request(server)
      .get(`/api/certificates/id-cards/students?sectionId=${sectionId}`)
      .set(owner)
      .expect(200);
    // Hamza has left, so only two cards.
    expect(cards.body.cards).toHaveLength(2);
    expect(cards.body.cards[0]).toMatchObject({
      className: 'Grade 8 B',
      guardianName: 'Tariq Qureshi',
      validUntil: `${year}-12-31`,
    });

    await prisma.staffProfile.create({
      data: {
        schoolId,
        userId: ownerId,
        employeeNo: 'EMP-001',
        designation: 'Principal',
      },
    });
    const staff = await request(server)
      .get('/api/certificates/id-cards/staff')
      .set(owner)
      .expect(200);
    expect(staff.body.cards).toMatchObject([
      { name: 'Owner', employeeNo: 'EMP-001', designation: 'Principal' },
    ]);
  });
});
