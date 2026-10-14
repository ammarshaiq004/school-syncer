import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { localToday } from '../src/common/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { normaliseContacts } from '../src/students/contact-cleanup.js';
import { deleteSchools } from './cleanup.js';
import { keepIssuedPassword } from './session.js';

type Headers = Record<string, string>;

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

/** The path and query of a link, so supertest can call it on the test server. */
const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

// SCHOOL-139 (editing setup and student records) and SCHOOL-123 (phones,
// CNICs, B-Forms, guardian name clashes and duplicates).
describe('Setup edits and admissions data (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const storageDir = mkdtempSync(join(tmpdir(), 'schoolsyncer-photos-'));
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  /** A distinct mobile per (prefix digit, n), as 03XXXXXXXXX. */
  const mobile = (p: number, n: number) => `03${p}${run.slice(-7)}${n}`;
  const year = localToday().slice(0, 4);

  let schoolSlug: string;
  let schoolId: string;
  let owner: Headers;
  let campusAdmin: Headers;
  let campusAccountant: Headers;
  let main: string;
  let north: string;
  let yearId: string;
  let nextYearId: string;
  let grade1: string;
  let northGrade1: string;
  let secA: string;
  let secB: string;
  let secNorth: string;
  let teacherId: string;

  async function loginAs(login: string, password = 'password123') {
    const res = await request(server).post('/api/auth/login').send({ schoolSlug, login, password }).expect(200);
    await keepIssuedPassword(app, res.body);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  const student = (sectionId: string, firstName: string, guardian: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    sectionId,
    firstName,
    gender: 'MALE',
    guardians: [{ relation: 'Father', ...guardian }],
    ...extra,
  });

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = storageDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: `Edits ${run}`, ownerName: 'Owner', email: `edits+${run}@test.pk`, password: 'password123' })
      .expect(201);
    schoolSlug = reg.body.schoolSlug;
    schoolId = reg.body.user.schoolId;
    owner = { Authorization: `Bearer ${reg.body.accessToken}` };

    main = (await request(server).get('/api/campuses').set(owner)).body[0].id;
    north = (await request(server).post('/api/campuses').set(owner).send({ name: `North ${run}` }).expect(201)).body.id;
    yearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: year, startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, isCurrent: true })
        .expect(201)
    ).body.id;
    const next = String(Number(year) + 1);
    nextYearId = (
      await request(server)
        .post('/api/academic-years')
        .set(owner)
        .send({ name: next, startsOn: `${next}-01-01`, endsOn: `${next}-12-31` })
        .expect(201)
    ).body.id;

    const user = async (n: number, roles: { role: string; campusId?: string }[]) =>
      (
        await request(server)
          .post('/api/users')
          .set(owner)
          .send({ name: `User ${n}`, phone: mobile(5, n), password: 'password123', roles })
          .expect(201)
      ).body.id as string;
    await user(1, [{ role: 'ADMIN', campusId: main }]);
    await user(2, [{ role: 'ACCOUNTANT', campusId: main }]);
    teacherId = await user(3, [{ role: 'TEACHER', campusId: main }]);
    campusAdmin = await loginAs(mobile(5, 1));
    campusAccountant = await loginAs(mobile(5, 2));

    grade1 = (await request(server).post('/api/classes').set(owner).send({ campusId: main, name: 'Grade 1' }).expect(201)).body.id;
    northGrade1 = (await request(server).post('/api/classes').set(owner).send({ campusId: north, name: 'Grade 1' }).expect(201)).body.id;
    const section = async (classId: string, name: string) =>
      (await request(server).post(`/api/classes/${classId}/sections`).set(owner).send({ academicYearId: yearId, name }).expect(201)).body
        .id as string;
    secA = await section(grade1, 'A');
    secB = await section(grade1, 'B');
    secNorth = await section(northGrade1, 'A');
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug: schoolSlug });
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
  });

  describe('classes and sections', () => {
    it('renames a class and keeps campus admins to their campuses', async () => {
      const res = await request(server).patch(`/api/classes/${grade1}`).set(owner).send({ name: 'Grade One', sortOrder: 1 }).expect(200);
      expect(res.body).toMatchObject({ name: 'Grade One', sortOrder: 1 });
      await request(server).patch(`/api/classes/${grade1}`).set(campusAdmin).send({ name: 'Grade 1' }).expect(200);
      await request(server).patch(`/api/classes/${northGrade1}`).set(campusAdmin).send({ name: 'Mine now' }).expect(403);
      await request(server).delete(`/api/classes/${northGrade1}`).set(campusAdmin).expect(403);
      await request(server).post('/api/classes').set(campusAdmin).send({ campusId: north, name: 'Grade 9' }).expect(403);
      await request(server).patch(`/api/classes/${grade1}`).set(owner).send({}).expect(400);
    });

    it('deletes an unused class but refuses one with sections', async () => {
      const refused = await request(server).delete(`/api/classes/${grade1}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/Grade 1 is in use \(2 sections\)/);
      const spare = (await request(server).post('/api/classes').set(owner).send({ campusId: main, name: `Spare ${run}` }).expect(201)).body.id;
      await request(server).delete(`/api/classes/${spare}`).set(owner).expect(200);
      expect(await prisma.class.count({ where: { id: spare } })).toBe(0);
    });

    it('edits a section, sets and clears its class teacher, and refuses fewer seats than students', async () => {
      const set = await request(server)
        .patch(`/api/classes/sections/${secB}`)
        .set(owner)
        .send({ name: 'Blue', capacity: 30, classTeacherId: teacherId })
        .expect(200);
      expect(set.body).toMatchObject({ name: 'Blue', capacity: 30, classTeacher: { id: teacherId } });
      const cleared = await request(server).patch(`/api/classes/sections/${secB}`).set(owner).send({ name: 'B', classTeacherId: null }).expect(200);
      expect(cleared.body).toMatchObject({ name: 'B', classTeacherId: null });
      await request(server).patch(`/api/classes/sections/${secNorth}`).set(campusAdmin).send({ capacity: 10 }).expect(403);

      const kid = (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send(student(secB, 'Seated', { name: 'Seat Parent', phone: mobile(6, 1) }))
          .expect(201)
      ).body.id;
      await request(server).post('/api/students').set(owner).send(student(secB, 'Seated Two', { name: 'Seat Parent 2', phone: mobile(6, 2) })).expect(201);
      const few = await request(server).patch(`/api/classes/sections/${secB}`).set(owner).send({ capacity: 1 }).expect(400);
      expect(few.body.message).toMatch(/2 students/);
      expect(kid).toBeTruthy();
    });

    it('deletes an unused section but refuses one with students', async () => {
      const refused = await request(server).delete(`/api/classes/sections/${secB}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/2 students/);
      const spare = (
        await request(server).post(`/api/classes/${grade1}/sections`).set(owner).send({ academicYearId: yearId, name: 'Z' }).expect(201)
      ).body.id;
      await request(server).delete(`/api/classes/sections/${spare}`).set(campusAdmin).expect(200);
      await request(server).delete(`/api/classes/sections/${secNorth}`).set(campusAdmin).expect(403);
    });
  });

  describe('subjects, academic years and fee heads', () => {
    it('edits and deletes subjects school-wide only, refusing one a section studies', async () => {
      const maths = (await request(server).post('/api/subjects').set(owner).send({ name: 'Maths' }).expect(201)).body.id;
      const art = (await request(server).post('/api/subjects').set(owner).send({ name: 'Art' }).expect(201)).body.id;
      await request(server)
        .put(`/api/classes/sections/${secA}/subjects`)
        .set(owner)
        .send({ subjects: [{ subjectId: maths }] })
        .expect(200);
      const renamed = await request(server).patch(`/api/subjects/${maths}`).set(owner).send({ name: 'Mathematics', code: 'MATH' }).expect(200);
      expect(renamed.body).toMatchObject({ name: 'Mathematics', code: 'MATH' });
      await request(server).patch(`/api/subjects/${maths}`).set(campusAdmin).send({ name: 'Sums' }).expect(403);
      const refused = await request(server).delete(`/api/subjects/${maths}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/1 section/);
      await request(server).delete(`/api/subjects/${art}`).set(campusAdmin).expect(403);
      await request(server).delete(`/api/subjects/${art}`).set(owner).expect(200);
    });

    it('edits academic years, switches the current one, and refuses deleting one in use or current', async () => {
      await request(server).patch(`/api/academic-years/${nextYearId}`).set(owner).send({ endsOn: '2000-01-01' }).expect(400);
      await request(server).patch(`/api/academic-years/${nextYearId}`).set(campusAdmin).send({ name: 'Mine' }).expect(403);
      const renamed = await request(server).patch(`/api/academic-years/${nextYearId}`).set(owner).send({ name: `Next ${run}`.slice(0, 20) }).expect(200);
      expect(renamed.body.isCurrent).toBe(false);

      const inUse = await request(server).delete(`/api/academic-years/${yearId}`).set(owner).expect(409);
      expect(inUse.body.message).toMatch(/current year/);
      await request(server).patch(`/api/academic-years/${nextYearId}`).set(owner).send({ isCurrent: true }).expect(200);
      const refused = await request(server).delete(`/api/academic-years/${yearId}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/sections/);
      await request(server).patch(`/api/academic-years/${yearId}`).set(owner).send({ isCurrent: true }).expect(200);
      const years = await prisma.academicYear.findMany({ where: { schoolId }, select: { id: true, isCurrent: true } });
      expect(years.filter((y) => y.isCurrent).map((y) => y.id)).toEqual([yearId]);

      const spare = (
        await request(server)
          .post('/api/academic-years')
          .set(owner)
          .send({ name: `Old ${run}`.slice(0, 20), startsOn: '2001-01-01', endsOn: '2001-12-31' })
          .expect(201)
      ).body.id;
      await request(server).delete(`/api/academic-years/${spare}`).set(owner).expect(200);
    });

    it('edits fee heads and refuses deleting one a class is charged', async () => {
      const tuition = (await request(server).post('/api/fees/heads').set(owner).send({ name: 'Tuition' }).expect(201)).body.id;
      const lab = (await request(server).post('/api/fees/heads').set(owner).send({ name: 'Lab' }).expect(201)).body.id;
      await request(server)
        .put('/api/fees/structures')
        .set(owner)
        .send({ classId: grade1, feeHeadId: tuition, academicYearId: yearId, amount: 4000 })
        .expect(200);
      const edited = await request(server).patch(`/api/fees/heads/${tuition}`).set(owner).send({ name: 'Tuition fee', frequency: 'MONTHLY' }).expect(200);
      expect(edited.body.name).toBe('Tuition fee');
      await request(server).patch(`/api/fees/heads/${tuition}`).set(campusAccountant).send({ name: 'Mine' }).expect(403);
      const refused = await request(server).delete(`/api/fees/heads/${tuition}`).set(owner).expect(409);
      expect(refused.body.message).toMatch(/1 class amount/);
      await request(server).delete(`/api/fees/heads/${lab}`).set(campusAccountant).expect(403);
      // A head the sibling discount uses stays until the fee rule drops it.
      await request(server).put('/api/fees/policy').set(owner).send({ siblingFeeHeadIds: [lab] }).expect(200);
      const inRule = await request(server).delete(`/api/fees/heads/${lab}`).set(owner).expect(409);
      expect(inRule.body.message).toMatch(/1 fee rule/);
      await request(server).put('/api/fees/policy').set(owner).send({ siblingFeeHeadIds: [] }).expect(200);
      await request(server).delete(`/api/fees/heads/${lab}`).set(owner).expect(200);
      await request(server).delete(`/api/fees/heads/${lab}`).set(owner).expect(404);
    });
  });

  describe('phones, CNICs and B-Forms', () => {
    it('stores every spelling in one canonical form and refuses what is not a number', async () => {
      const phone = mobile(7, 1);
      const typed = `+92 ${phone.slice(1, 4)}-${phone.slice(4)}`;
      const res = await request(server)
        .post('/api/students')
        .set(owner)
        .send(student(secA, 'Canon', { name: 'Canon Parent', phone: typed, cnic: '35202 1234567 1' }, { bFormNo: '3520212345679' }))
        .expect(201);
      const saved = await prisma.student.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { guardians: { include: { guardian: true } } },
      });
      expect(saved.bFormNo).toBe('3520212345679');
      expect(saved.guardians[0].guardian).toMatchObject({ phone, cnic: '3520212345671' });

      for (const bad of [
        { guardian: { name: 'X Parent', phone: '042-35761234' }, field: 'phone' },
        { guardian: { name: 'X Parent', phone: mobile(7, 2), cnic: '35202-12345-1' }, field: 'cnic' },
      ]) {
        const refused = await request(server).post('/api/students').set(owner).send(student(secA, 'Bad', bad.guardian)).expect(400);
        expect(JSON.stringify(refused.body)).toMatch(bad.field === 'phone' ? /mobile number/ : /13 digits/);
      }
      await request(server)
        .post('/api/students')
        .set(owner)
        .send(student(secA, 'Bad', { name: 'X Parent', phone: mobile(7, 3) }, { bFormNo: 'B-123' }))
        .expect(400);
      await request(server).patch(`/api/students/${res.body.id}`).set(owner).send({ bFormNo: '35202-1234567-9' }).expect(200);

      // Staff phones and CNICs too.
      const staff = await request(server)
        .post('/api/users')
        .set(owner)
        .send({ name: 'Staff Canon', phone: `0092${mobile(5, 8).slice(1)}`, password: 'password123', roles: [{ role: 'TEACHER' }] })
        .expect(201);
      expect(staff.body.phone).toBe(mobile(5, 8));
      const profile = await request(server)
        .put(`/api/hr/staff/${staff.body.id}`)
        .set(owner)
        .send({ designation: 'Teacher', basicSalary: 1000, cnic: '35202 7654321 1' })
        .expect(200);
      expect(profile.body.cnic).toBe('3520276543211');
    });

    it('signs a parent in with their phone typed any common way', async () => {
      const phone = mobile(7, 4);
      const kid = (await request(server).post('/api/students').set(owner).send(student(secA, 'Login', { name: 'Login Parent', phone })).expect(201))
        .body.id;
      const link = await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: kid } });
      await request(server).post(`/api/students/${kid}/guardians/${link.guardianId}/invite`).set(owner).expect(201);
      const parent = await prisma.user.findFirstOrThrow({ where: { schoolId, phone } });
      await prisma.user.update({ where: { id: parent.id }, data: { passwordHash: await bcrypt.hash('parentpass1', 4) } });
      const local = phone.slice(1);
      for (const login of [phone, `+92 ${local.slice(0, 3)} ${local.slice(3)}`, `92${local}`, `0092-${local}`, local, `${phone.slice(0, 4)}-${phone.slice(4)}`]) {
        const res = await request(server).post('/api/auth/login').send({ schoolSlug, login, password: 'parentpass1' }).expect(200);
        expect(res.body.user.sub).toBe(parent.id);
      }
      await request(server).post('/api/auth/login').send({ schoolSlug, login: phone, password: 'wrong-pass1' }).expect(401);
    });
  });

  describe('guardian name clashes and duplicates', () => {
    it('asks before linking a phone saved under another name, then links the sibling', async () => {
      const phone = mobile(8, 1);
      const first = (
        await request(server).post('/api/students').set(owner).send(student(secA, 'Elder', { name: 'Imran Khan', phone })).expect(201)
      ).body.id;
      // Same name, other spacing and case: no question asked.
      await request(server).post('/api/students').set(owner).send(student(secA, 'Middle', { name: 'imran  KHAN', phone })).expect(201);

      const asked = await request(server)
        .post('/api/students')
        .set(owner)
        .send(student(secA, 'Younger', { name: 'Ayesha Bibi', phone, relation: 'Mother' }))
        .expect(409);
      expect(asked.body).toMatchObject({
        code: 'NEEDS_CONFIRMATION',
        warnings: [{ kind: 'guardian_name', phone, givenName: 'Ayesha Bibi', existingName: 'Imran Khan' }],
      });
      expect(asked.body.warnings[0].children).toEqual(expect.arrayContaining(['Elder', 'Middle']));
      expect(await prisma.student.count({ where: { schoolId, firstName: 'Younger' } })).toBe(0);

      const linked = await request(server)
        .post('/api/students')
        .set(owner)
        .send(student(secA, 'Younger', { name: 'Ayesha Bibi', phone, relation: 'Mother' }, { confirmed: true }))
        .expect(201);
      const guardians = await prisma.guardian.findMany({ where: { schoolId, phone }, include: { students: true } });
      expect(guardians).toHaveLength(1);
      expect(guardians[0].name).toBe('Imran Khan');
      expect(guardians[0].students.map((s) => s.studentId)).toEqual(expect.arrayContaining([first, linked.body.id]));
    });

    it('warns about a likely duplicate student (same name, date of birth and guardian phone)', async () => {
      const phone = mobile(8, 2);
      const body = student(secA, 'Sana', { name: 'Dup Parent', phone }, { lastName: 'Iqbal', dateOfBirth: '2018-04-05' });
      const original = (await request(server).post('/api/students').set(owner).send(body).expect(201)).body;
      const asked = await request(server)
        .post('/api/students')
        .set(owner)
        .send({ ...body, lastName: 'iqbal' })
        .expect(409);
      expect(asked.body.warnings).toEqual([
        expect.objectContaining({ kind: 'duplicate', studentId: original.id, admissionNo: original.admissionNo }),
      ]);
      // Another date of birth is a different child (twins have the same one, so it can be confirmed).
      await request(server).post('/api/students').set(owner).send({ ...body, dateOfBirth: '2019-04-05' }).expect(201);
      await request(server).post('/api/students').set(owner).send({ ...body, confirmed: true }).expect(201);
    });

    it('lists the same warnings on import and imports only once they are confirmed', async () => {
      const row = (over: Record<string, string>) => ({
        firstName: 'Import',
        gender: 'M',
        class: 'Grade 1',
        section: 'A',
        // Both campuses have a Grade 1 A.
        campus: 'Main campus',
        guardianName: 'Row Parent',
        guardianPhone: mobile(8, 5),
        ...over,
      });
      const rows = [
        // Same as the student above: name, date of birth and guardian phone.
        row({ firstName: 'Sana', lastName: 'Iqbal', dateOfBirth: '05/04/2018', guardianName: 'Dup Parent', guardianPhone: mobile(8, 2) }),
        // A phone saved for Imran Khan, under another name.
        row({ firstName: 'Kid', guardianName: 'Someone Else', guardianPhone: `+92${mobile(8, 1).slice(1)}`, guardianCnic: '35202-1111111-1', bFormNo: '35202 2222222 2' }),
        row({ firstName: 'Clean' }),
      ];
      const preview = await request(server).post('/api/students/import').set(owner).send({ rows }).expect(201);
      expect(preview.body).toMatchObject({ valid: 3, invalid: 0, warned: 2, imported: 0 });
      expect(preview.body.rows[0].warnings[0]).toMatch(/already on file/);
      expect(preview.body.rows[1].warnings[0]).toMatch(/already saved for Imran Khan/);
      expect(preview.body.rows[2].warnings).toEqual([]);

      const held = await request(server).post('/api/students/import').set(owner).send({ rows, commit: true }).expect(201);
      expect(held.body).toMatchObject({ imported: 0, needsConfirmation: true });
      const done = await request(server).post('/api/students/import').set(owner).send({ rows, commit: true, confirmWarnings: true }).expect(201);
      expect(done.body.imported).toBe(3);
      const kid = await prisma.student.findFirstOrThrow({
        where: { schoolId, firstName: 'Kid' },
        include: { guardians: { include: { guardian: true } } },
      });
      expect(kid.bFormNo).toBe('3520222222222');
      expect(kid.guardians[0].guardian).toMatchObject({ name: 'Imran Khan', phone: mobile(8, 1), cnic: '3520211111111' });

      const badCnic = await request(server)
        .post('/api/students/import')
        .set(owner)
        .send({ rows: [row({ firstName: 'Bad', guardianCnic: '123', guardianPhone: mobile(8, 6) })] })
        .expect(201);
      expect(badCnic.body.rows[0].errors).toEqual([expect.stringMatching(/Guardian CNIC "123" should be 13 digits/)]);
    });

    it('normalises enquiry phones and asks before admitting into a name clash', async () => {
      const app1 = await request(server)
        .post('/api/applications')
        .set(owner)
        .send({ campusId: main, classId: grade1, childName: 'Applicant Child', gender: 'FEMALE', guardianName: 'Not Imran', guardianPhone: `0${mobile(8, 1).slice(1, 4)} ${mobile(8, 1).slice(4)}` })
        .expect(201);
      expect(app1.body.guardianPhone).toBe(mobile(8, 1));
      await request(server)
        .post('/api/applications')
        .set(owner)
        .send({ campusId: main, classId: grade1, childName: 'Bad Phone', gender: 'FEMALE', guardianName: 'Some One', guardianPhone: '1234567890' })
        .expect(400);
      const asked = await request(server).post(`/api/applications/${app1.body.id}/admit`).set(owner).send({ sectionId: secA }).expect(409);
      expect(asked.body.code).toBe('NEEDS_CONFIRMATION');
      await request(server).post(`/api/applications/${app1.body.id}/admit`).set(owner).send({ sectionId: secA, confirmed: true }).expect(201);
    });
  });

  describe('guardians', () => {
    let kid: string;
    let guardianId: string;

    beforeAll(async () => {
      kid = (
        await request(server)
          .post('/api/students')
          .set(owner)
          .send(student(secA, 'Guarded', { name: 'First Parent', phone: mobile(9, 1) }))
          .expect(201)
      ).body.id;
      guardianId = (await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: kid } })).guardianId;
    });

    it('edits a guardian, normalising the phone and CNIC, and moves their login phone too', async () => {
      await request(server).post(`/api/students/${kid}/guardians/${guardianId}/invite`).set(owner).expect(201);
      const res = await request(server)
        .patch(`/api/students/${kid}/guardians/${guardianId}`)
        .set(campusAdmin)
        .send({ name: 'First Parent Renamed', phone: `+92 ${mobile(9, 2).slice(1)}`, cnic: '35202-3333333-3', occupation: 'Driver', relation: 'Uncle' })
        .expect(200);
      expect(res.body).toMatchObject({
        relation: 'Uncle',
        guardian: { name: 'First Parent Renamed', phone: mobile(9, 2), cnic: '3520233333333', occupation: 'Driver' },
      });
      const login = await prisma.user.findUniqueOrThrow({ where: { id: res.body.guardian.userId } });
      expect(login).toMatchObject({ phone: mobile(9, 2), name: 'First Parent Renamed' });

      // Another guardian's phone is refused; so are bad values and other campuses.
      await request(server).patch(`/api/students/${kid}/guardians/${guardianId}`).set(owner).send({ phone: mobile(8, 1) }).expect(409);
      await request(server).patch(`/api/students/${kid}/guardians/${guardianId}`).set(owner).send({ cnic: '12' }).expect(400);
      const northKid = (
        await request(server).post('/api/students').set(owner).send(student(secNorth, 'Northern', { name: 'North Parent', phone: mobile(9, 9) })).expect(201)
      ).body.id;
      const northGuardian = (await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: northKid } })).guardianId;
      await request(server).patch(`/api/students/${northKid}/guardians/${northGuardian}`).set(campusAdmin).send({ name: 'Nope' }).expect(403);
      await request(server).patch(`/api/students/${kid}/guardians/${northGuardian}`).set(owner).send({ name: 'Nope' }).expect(404);
    });

    it('adds and removes a second guardian, keeping one primary', async () => {
      const added = await request(server)
        .post(`/api/students/${kid}/guardians`)
        .set(owner)
        .send({ name: 'Second Parent', phone: mobile(9, 3), relation: 'Mother', isPrimary: true })
        .expect(201);
      const second = added.body.guardianId;
      let links = await prisma.studentGuardian.findMany({ where: { studentId: kid } });
      expect(links).toHaveLength(2);
      expect(links.find((l) => l.isPrimary)?.guardianId).toBe(second);
      await request(server).post(`/api/students/${kid}/guardians`).set(owner).send({ name: 'Again', phone: mobile(9, 3), relation: 'Mother' }).expect(409);

      // Removing the primary hands it to the other guardian; the last one stays.
      await request(server).delete(`/api/students/${kid}/guardians/${second}`).set(owner).expect(200);
      links = await prisma.studentGuardian.findMany({ where: { studentId: kid } });
      expect(links).toEqual([expect.objectContaining({ guardianId, isPrimary: true })]);
      expect(await prisma.guardian.count({ where: { id: second } })).toBe(0);
      await request(server).delete(`/api/students/${kid}/guardians/${guardianId}`).set(owner).expect(400);

      // A phone saved under another name asks first, as at admission.
      const asked = await request(server)
        .post(`/api/students/${kid}/guardians`)
        .set(owner)
        .send({ name: 'Different Name', phone: mobile(8, 1), relation: 'Uncle' })
        .expect(409);
      expect(asked.body.warnings[0].kind).toBe('guardian_name');
      await request(server)
        .post(`/api/students/${kid}/guardians`)
        .set(owner)
        .send({ name: 'Different Name', phone: mobile(8, 1), relation: 'Uncle', confirmed: true })
        .expect(201);
    });
  });

  describe('moving a student between sections', () => {
    it('moves within the year, keeps attendance and records the history', async () => {
      const kid = (
        await request(server).post('/api/students').set(owner).send(student(secA, 'Mover', { name: 'Move Parent', phone: mobile(4, 1) })).expect(201)
      ).body.id;
      const session = await prisma.attendanceSession.create({
        data: { schoolId, sectionId: secA, date: new Date(`${year}-02-02`), records: { create: { studentId: kid, status: 'PRESENT' } } },
      });

      await request(server).post(`/api/students/${kid}/move`).set(owner).send({ sectionId: secA }).expect(400);
      const nextSection = (
        await request(server).post(`/api/classes/${grade1}/sections`).set(owner).send({ academicYearId: nextYearId, name: 'A' }).expect(201)
      ).body.id;
      await request(server).post(`/api/students/${kid}/move`).set(owner).send({ sectionId: nextSection }).expect(400);
      await request(server).post(`/api/students/${kid}/move`).set(campusAdmin).send({ sectionId: secNorth }).expect(404);

      const moved = await request(server).post(`/api/students/${kid}/move`).set(campusAdmin).send({ sectionId: secB, reason: 'Wrong section' }).expect(201);
      expect(moved.body).toMatchObject({ sectionId: secB, section: { name: 'B' } });
      const enrollments = await prisma.enrollment.findMany({ where: { studentId: kid } });
      expect(enrollments).toEqual([expect.objectContaining({ sectionId: secB, academicYearId: yearId, status: 'ACTIVE' })]);
      expect(await prisma.attendanceRecord.count({ where: { sessionId: session.id, studentId: kid } })).toBe(1);

      // The owner may move them to another campus; the student's campus follows.
      await request(server).post(`/api/students/${kid}/move`).set(owner).send({ sectionId: secNorth }).expect(201);
      expect((await prisma.student.findUniqueOrThrow({ where: { id: kid } })).campusId).toBe(north);
      await request(server).post(`/api/students/${kid}/move`).set(campusAdmin).send({ sectionId: secA }).expect(403);

      const profile = await request(server).get(`/api/students/${kid}`).set(owner).expect(200);
      expect(profile.body.attendanceSummary).toEqual({ PRESENT: 1 });
      expect(profile.body.moves).toEqual([
        expect.objectContaining({ from: 'Grade 1 B', to: 'Grade 1 A', by: 'Owner' }),
        expect.objectContaining({ from: 'Grade 1 A', to: 'Grade 1 B', reason: 'Wrong section', by: 'User 1' }),
      ]);
    });
  });

  describe('student photos', () => {
    it('uploads a checked photo, serves it from a stable link and shows it on ID cards', async () => {
      const kid = (
        await request(server).post('/api/students').set(owner).send(student(secA, 'Photo', { name: 'Photo Parent', phone: mobile(4, 2) })).expect(201)
      ).body.id;
      const refused = await request(server).post(`/api/students/${kid}/photo`).set(owner).attach('file', Buffer.from('MZ not an image'), 'face.png').expect(400);
      expect(refused.body.message).toMatch(/does not look like a real .png/);
      await request(server).post(`/api/students/${kid}/photo`).set(owner).attach('file', Buffer.from('%PDF-1.7'), 'face.pdf').expect(400);
      await request(server)
        .post(`/api/students/${kid}/photo`)
        .set(owner)
        .attach('file', Buffer.alloc(6 * 1024 * 1024, 1), 'huge.png')
        .expect(413);

      const first = await request(server).post(`/api/students/${kid}/photo`).set(campusAdmin).attach('file', png, 'face.png').expect(201);
      const served = await request(server).get(pathOf(first.body.photoUrl)).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      await request(server).get(pathOf(first.body.photoUrl).replace(/sig=.*/, 'sig=forged')).expect(404);

      const cards = await request(server).get(`/api/certificates/id-cards/students?studentIds=${kid}`).set(owner).expect(200);
      expect(cards.body.cards[0].photoUrl).toBe(first.body.photoUrl);

      // Replacing deletes the old file, which ends its link.
      const oldFile = (await prisma.student.findUniqueOrThrow({ where: { id: kid } })).photoFileId!;
      const second = await request(server).post(`/api/students/${kid}/photo`).set(owner).attach('file', png, 'new.png').expect(201);
      expect(second.body.photoUrl).not.toBe(first.body.photoUrl);
      expect(await prisma.storedFile.count({ where: { id: oldFile } })).toBe(0);
      await request(server).get(pathOf(first.body.photoUrl)).expect(404);

      const northKid = (
        await request(server).post('/api/students').set(owner).send(student(secNorth, 'Far', { name: 'Far Parent', phone: mobile(4, 3) })).expect(201)
      ).body.id;
      await request(server).post(`/api/students/${northKid}/photo`).set(campusAdmin).attach('file', png, 'face.png').expect(403);

      await request(server).delete(`/api/students/${kid}/photo`).set(owner).expect(200);
      expect((await prisma.student.findUniqueOrThrow({ where: { id: kid } })).photoUrl).toBeNull();
      await request(server).get(pathOf(second.body.photoUrl)).expect(404);
    });
  });

  describe('normalising rows saved before these rules', () => {
    it('fixes what it can, merges duplicate guardians and reports the rest', async () => {
      const phone = mobile(2, 1);
      const spaced = `${phone.slice(0, 4)}-${phone.slice(4)}`;
      const international = `+92 ${phone.slice(1)}`;
      const a = await prisma.guardian.create({ data: { schoolId, name: 'Old Parent', phone: spaced, cnic: '35202-4444444-4' } });
      const b = await prisma.guardian.create({ data: { schoolId, name: 'old parent', phone: international, occupation: 'Shopkeeper' } });
      const clashA = await prisma.guardian.create({ data: { schoolId, name: 'Name One', phone: `${mobile(2, 2).slice(0, 4)} ${mobile(2, 2).slice(4)}` } });
      await prisma.guardian.create({ data: { schoolId, name: 'Name Two', phone: `92${mobile(2, 2).slice(1)}` } });
      const landline = await prisma.guardian.create({ data: { schoolId, name: 'Landline', phone: '042-35761234', cnic: 'unknown' } });
      const kidA = await prisma.student.findFirstOrThrow({ where: { schoolId, firstName: 'Guarded' } });
      const kidB = await prisma.student.findFirstOrThrow({ where: { schoolId, firstName: 'Mover' } });
      await prisma.studentGuardian.create({ data: { studentId: kidA.id, guardianId: a.id, relation: 'Father' } });
      await prisma.studentGuardian.create({ data: { studentId: kidB.id, guardianId: b.id, relation: 'Father' } });
      await prisma.student.update({ where: { id: kidB.id }, data: { bFormNo: 'B-55' } });
      await prisma.user.create({ data: { schoolId, name: 'Old Login', phone: `+92 ${mobile(2, 3).slice(1)}` } });

      const dry = await normaliseContacts(prisma, { apply: false, schoolId });
      expect(dry.mergedGuardians).toBe(1);
      expect(await prisma.guardian.count({ where: { id: b.id } })).toBe(1);

      const report = await normaliseContacts(prisma, { apply: true, schoolId });
      expect(report.fixed).toMatchObject({ 'Guardian.phone': 1, 'Guardian.cnic': 1, 'User.phone': 1 });
      const merged = await prisma.guardian.findUniqueOrThrow({ where: { id: a.id }, include: { students: true } });
      expect(merged).toMatchObject({ phone, cnic: '3520244444444', occupation: 'Shopkeeper' });
      expect(merged.students.map((s) => s.studentId).sort()).toEqual([kidA.id, kidB.id].sort());
      expect(await prisma.guardian.count({ where: { id: b.id } })).toBe(0);
      expect(await prisma.user.count({ where: { schoolId, phone: mobile(2, 3) } })).toBe(1);

      const problems = report.problems.map((p) => `${p.table}.${p.field}:${p.id === landline.id ? 'landline' : p.id === clashA.id ? 'clash' : p.id === kidB.id ? 'bform' : p.id}`);
      expect(problems).toEqual(
        expect.arrayContaining(['Guardian.phone:landline', 'Guardian.cnic:landline', 'Guardian.phone:clash', 'Student.bFormNo:bform']),
      );
      // Untouched, and a second run changes nothing more.
      expect((await prisma.guardian.findUniqueOrThrow({ where: { id: clashA.id } })).phone).not.toBe(mobile(2, 2));
      const again = await normaliseContacts(prisma, { apply: true, schoolId });
      expect(again.fixed).toEqual({});
      expect(again.mergedGuardians).toBe(0);
    });
  });
});
