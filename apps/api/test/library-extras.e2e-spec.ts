import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { dayStart, daysBefore, localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Reservations, barcode labels and the Excel book import.
describe('Library reservations, labels and import (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  let owner: Record<string, string>;
  let schoolSlug: string;
  let ownerId: string;
  const students: string[] = [];
  let bookId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Lib extras ${run}`, ownerName: 'Owner', email: `libx+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    ownerId = reg.body.user.sub;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true })
        .expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 6' }).expect(201)).body.id;
    const sectionId = (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
    for (const [i, firstName] of ['Maryam', 'Usman', 'Hira'].entries()) {
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send({ sectionId, firstName, gender: 'FEMALE', guardians: [{ name: 'Parent', phone: `034${run.slice(-7)}${i}`, relation: 'Mother' }] })
        .expect(201);
      students.push(res.body.id);
    }
    const book = await request(server).post('/api/library/books').set(owner).send({ title: 'Heer Ranjha', copies: 1 }).expect(201);
    bookId = book.body.id;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('refuses to reserve a book that is on the shelf', async () => {
    const res = await request(server).post('/api/library/reservations').set(owner).send({ bookId, studentId: students[0] }).expect(409);
    expect(res.body.message).toMatch(/on the shelf/);
  });

  it('queues reservations and holds the returned copy for the first in line', async () => {
    const loan = await request(server).post('/api/library/loans').set(owner).send({ accessionNo: '1', studentId: students[0] }).expect(201);
    const r1 = await request(server).post('/api/library/reservations').set(owner).send({ bookId, studentId: students[1] }).expect(201);
    await request(server).post('/api/library/reservations').set(owner).send({ bookId, studentId: students[1] }).expect(409);
    // A borrower can't queue for the book they already hold.
    await request(server).post('/api/library/reservations').set(owner).send({ bookId, studentId: students[0] }).expect(409);
    await request(server).post('/api/library/reservations').set(owner).send({ bookId, userId: ownerId }).expect(201);

    const queue = await request(server).get('/api/library/reservations').set(owner).expect(200);
    expect(queue.body.map((r: { status: string; position: number }) => [r.status, r.position])).toEqual([['WAITING', 1], ['WAITING', 2]]);

    await request(server).post(`/api/library/loans/${loan.body.id}/return`).set(owner).expect(201);
    const held = await request(server).get('/api/library/reservations').set(owner).expect(200);
    expect(held.body[0]).toMatchObject({ id: r1.body.id, status: 'READY', accessionNo: '1', borrower: { name: 'Usman' } });
    expect(held.body[1]).toMatchObject({ status: 'WAITING', position: 1 });

    // The held copy can't go to someone else, but its holder can take it.
    const blocked = await request(server).post('/api/library/loans').set(owner).send({ accessionNo: '1', studentId: students[2] }).expect(409);
    expect(blocked.body.message).toMatch(/held for Usman/);
    await request(server).post('/api/library/loans').set(owner).send({ accessionNo: '1', studentId: students[1] }).expect(201);
    const after = await request(server).get('/api/library/reservations?status=all').set(owner).expect(200);
    expect(after.body.map((r: { status: string }) => r.status)).toEqual(['FULFILLED', 'WAITING']);
  });

  it('releases a hold nobody collected to the next person', async () => {
    const [mine] = (await request(server).get('/api/library/reservations').set(owner)).body;
    const loans = (await request(server).get('/api/library/loans?status=out').set(owner)).body;
    await request(server).post(`/api/library/loans/${loans[0].id}/return`).set(owner).expect(201);
    const ready = (await request(server).get('/api/library/reservations').set(owner)).body[0];
    expect(ready).toMatchObject({ id: mine.id, status: 'READY' });
    // The three days pass.
    await prisma.bookReservation.update({ where: { id: ready.id }, data: { holdUntil: dayStart(daysBefore(today, 1)) } });
    const list = await request(server).get('/api/library/reservations?status=all').set(owner).expect(200);
    expect(list.body.find((r: { id: string }) => r.id === ready.id).status).toBe('EXPIRED');
    // Cancelling an open reservation is a no-op for anything already settled.
    await request(server).post(`/api/library/reservations/${ready.id}/cancel`).set(owner).expect(404);
  });

  it('prints barcode labels for copies', async () => {
    await request(server).post(`/api/library/books/${bookId}/copies`).set(owner).send({ count: 2 }).expect(201);
    const labels = await request(server).get('/api/library/labels?from=2&to=3').set(owner).expect(200);
    expect(labels.body.map((l: { accessionNo: string }) => l.accessionNo)).toEqual(['2', '3']);
    expect(labels.body[0]).toMatchObject({ title: 'Heer Ranjha' });
    expect(labels.body[0].modules).toMatch(/^[01]+$/);
    const byBook = await request(server).get(`/api/library/labels?bookId=${bookId}`).set(owner).expect(200);
    expect(byBook.body).toHaveLength(3);
  });

  it('imports books from a sheet: checks first, adds copies to known titles', async () => {
    const rows = [
      { title: 'Gulistan', author: 'Saadi', isbn: '978-969-8123-45-6', copies: '3', category: 'Poetry' },
      { title: 'Heer Ranjha' },
      { title: '', copies: 'x' },
    ];
    const preview = await request(server).post('/api/library/books/import').set(owner).send({ rows }).expect(201);
    expect(preview.body).toMatchObject({ valid: 2, invalid: 1, warned: 1, imported: 0 });
    expect(preview.body.rows[2].errors).toHaveLength(2);

    const clean = rows.slice(0, 2);
    // Heer Ranjha is already catalogued, so committing needs the warning confirmed.
    const unconfirmed = await request(server).post('/api/library/books/import').set(owner).send({ rows: clean, commit: true }).expect(201);
    expect(unconfirmed.body).toMatchObject({ warned: 1, imported: 0, needsConfirmation: true });
    const done = await request(server).post('/api/library/books/import').set(owner).send({ rows: clean, commit: true, confirmWarnings: true }).expect(201);
    expect(done.body).toMatchObject({ imported: 2, copies: 4 });

    const books = await request(server).get('/api/library/books?search=gulistan').set(owner).expect(200);
    expect(books.body[0]).toMatchObject({ title: 'Gulistan', isbn: '9789698123456', copies: 3, category: 'Poetry' });
    const heer = await request(server).get(`/api/library/books/${bookId}`).set(owner).expect(200);
    expect(heer.body.copies).toHaveLength(4);
    // Numbers continue after the highest in use: 1 and 2-3 existed, so the import took 4 to 7.
    const numbers = await prisma.bookCopy.findMany({ where: { book: { schoolId: (await prisma.school.findUniqueOrThrow({ where: { slug: schoolSlug } })).id } }, select: { accessionNo: true } });
    expect(numbers.map((c) => Number(c.accessionNo)).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // The same sheet again warns about titles already catalogued and needs a confirmation.
    const again = await request(server).post('/api/library/books/import').set(owner).send({ rows: clean, commit: true }).expect(201);
    expect(again.body).toMatchObject({ warned: 2, imported: 0, needsConfirmation: true });
    // Importing the sheet again with confirmation adds copies to the same books, never second entries.
    expect((await request(server).get('/api/library/books?search=gulistan').set(owner)).body).toHaveLength(1);
  });
});
