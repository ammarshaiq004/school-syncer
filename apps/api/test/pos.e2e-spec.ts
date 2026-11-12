import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Canteen: stock moves with every sale and purchase, tabs, vendors and the reports.
describe('Point of sale (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  let owner: Record<string, string>;
  let schoolSlug: string;
  let studentId: string;
  let warehouseId: string;
  let samosaId: string;
  let vendorId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Canteen ${run}`, ownerName: 'Owner', email: `pos+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (
      await request(server).post('/api/academic-years').set(owner).send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true }).expect(201)
    ).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 6' }).expect(201)).body.id;
    const sectionId = (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
    studentId = (
      await request(server).post('/api/students').set(owner).send({ sectionId, firstName: 'Maryam', gender: 'FEMALE', guardians: [{ name: 'Parent', phone: `034${run.slice(-7)}0`, relation: 'Mother' }] }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('starts with a store, takes a product with opening stock and a vendor', async () => {
    const stores = await request(server).get('/api/pos/warehouses').set(owner).expect(200);
    expect(stores.body.map((w: { name: string }) => w.name)).toEqual(['Main store']);
    warehouseId = stores.body[0].id;

    const item = await request(server).post('/api/pos/items').set(owner).send({ name: 'Samosa', category: 'Snacks', costPrice: 18, salePrice: 30, reorderLevel: 5, openingQty: 10, warehouseId }).expect(201);
    samosaId = item.body.id;
    await request(server).post('/api/pos/items').set(owner).send({ name: 'Samosa', barcode: 'X1', salePrice: 30 }).expect(201);
    await request(server).post('/api/pos/items').set(owner).send({ name: 'Other', barcode: 'X1', salePrice: 30 }).expect(409);

    const list = await request(server).get('/api/pos/items').set(owner).expect(200);
    expect(list.body.find((i: { id: string }) => i.id === samosaId).onHand).toBe(10);

    vendorId = (await request(server).post('/api/pos/vendors').set(owner).send({ name: 'Al-Madina Traders' }).expect(201)).body.id;
    await request(server).post('/api/pos/vendors').set(owner).send({ name: 'Al-Madina Traders' }).expect(409);
  });

  it('sells for cash, refuses to oversell and takes stock down', async () => {
    const sale = await request(server).post('/api/pos/sales').set(owner).send({ warehouseId, lines: [{ itemId: samosaId, qty: 2 }, { itemId: samosaId, qty: 1 }], discount: 10 }).expect(201);
    expect(sale.body).toMatchObject({ number: 'S-000001', subtotal: 90, total: 80, payment: 'CASH' });
    expect(sale.body.lines).toHaveLength(1);

    await request(server).post('/api/pos/sales').set(owner).send({ warehouseId, lines: [{ itemId: samosaId, qty: 50 }] }).expect(409);
    await request(server).post('/api/pos/sales').set(owner).send({ warehouseId, lines: [{ itemId: samosaId, qty: 1 }], discount: 31 }).expect(400);
    const stock = await request(server).get('/api/pos/stock').set(owner).expect(200);
    expect(stock.body.find((s: { itemId: string }) => s.itemId === samosaId).qty).toBe(7);
  });

  it('puts a sale on a student account and collects it later', async () => {
    await request(server).post('/api/pos/sales').set(owner).send({ warehouseId, lines: [{ itemId: samosaId, qty: 1 }], payment: 'ON_ACCOUNT' }).expect(400);
    await request(server).post('/api/pos/sales').set(owner).send({ warehouseId, lines: [{ itemId: samosaId, qty: 3 }], payment: 'ON_ACCOUNT', studentId }).expect(201);

    const owing = await request(server).get('/api/pos/reports/receivables').set(owner).expect(200);
    expect(owing.body).toMatchObject([{ student: 'Maryam', amount: 90, sales: 1 }]);
    const found = await request(server).get('/api/pos/customers?search=Mary').set(owner).expect(200);
    expect(found.body[0]).toMatchObject({ id: studentId, onAccount: 90 });

    expect((await request(server).post('/api/pos/accounts/settle').set(owner).send({ studentId }).expect(201)).body).toEqual({ amount: 90, sales: 1 });
    await request(server).post('/api/pos/accounts/settle').set(owner).send({ studentId }).expect(409);
    expect((await request(server).get('/api/pos/reports/receivables').set(owner)).body).toEqual([]);
  });

  it('cancels a sale and puts the goods back', async () => {
    const sale = await request(server).post('/api/pos/sales').set(owner).send({ warehouseId, lines: [{ itemId: samosaId, qty: 2 }] }).expect(201);
    const before = (await request(server).get('/api/pos/stock').set(owner)).body.find((s: { itemId: string }) => s.itemId === samosaId).qty;
    await request(server).post(`/api/pos/sales/${sale.body.id}/void`).set(owner).send({ reason: 'Wrong item' }).expect(201);
    await request(server).post(`/api/pos/sales/${sale.body.id}/void`).set(owner).send({ reason: 'Again' }).expect(409);
    const after = (await request(server).get('/api/pos/stock').set(owner)).body.find((s: { itemId: string }) => s.itemId === samosaId).qty;
    expect(after).toBe(before + 2);
  });

  it('records a purchase, keeps what is owed and takes payments', async () => {
    const purchase = await request(server).post('/api/pos/purchases').set(owner).send({ vendorId, warehouseId, lines: [{ itemId: samosaId, qty: 20, unitCost: 20 }], paid: 100 }).expect(201);
    expect(purchase.body).toMatchObject({ number: 'PUR-0001', total: 400, paid: 100 });
    expect((await prisma.posItem.findUniqueOrThrow({ where: { id: samosaId } })).costPrice).toBe(20);

    const payables = await request(server).get('/api/pos/reports/payables').set(owner).expect(200);
    expect(payables.body).toMatchObject([{ vendor: 'Al-Madina Traders', owed: 300 }]);
    await request(server).post(`/api/pos/purchases/${purchase.body.id}/pay`).set(owner).send({ amount: 301 }).expect(409);
    const paid = await request(server).post(`/api/pos/purchases/${purchase.body.id}/pay`).set(owner).send({ amount: 300 }).expect(201);
    expect(paid.body.paid).toBe(400);
  });

  it('moves stock between stores and corrects a count', async () => {
    const second = await request(server).post('/api/pos/warehouses').set(owner).send({ name: 'Canteen counter' }).expect(201);
    await request(server).post('/api/pos/stock/transfer').set(owner).send({ itemId: samosaId, fromId: warehouseId, toId: second.body.id, qty: 5 }).expect(201);
    await request(server).post('/api/pos/stock/transfer').set(owner).send({ itemId: samosaId, fromId: second.body.id, toId: warehouseId, qty: 6 }).expect(409);
    await request(server).post('/api/pos/stock/adjust').set(owner).send({ itemId: samosaId, warehouseId: second.body.id, change: -1, reason: 'Dropped' }).expect(201);
    const at = await request(server).get(`/api/pos/stock?warehouseId=${second.body.id}`).set(owner).expect(200);
    expect(at.body[0].qty).toBe(4);
  });

  it('reports sales, profit and the dashboard', async () => {
    const range = `from=${today}&to=${today}`;
    const profit = await request(server).get(`/api/pos/reports/profit?${range}`).set(owner).expect(200);
    // 80 cash (cost 18 x 3, less 10 discount: 90 - 54 - 10 = 26) and 90 on account (3 x 12 = 36).
    expect(profit.body).toMatchObject([{ day: today, sales: 2, revenue: 170, profit: 62 }]);
    const products = await request(server).get(`/api/pos/reports/product-sales?${range}`).set(owner).expect(200);
    expect(products.body[0]).toMatchObject({ product: 'Samosa', qty: 6 });
    const dash = await request(server).get('/api/pos/reports/dashboard').set(owner).expect(200);
    expect(dash.body).toMatchObject({ today: { sales: 2, revenue: 170 }, payables: 0, receivables: 0 });
    await request(server).get('/api/pos/reports/nope').set(owner).expect(404);
    const moves = await request(server).get(`/api/pos/reports/stock-transactions?${range}`).set(owner).expect(200);
    expect(moves.body.length).toBeGreaterThan(5);
  });
});

describe('Admissions report and occupation list (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const today = localToday();
  let owner: Record<string, string>;
  let schoolSlug: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Admissions ${run}`, ownerName: 'Owner', email: `adm+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  it('counts students admitted and students who left', async () => {
    const campusId = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    const yearId = (await request(server).post('/api/academic-years').set(owner).send({ name: 'This year', startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`, isCurrent: true }).expect(201)).body.id;
    const classId = (await request(server).post('/api/classes').set(owner).send({ campusId, name: 'Grade 1' }).expect(201)).body.id;
    const sectionId = (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name: 'A' }).expect(201)).body.id;
    const ids: string[] = [];
    for (const [i, firstName] of ['Ali', 'Sara'].entries()) {
      ids.push((await request(server).post('/api/students').set(owner).send({ sectionId, firstName, gender: 'MALE', guardians: [{ name: 'Parent', phone: `034${run.slice(-7)}${i}`, relation: 'Father' }] }).expect(201)).body.id);
    }
    await request(server).patch(`/api/students/${ids[1]}`).set(owner).send({ status: 'LEFT', leavingReason: 'Other' }).expect(200);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids[1] } })).leftOn?.toISOString().slice(0, 10)).toBe(today);

    const report = await request(server).get(`/api/reports/admissions-withdrawals?from=${today.slice(0, 4)}-01-01&to=${today}`).set(owner).expect(200);
    expect(report.body.totals).toEqual({ admitted: 2, withdrawn: 1 });
    expect(report.body.withdrawn[0]).toMatchObject({ name: 'Sara', class: 'Grade 1 A' });
    expect(report.body.months.at(-1)).toMatchObject({ month: today.slice(0, 7), admitted: 2, withdrawn: 1, net: 1 });

    await request(server).patch(`/api/students/${ids[1]}`).set(owner).send({ status: 'ACTIVE' }).expect(200);
    expect((await request(server).get(`/api/reports/admissions-withdrawals?from=${today.slice(0, 4)}-01-01&to=${today}`).set(owner)).body.totals.withdrawn).toBe(0);
  });

  it('keeps a tidy list of fathers’ occupations', async () => {
    const saved = await request(server).patch('/api/school').set(owner).send({ occupations: [' Teacher ', 'farmer', 'teacher', ''] }).expect(200);
    expect(saved.body.occupations).toEqual(['farmer', 'Teacher']);
    expect((await request(server).get('/api/school').set(owner)).body.occupations).toEqual(['farmer', 'Teacher']);
  });
});
