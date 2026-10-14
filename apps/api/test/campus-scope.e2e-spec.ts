import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

// Campus-limited staff stay inside their campuses (SCHOOL-133), and teachers
// see only the students they teach (SCHOOL-126). School-wide admins and the
// owner keep working everywhere.
describe('Campus scope (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const phone = (n: number) => `035${run.slice(-7)}${n}`;
  const year = localToday().slice(0, 4);
  const period = `${year}-01`;

  let schoolSlug: string;
  let schoolId: string;
  let main: string; // campus A, from registration
  let north: string; // campus B
  const h: Record<
    'owner' | 'wideAdmin' | 'campusAdmin' | 'northHead' | 'mixed' | 'teacher' | 'accountant',
    Headers
  > = {} as never;
  const uid: Record<
    'owner' | 'wideAdmin' | 'campusAdmin' | 'northHead' | 'mixed' | 'teacher' | 'accountant' | 'northTeacher',
    string
  > = {} as never;
  const sec: Record<'own' | 'taught' | 'other' | 'north', string> = {} as never;
  const kid: Record<'own' | 'taught' | 'other' | 'north', string> = {} as never;

  async function loginAs(login: string) {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug, login, password: 'password123' })
      .expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Campus ${run}`, ownerName: 'Owner', email: `campus+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    uid.owner = reg.body.user.sub;
    const owner = { Authorization: `Bearer ${reg.body.accessToken}` };
    h.owner = owner;

    main = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    north = (await request(server).post('/api/campuses').set(owner).send({ name: `North ${run}` }).expect(201)).body.id;
    const yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: year, startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, isCurrent: true })
        .expect(201)
    ).body.id;

    const user = async (n: number, roles: { role: string; campusId?: string }[]) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name: `User ${n}`, phone: phone(n), password: 'password123', roles })
          .expect(201)
      ).body.id as string;
    uid.wideAdmin = await user(1, [{ role: 'ADMIN' }]);
    uid.campusAdmin = await user(2, [{ role: 'ADMIN', campusId: main }]);
    uid.northHead = await user(3, [{ role: 'PRINCIPAL', campusId: north }]);
    // Principal at the main campus who also teaches at North.
    uid.mixed = await user(4, [
      { role: 'PRINCIPAL', campusId: main },
      { role: 'TEACHER', campusId: north },
    ]);
    uid.teacher = await user(5, [{ role: 'TEACHER', campusId: main }]);
    uid.accountant = await user(6, [{ role: 'ACCOUNTANT', campusId: main }]);
    uid.northTeacher = await user(7, [{ role: 'TEACHER', campusId: north }]);
    for (const [key, n] of [
      ['wideAdmin', 1],
      ['campusAdmin', 2],
      ['northHead', 3],
      ['mixed', 4],
      ['teacher', 5],
      ['accountant', 6],
    ] as const) {
      h[key] = await loginAs(phone(n));
    }

    const cls = async (campusId: string, name: string) =>
      (await request(server).post('/api/classes').set(owner).send({ campusId, name }).expect(201)).body.id as string;
    const section = async (classId: string, name: string, classTeacherId?: string) =>
      (
        await request(server)
          .post(`/api/classes/${classId}/sections`)
          .set(owner)
          .send({ academicYearId: yearId, name, classTeacherId })
          .expect(201)
      ).body.id as string;
    const grade1 = await cls(main, 'Grade 1');
    const grade2 = await cls(main, 'Grade 2');
    const northGrade1 = await cls(north, 'Grade 1');
    sec.own = await section(grade1, 'A', uid.teacher);
    sec.taught = await section(grade1, 'B');
    sec.other = await section(grade2, 'A');
    sec.north = await section(northGrade1, 'A');
    const maths = (await request(server).post('/api/subjects').set(owner).send({ name: 'Maths' }).expect(201)).body.id;
    await request(server)
      .put(`/api/classes/sections/${sec.taught}/subjects`)
      .set(owner)
      .send({ subjects: [{ subjectId: maths, teacherId: uid.teacher }] })
      .expect(200);

    const admit = async (sectionId: string, firstName: string, n: number) =>
      (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send({
            sectionId,
            firstName,
            gender: 'MALE',
            bFormNo: `35202-000000${n}-1`,
            address: `House ${n}, Lahore`,
            medicalNotes: 'Asthma',
            guardians: [{ name: `Parent ${n}`, phone: `036${run.slice(-7)}${n}`, cnic: `35202-111111${n}-1`, relation: 'Father' }],
          })
          .expect(201)
      ).body.id as string;
    kid.own = await admit(sec.own, 'Ahmed', 1);
    kid.taught = await admit(sec.taught, 'Bilal', 2);
    kid.other = await admit(sec.other, 'Danish', 3);
    kid.north = await admit(sec.north, 'Usman', 4);

    const head = (await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition' }).expect(201)).body.id;
    for (const classId of [grade1, grade2, northGrade1]) {
      await request(server)
        .put('/api/fees/structures')
        .set(owner)
        .send({ classId, feeHeadId: head, academicYearId: yearId, amount: 5000 })
        .expect(200);
    }
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
  });

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  describe('HR staff profiles', () => {
    const profile = { designation: 'Teacher', basicSalary: 30000, bankName: 'HBL', bankAccount: '0123456789' };

    it('refuses a campus admin their own pay, the owner, and staff of other campuses', async () => {
      await request(server)
        .put(`/api/hr/staff/${uid.campusAdmin}`)
        .set(h.campusAdmin)
        .send({ ...profile, basicSalary: 999_999 })
        .expect(403);
      await request(server).put(`/api/hr/staff/${uid.owner}`).set(h.campusAdmin).send(profile).expect(404);
      await request(server).put(`/api/hr/staff/${uid.northTeacher}`).set(h.campusAdmin).send(profile).expect(404);
      // Admin grant at main only: teaching at North gives no admin reach there.
      await request(server).put(`/api/hr/staff/${uid.northTeacher}`).set(h.mixed).send(profile).expect(404);
      await request(server).put(`/api/hr/staff/${uid.teacher}`).set(h.campusAdmin).send(profile).expect(200);
      expect(await prisma.staffProfile.findUnique({ where: { userId: uid.campusAdmin } })).toBeNull();
      expect(await prisma.staffProfile.findUnique({ where: { userId: uid.owner } })).toBeNull();
    });

    it('lets only an owner change an owner, and school-wide admins anyone else', async () => {
      await request(server).put(`/api/hr/staff/${uid.owner}`).set(h.wideAdmin).send(profile).expect(403);
      await request(server).put(`/api/hr/staff/${uid.wideAdmin}`).set(h.wideAdmin).send(profile).expect(403);
      await request(server).put(`/api/hr/staff/${uid.northTeacher}`).set(h.wideAdmin).send(profile).expect(200);
      await request(server).put(`/api/hr/staff/${uid.wideAdmin}`).set(h.owner).send(profile).expect(200);
      await request(server).put(`/api/hr/staff/${uid.campusAdmin}`).set(h.owner).send(profile).expect(200);
      await request(server).put(`/api/hr/staff/${uid.owner}`).set(h.owner).send(profile).expect(200);
    });

    it('lists only the staff on a campus-limited user’s campuses', async () => {
      const mine = await request(server).get('/api/hr/staff').set(h.accountant).expect(200);
      expect(ids(mine.body)).toEqual(
        [uid.campusAdmin, uid.mixed, uid.teacher, uid.accountant].sort(),
      );
      const all = await request(server).get('/api/hr/staff').set(h.wideAdmin).expect(200);
      expect(all.body).toHaveLength(8);
    });

    it('keeps payroll runs school-wide and payslips to the campus', async () => {
      await request(server).post('/api/hr/payroll').set(h.accountant).send({ period }).expect(403);
      const run = await request(server).post('/api/hr/payroll').set(h.owner).send({ period }).expect(201);
      const scoped = await request(server).get(`/api/hr/payroll/${run.body.id}`).set(h.accountant).expect(200);
      expect(scoped.body.payslips.map((p: { userId: string }) => p.userId).sort()).toEqual(
        [uid.campusAdmin, uid.teacher].sort(),
      );
      expect(run.body.payslips).toHaveLength(5);
    });
  });

  describe('students', () => {
    it('refuses a campus head edits to another campus’s student', async () => {
      await request(server).get(`/api/students/${kid.own}`).set(h.northHead).expect(403);
      await request(server).patch(`/api/students/${kid.own}`).set(h.northHead).send({ address: 'Changed' }).expect(403);
      await request(server)
        .post('/api/students')
        .set(h.northHead)
        .send({ sectionId: sec.own, firstName: 'Intruder', gender: 'MALE', guardians: [{ name: 'Parent', phone: `037${run.slice(-7)}1`, relation: 'Father' }] })
        .expect(404);
      // Admin at main, teacher at North: no admin edits at North.
      await request(server).patch(`/api/students/${kid.north}`).set(h.mixed).send({ address: 'Changed' }).expect(403);
      await request(server).patch(`/api/students/${kid.north}`).set(h.northHead).send({ address: 'North road' }).expect(200);
      await request(server).patch(`/api/students/${kid.own}`).set(h.wideAdmin).send({ address: 'House 1, Lahore' }).expect(200);
    });

    it('shows a teacher only the students they teach, with private details only for their own class', async () => {
      const list = await request(server).get('/api/students').set(h.teacher).expect(200);
      expect(ids(list.body)).toEqual([kid.own, kid.taught].sort());
      const own = list.body.find((s: { id: string }) => s.id === kid.own);
      const taught = list.body.find((s: { id: string }) => s.id === kid.taught);
      expect(own).toMatchObject({ bFormNo: '3520200000011', address: 'House 1, Lahore', medicalNotes: 'Asthma' });
      expect(taught).toMatchObject({ bFormNo: null, address: null, medicalNotes: null });

      const detail = await request(server).get(`/api/students/${kid.taught}`).set(h.teacher).expect(200);
      expect(detail.body).toMatchObject({ bFormNo: null, address: null, medicalNotes: null });
      expect(detail.body.guardians[0].guardian).toMatchObject({ name: 'Parent 2', cnic: null });
      const mine = await request(server).get(`/api/students/${kid.own}`).set(h.teacher).expect(200);
      expect(mine.body.guardians[0].guardian.cnic).toBe('3520211111111');
      await request(server).get(`/api/students/${kid.other}`).set(h.teacher).expect(403);
    });

    it('still shows office staff every student on their campuses', async () => {
      const campus = await request(server).get('/api/students').set(h.campusAdmin).expect(200);
      expect(ids(campus.body)).toEqual([kid.own, kid.taught, kid.other].sort());
      expect(campus.body.every((s: { bFormNo: string | null }) => s.bFormNo)).toBe(true);
      const all = await request(server).get('/api/students').set(h.wideAdmin).expect(200);
      expect(all.body).toHaveLength(4);
      // Principal at main, teacher at North (no North sections): main only.
      const mixed = await request(server).get('/api/students').set(h.mixed).expect(200);
      expect(ids(mixed.body)).toEqual([kid.own, kid.taught, kid.other].sort());
    });
  });

  describe('fees and reports', () => {
    it('bills, lists and chases only the campus’s students', async () => {
      const run1 = await request(server).post('/api/fees/invoices/generate').set(h.northHead).send({ period }).expect(201);
      expect(run1.body.created).toBe(1);
      const run2 = await request(server).post('/api/fees/invoices/generate').set(h.wideAdmin).send({ period }).expect(201);
      expect(run2.body.created).toBe(3);

      const northInvoices = await request(server).get('/api/fees/invoices').set(h.northHead).expect(200);
      expect(northInvoices.body.map((i: { studentId: string }) => i.studentId)).toEqual([kid.north]);
      const mainDefaulters = await request(server).get('/api/fees/defaulters').set(h.accountant).expect(200);
      expect(mainDefaulters.body.map((d: { student: { id: string } }) => d.student.id).sort()).toEqual(
        [kid.own, kid.taught, kid.other].sort(),
      );
      const all = await request(server).get('/api/fees/invoices').set(h.owner).expect(200);
      expect(all.body).toHaveLength(4);

      const mainInvoice = all.body.find((i: { studentId: string }) => i.studentId === kid.own);
      await request(server).get(`/api/fees/invoices/${mainInvoice.id}`).set(h.northHead).expect(404);
      await request(server)
        .post(`/api/fees/invoices/${mainInvoice.id}/payments`)
        .set(h.northHead)
        .send({ amount: 100, method: 'CASH' })
        .expect(404);
    });

    it('reports on the campus only', async () => {
      const north = await request(server).get('/api/reports/outstanding').set(h.northHead).expect(200);
      expect(north.body.students.map((s: { id: string }) => s.id)).toEqual([kid.north]);
      expect(north.body.total).toBe(5000);
      const all = await request(server).get('/api/reports/outstanding').set(h.wideAdmin).expect(200);
      expect(all.body.total).toBe(20000);
    });

    it('keeps each campus’s books apart', async () => {
      const category = (
        await request(server).post('/api/accounts/categories').set(h.owner).send({ name: 'Repairs', kind: 'EXPENSE' }).expect(201)
      ).body.id;
      const date = localToday();
      const mine = await request(server).post('/api/accounts/entries').set(h.accountant).send({ categoryId: category, amount: 700, date }).expect(201);
      expect(mine.body.campusId).toBe(main);
      await request(server)
        .post('/api/accounts/entries')
        .set(h.accountant)
        .send({ categoryId: category, amount: 1, date, campusId: north })
        .expect(403);
      await request(server).post('/api/accounts/entries').set(h.owner).send({ categoryId: category, amount: 9000, date }).expect(201);

      const scoped = await request(server).get('/api/accounts/entries').set(h.accountant).expect(200);
      expect(scoped.body.map((e: { amount: number }) => e.amount)).toEqual([700]);
      const all = await request(server).get('/api/accounts/entries').set(h.owner).expect(200);
      expect(all.body).toHaveLength(2);
    });
  });

  describe('school-wide settings', () => {
    it('lets only school-wide admins change the role matrix', async () => {
      await request(server).put('/api/roles/builtin/TEACHER').set(h.northHead).send({ permissions: { fees: 'manage' } }).expect(403);
      await request(server).post('/api/roles').set(h.campusAdmin).send({ name: 'Clerk', baseRole: 'STAFF' }).expect(403);
      await request(server).put('/api/roles/builtin/TEACHER').set(h.wideAdmin).send({ permissions: {}, reset: true }).expect(200);
    });

    it('keeps the audit log to school-wide admins', async () => {
      await request(server).get('/api/audit').set(h.campusAdmin).expect(403);
      await request(server).get('/api/audit/facets').set(h.northHead).expect(403);
      await request(server).get('/api/audit').set(h.wideAdmin).expect(200);
    });

    it('lets a campus head address only their own campus', async () => {
      const notice = { title: 'Holiday', body: 'School is closed on Friday', sendWhatsApp: false };
      await request(server).post('/api/announcements').set(h.northHead).send({ ...notice, audience: 'SCHOOL' }).expect(403);
      await request(server).post('/api/announcements').set(h.northHead).send({ ...notice, audience: 'CAMPUS', targetId: main }).expect(403);
      await request(server).post('/api/announcements').set(h.northHead).send({ ...notice, audience: 'SECTION', targetId: sec.own }).expect(403);
      await request(server).post('/api/announcements').set(h.northHead).send({ ...notice, audience: 'CAMPUS', targetId: north }).expect(201);
      await request(server).post('/api/announcements').set(h.wideAdmin).send({ ...notice, audience: 'SCHOOL' }).expect(201);
    });

    it('lets a campus head add routes and books only for their campus', async () => {
      const route = { name: `Route ${run}`, monthlyFee: 3000 };
      await request(server).post('/api/transport/routes').set(h.northHead).send(route).expect(403);
      await request(server).post('/api/transport/routes').set(h.northHead).send({ ...route, campusId: main }).expect(403);
      await request(server).post('/api/transport/routes').set(h.northHead).send({ ...route, campusId: north }).expect(201);
      await request(server).post('/api/transport/routes').set(h.wideAdmin).send({ ...route, name: `Wide ${run}` }).expect(201);

      const book = { title: 'Gulliver', copies: 1 };
      await request(server).post('/api/library/books').set(h.northHead).send(book).expect(403);
      await request(server).post('/api/library/books').set(h.northHead).send({ ...book, campusId: main }).expect(403);
      await request(server).post('/api/library/books').set(h.northHead).send({ ...book, campusId: north }).expect(201);
      await request(server).post('/api/library/books').set(h.wideAdmin).send(book).expect(201);
    });

    it('keeps admissions to the campus', async () => {
      const enquiry = (campusId: string, classId: string) => ({
        campusId,
        classId,
        childName: 'New Child',
        gender: 'FEMALE',
        guardianName: 'Parent',
        guardianPhone: `038${run.slice(-7)}1`,
      });
      const classes = await prisma.class.findMany({ where: { schoolId }, select: { id: true, campusId: true } });
      const mainClass = classes.find((c) => c.campusId === main)!.id;
      const northClass = classes.find((c) => c.campusId === north)!.id;
      await request(server).post('/api/applications').set(h.northHead).send(enquiry(main, mainClass)).expect(403);
      await request(server).post('/api/applications').set(h.northHead).send(enquiry(north, northClass)).expect(201);
      const mainApp = await request(server).post('/api/applications').set(h.owner).send(enquiry(main, mainClass)).expect(201);
      const seen = await request(server).get('/api/applications').set(h.northHead).expect(200);
      expect(seen.body.map((a: { campusId: string }) => a.campusId)).toEqual([north]);
      await request(server).patch(`/api/applications/${mainApp.body.id}`).set(h.northHead).send({ notes: 'x' }).expect(404);
      await request(server)
        .post(`/api/applications/${mainApp.body.id}/admit`)
        .set(h.northHead)
        .send({ sectionId: sec.north })
        .expect(404);
    });

    it('takes no public enquiries for a suspended school', async () => {
      const classId = (await prisma.class.findFirstOrThrow({ where: { campusId: main } })).id;
      const enquiry = {
        campusId: main,
        classId,
        childName: 'Web Child',
        gender: 'MALE',
        guardianName: 'Parent',
        guardianPhone: `039${run.slice(-7)}1`,
      };
      await request(server).post(`/api/public/${schoolSlug}/enquiries`).send(enquiry).expect(201);
      await prisma.subscription.update({ where: { schoolId }, data: { status: 'SUSPENDED' } });
      app.get(SubscriptionService).forget(schoolId);
      try {
        await request(server).get(`/api/public/${schoolSlug}/admission-options`).expect(404);
        await request(server).post(`/api/public/${schoolSlug}/enquiries`).send(enquiry).expect(404);
      } finally {
        await prisma.subscription.update({ where: { schoolId }, data: { status: 'ACTIVE' } });
        app.get(SubscriptionService).forget(schoolId);
      }
    });
  });

  describe('mixed grants', () => {
    it('gives admin reach only where the admin grant is', async () => {
      const users = await request(server).get('/api/users').set(h.mixed).expect(200);
      expect(users.body.map((u: { id: string }) => u.id)).not.toContain(uid.northTeacher);
      await request(server).get(`/api/users/${uid.northTeacher}`).set(h.mixed).expect(404);
      const staff = await request(server).get('/api/hr/staff').set(h.mixed).expect(200);
      expect(staff.body.map((u: { id: string }) => u.id)).not.toContain(uid.northTeacher);
      await request(server)
        .post('/api/announcements')
        .set(h.mixed)
        .send({ title: 'Hello', body: 'From the main campus', audience: 'CAMPUS', targetId: north, sendWhatsApp: false })
        .expect(403);
      await request(server).put('/api/roles/builtin/STAFF').set(h.mixed).send({ permissions: {}, reset: true }).expect(403);
    });
  });

  describe('plan limits', () => {
    it('counts bringing back a student who left against the plan', async () => {
      await request(server).patch(`/api/students/${kid.other}`).set(h.owner).send({ status: 'LEFT' }).expect(200);
      const plan = await prisma.plan.create({
        data: { code: `full-${run}`, name: 'Full', pricePerStudent: 1, minimumMonthly: 1, maxStudents: 3, features: [], isPublic: false },
      });
      const current = await prisma.subscription.findUniqueOrThrow({ where: { schoolId } });
      await prisma.subscription.update({ where: { schoolId }, data: { planId: plan.id } });
      app.get(SubscriptionService).forget(schoolId);
      try {
        const res = await request(server).patch(`/api/students/${kid.other}`).set(h.owner).send({ status: 'ACTIVE' }).expect(409);
        expect(res.body.message).toMatch(/allows 3 students/);
      } finally {
        await prisma.subscription.update({ where: { schoolId }, data: { planId: current.planId } });
        await prisma.plan.delete({ where: { id: plan.id } });
        app.get(SubscriptionService).forget(schoolId);
      }
      await request(server).patch(`/api/students/${kid.other}`).set(h.owner).send({ status: 'ACTIVE' }).expect(200);
    });
  });
});
