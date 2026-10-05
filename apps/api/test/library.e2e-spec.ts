import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { dayStart, daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// The catalogue, the issue desk, overdue books and fines on the voucher.
describe('Library (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  const period = today.slice(0, 7);

  let owner: Record<string, string>;
  let schoolSlug: string;
  let ownerId: string;
  let classId: string;
  let yearId: string;
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
        schoolName: `Library ${run}`,
        ownerName: 'Owner',
        email: `lib+${run}@test.pk`,
        password: 'password123',
      })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    ownerId = reg.body.user.sub;
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
        .send({ campusId, name: 'Grade 6' })
        .expect(201)
    ).body.id;
    const sectionId = (
      await request(server)
        .post(`/api/classes/${classId}/sections`)
        .set(owner)
        .send({ academicYearId: yearId, name: 'A' })
        .expect(201)
    ).body.id;
    for (const [i, firstName] of ['Maryam', 'Usman'].entries()) {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({
          sectionId,
          firstName,
          gender: 'FEMALE',
          guardians: [
            {
              name: 'Parent',
              phone: `034${run.slice(-7)}${i}`,
              relation: 'Mother',
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

  it('catalogues books and numbers their copies', async () => {
    const first = await request(server)
      .post('/api/library/books')
      .set(owner)
      .send({
        title: 'The Jungle Book',
        author: 'Rudyard Kipling',
        category: 'Fiction',
        copies: 2,
      })
      .expect(201);
    expect(
      first.body.copies.map((c: { accessionNo: string }) => c.accessionNo),
    ).toEqual(['1', '2']);
    await request(server)
      .post('/api/library/books')
      .set(owner)
      .send({ title: 'Oxford Atlas', category: 'Reference' })
      .expect(201);
    await request(server)
      .post('/api/library/books')
      .set(owner)
      .send({ title: 'Umro Ayyar', language: 'Urdu', copies: 1 })
      .expect(201);

    const found = await request(server)
      .get('/api/library/books?search=jungle')
      .set(owner)
      .expect(200);
    expect(found.body).toMatchObject([
      { title: 'The Jungle Book', copies: 2, available: 2 },
    ]);
    const byNumber = await request(server)
      .get('/api/library/copies/3')
      .set(owner)
      .expect(200);
    expect(byNumber.body.book.title).toBe('Oxford Atlas');
  });

  it('lends within the limit and not to anyone with an overdue book', async () => {
    await request(server)
      .patch('/api/library/settings')
      .set(owner)
      .send({ libraryMaxLoans: 2, libraryFinePerDay: 10 })
      .expect(200);
    const loan = await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '1', studentId: students[0] })
      .expect(201);
    expect(loan.body).toMatchObject({
      title: 'The Jungle Book',
      borrower: { name: 'Maryam' },
      overdue: false,
    });
    await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '1', studentId: students[1] })
      .expect(409);
    await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '2', studentId: students[0] })
      .expect(201);
    const limit = await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '3', studentId: students[0] })
      .expect(409);
    expect(limit.body.message).toMatch(/limit is 2/);

    // Staff borrow without a limit.
    await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '3', userId: ownerId })
      .expect(201);

    // Make Maryam's first book three days overdue.
    await prisma.bookLoan.update({
      where: { id: loan.body.id },
      data: { dueOn: dayStart(daysBefore(today, 3)) },
    });
    const overdue = await request(server)
      .get('/api/library/loans?status=overdue')
      .set(owner)
      .expect(200);
    expect(overdue.body.map((l: { title: string }) => l.title)).toEqual([
      'The Jungle Book',
    ]);
    const blocked = await request(server)
      .post('/api/library/loans')
      .set(owner)
      .send({ accessionNo: '4', studentId: students[0] })
      .expect(409);
    expect(blocked.body.message).toMatch(/overdue book: The Jungle Book/);
    await request(server)
      .post(`/api/library/loans/${loan.body.id}/return`)
      .set(owner)
      .expect(201);
  });

  it('charges late and lost books, and puts unpaid fines on the voucher', async () => {
    const fines = await request(server)
      .get('/api/library/loans?status=fines')
      .set(owner)
      .expect(200);
    expect(fines.body).toMatchObject([
      { title: 'The Jungle Book', fine: 30, fineStatus: 'DUE' },
    ]);

    const out = await request(server)
      .get('/api/library/loans?status=out')
      .set(owner)
      .expect(200);
    const second = out.body.find(
      (l: { accessionNo: string }) => l.accessionNo === '2',
    );
    await request(server)
      .post(`/api/library/loans/${second.id}/lost`)
      .set(owner)
      .send({ charge: 800 })
      .expect(201);
    expect(
      (await request(server).get('/api/library/copies/2').set(owner)).body
        .status,
    ).toBe('LOST');

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
        amount: 5000,
      })
      .expect(200);
    await request(server)
      .post('/api/fees/invoices/generate')
      .set(owner)
      .send({ period })
      .expect(201);
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { studentId: students[0], period },
      include: { lines: true },
    });
    expect(invoice.total).toBe(5830);
    expect(invoice.lines.map((l) => l.description).sort()).toEqual([
      'Library fine: The Jungle Book',
      'Library fine: The Jungle Book (lost)',
      'Tuition',
    ]);
    const billed = await request(server)
      .get('/api/library/loans?status=fines')
      .set(owner)
      .expect(200);
    expect(billed.body).toEqual([]);
  });

  it('shows a student their books', async () => {
    const res = await request(server)
      .get(`/api/library/students/${students[0]}`)
      .set(owner)
      .expect(200);
    expect(res.body).toHaveLength(2);
    expect(
      res.body.every((l: { fineStatus: string }) => l.fineStatus === 'BILLED'),
    ).toBe(true);
    const summary = await request(server)
      .get('/api/library/summary')
      .set(owner)
      .expect(200);
    expect(summary.body).toMatchObject({
      titles: 3,
      onLoan: 1,
      overdue: 0,
      copies: { AVAILABLE: 2, LOST: 1, ON_LOAN: 1 },
    });
  });
});
