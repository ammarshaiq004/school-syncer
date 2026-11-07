import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { BillingService } from '../src/platform/billing/billing.service.js';
import { SchoolDeletionService } from '../src/platform/deletion/school-deletion.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// Deleting unpaid trial schools: who may, which schools are protected, the
// grace period and that a purge only ever touches the one school.
describe('School lifecycle (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let deletion: SchoolDeletionService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ownerEmail = `life-owner+${run}@schoolsyncer.test`;
  const supportEmail = `life-support+${run}@schoolsyncer.test`;
  let admin: Record<string, string>;
  let support: Record<string, string>;
  const slugs: string[] = [];
  const emails: string[] = [];
  const dirs: string[] = [];

  const register = async (name: string) => {
    const email = `${name.replace(/\W/g, '').toLowerCase()}@test.pk`;
    emails.push(email);
    const reg = await request(server)
      .post('/api/auth/register-school')
      .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' })
      .expect(201);
    slugs.push(reg.body.schoolSlug);
    const schoolId = reg.body.user.schoolId as string;
    const campus = await prisma.campus.findFirstOrThrow({ where: { schoolId } });
    const student = await prisma.student.create({
      data: { schoolId, campusId: campus.id, admissionNo: 'A-1', firstName: `Kid ${name}`, gender: 'MALE' },
    });
    return { schoolId, studentId: student.id, name };
  };

  const login = async (email: string) => ({
    Authorization: `Bearer ${(await request(server).post('/api/platform/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken}`,
  });
  const dueNow = (schoolId: string) =>
    prisma.schoolDeletion.updateMany({ where: { schoolId, purgedAt: null }, data: { dueAt: new Date(Date.now() - 1000) } });

  let trial: { schoolId: string; studentId: string; name: string };
  let paying: { schoolId: string; studentId: string; name: string };
  let bystander: { schoolId: string; studentId: string; name: string };

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    const storageDir = mkdtempSync(join(tmpdir(), 'life-store-'));
    dirs.push(storageDir);
    process.env.STORAGE_LOCAL_DIR = storageDir;
    process.env.DELETION_PURGE_AT = 'off';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    deletion = app.get(SchoolDeletionService);

    const hash = await bcrypt.hash('password123', 4);
    await prisma.platformAdmin.createMany({
      data: [
        { email: ownerEmail, name: 'Life Owner', role: 'OWNER', passwordHash: hash },
        { email: supportEmail, name: 'Life Support', role: 'SUPPORT', passwordHash: hash },
      ],
    });
    admin = await login(ownerEmail);
    support = await login(supportEmail);
    trial = await register(`Lifecycle Trial ${run}`);
    paying = await register(`Lifecycle Paying ${run}`);
    bystander = await register(`Lifecycle Bystander ${run}`);
    await prisma.platformInvoice.create({
      data: { number: `SS-T-${run}`, schoolId: paying.schoolId, period: '2098-01', planName: 'Starter', students: 1, amount: 5000, dueDate: new Date('2098-01-10') },
    });
  });

  afterAll(async () => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    await prisma.schoolDeletion.deleteMany({ where: { schoolSlug: { in: slugs } } });
    for (const slug of slugs) await deleteSchools(prisma, { slug });
    await prisma.platformAuditLog.deleteMany({ where: { OR: [{ admin: { email: { in: [ownerEmail, supportEmail] } } }, { schoolId: { in: [trial.schoolId, paying.schoolId, bystander.schoolId] } }] } });
    await prisma.platformAdmin.deleteMany({ where: { email: { in: [ownerEmail, supportEmail] } } });
    await app.close();
  });

  it('refuses a paying school, a wrong name and non-owners', async () => {
    const url = (id: string) => `/api/platform/schools/${id}/deletion`;
    const info = await request(server).get(url(paying.schoolId)).set(support).expect(200);
    expect(info.body.eligible).toBe(false);
    await request(server).post(url(paying.schoolId)).set(admin).send({ confirmName: paying.name, reason: 'cleaning up' }).expect(409);
    await prisma.subscription.update({ where: { schoolId: paying.schoolId }, data: { status: 'ACTIVE' } });
    await request(server).post(url(paying.schoolId)).set(admin).send({ confirmName: paying.name, reason: 'cleaning up' }).expect(409);
    expect(await prisma.schoolDeletion.count({ where: { schoolId: paying.schoolId } })).toBe(0);

    await request(server).post(url(trial.schoolId)).set(support).send({ confirmName: trial.name, reason: 'cleaning up' }).expect(403);
    await request(server).post(url(trial.schoolId)).set(admin).send({ confirmName: 'Something else', reason: 'cleaning up' }).expect(400);
    await request(server).post(url(trial.schoolId)).set(admin).send({ confirmName: trial.name }).expect(400);
  });

  it('suspends at once, can be restored, and the nightly job leaves a restored school alone', async () => {
    const url = `/api/platform/schools/${trial.schoolId}/deletion`;
    const set = await request(server).post(url).set(admin).send({ confirmName: trial.name.toUpperCase(), reason: 'abandoned trial' }).expect(201);
    expect(set.body.pending).toMatchObject({ requestedBy: 'Life Owner' });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { schoolId: trial.schoolId } })).status).toBe('SUSPENDED');
    await request(server).post(url).set(admin).send({ confirmName: trial.name, reason: 'abandoned trial' }).expect(409);

    await request(server).post(`${url}/restore`).set(support).expect(403);
    await request(server).post(`${url}/restore`).set(admin).expect(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { schoolId: trial.schoolId } })).status).toBe('TRIAL');
    await dueNow(trial.schoolId);
    await deletion.runNightly(new Date());
    expect(await prisma.school.count({ where: { id: trial.schoolId } })).toBe(1);
    expect(await prisma.platformAuditLog.count({ where: { schoolId: trial.schoolId, action: { in: ['school.deletion_schedule', 'school.deletion_cancel'] } } })).toBe(2);
  });

  it('extends a trial with a reason, owner only', async () => {
    const url = `/api/platform/schools/${trial.schoolId}/trial`;
    const endsAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await request(server).post(url).set(support).send({ endsAt, reason: 'needs more time' }).expect(403);
    await request(server).post(url).set(admin).send({ endsAt, reason: 'x' }).expect(400);
    await request(server).post(url).set(admin).send({ endsAt: new Date(Date.now() - 1000).toISOString(), reason: 'needs more time' }).expect(400);
    await request(server).post(url).set(admin).send({ endsAt, reason: 'needs more time' }).expect(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { schoolId: trial.schoolId } })).trialEndsAt?.toISOString()).toBe(endsAt);
    await request(server).post(`/api/platform/schools/${paying.schoolId}/trial`).set(admin).send({ endsAt, reason: 'needs more time' }).expect(409);
  });

  it('purges only the scheduled school, keeping a copy of its data', async () => {
    await request(server).post(`/api/platform/schools/${trial.schoolId}/deletion`).set(admin).send({ confirmName: trial.name, reason: 'abandoned trial' }).expect(201);
    await dueNow(trial.schoolId);
    const r = await deletion.runNightly(new Date());
    expect(r.purged).toBe(1);

    expect(await prisma.school.count({ where: { id: trial.schoolId } })).toBe(0);
    expect(await prisma.student.count({ where: { id: trial.studentId } })).toBe(0);
    for (const other of [paying, bystander]) {
      expect(await prisma.school.count({ where: { id: other.schoolId } })).toBe(1);
      expect(await prisma.student.count({ where: { id: other.studentId } })).toBe(1);
    }
    expect(await prisma.platformInvoice.count({ where: { schoolId: paying.schoolId } })).toBe(1);

    const rec = await prisma.schoolDeletion.findFirstOrThrow({ where: { schoolId: trial.schoolId, restoredAt: null } });
    expect(rec).toMatchObject({ purgeError: null });
    expect(rec.purgedAt).not.toBeNull();
    expect(rec.exportExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect(await prisma.platformAuditLog.count({ where: { schoolId: trial.schoolId, action: 'school.deleted', adminId: null } })).toBe(1);

    await request(server).get(`/api/platform/deleted-schools/${rec.id}/export`).set(support).expect(403);
    const zip = await request(server).get(`/api/platform/deleted-schools/${rec.id}/export`).set(admin).buffer().parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const dir = mkdtempSync(join(tmpdir(), 'life-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'x.zip'), zip.body as Buffer);
    const students = execFileSync('unzip', ['-p', join(dir, 'x.zip'), 'students.csv']).toString();
    expect(students).toContain(`Kid ${trial.name}`);
    expect(students).not.toContain(bystander.name);
  });

  it('exports a live school to owners only, with that school\'s rows only', async () => {
    const url = `/api/platform/schools/${bystander.schoolId}/export`;
    await request(server).get(url).set(support).expect(403);
    const zip = await request(server).get(url).set(admin).buffer().parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const dir = mkdtempSync(join(tmpdir(), 'life-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'y.zip'), zip.body as Buffer);
    const students = execFileSync('unzip', ['-p', join(dir, 'y.zip'), 'students.csv']).toString();
    expect(students).toContain(`Kid ${bystander.name}`);
    expect(students).not.toContain(paying.name);
    expect(await prisma.platformAuditLog.count({ where: { schoolId: bystander.schoolId, action: 'school.data_export' } })).toBe(1);
  });

  it('never purges a school that started paying after it was scheduled', async () => {
    const late = await register(`Lifecycle Late ${run}`);
    await request(server).post(`/api/platform/schools/${late.schoolId}/deletion`).set(admin).send({ confirmName: late.name, reason: 'abandoned trial' }).expect(201);
    await prisma.platformInvoice.create({
      data: { number: `SS-L-${run}`, schoolId: late.schoolId, period: '2098-02', planName: 'Starter', students: 1, amount: 5000, dueDate: new Date('2098-02-10') },
    });
    await dueNow(late.schoolId);
    const r = await deletion.runNightly(new Date());
    expect(r.purged).toBe(0);
    expect(await prisma.school.count({ where: { id: late.schoolId } })).toBe(1);
    expect((await prisma.schoolDeletion.findFirstOrThrow({ where: { schoolId: late.schoolId } })).purgeError).toMatch(/bill/);
  });

  it('warns a trial school once that its trial is ending', async () => {
    const ends = new Date(Date.now() + 2 * 86_400_000);
    await prisma.subscription.update({ where: { schoolId: bystander.schoolId }, data: { status: 'TRIAL', trialEndsAt: ends } });
    const billing = app.get(BillingService);
    await billing.sendTrialNotices(new Date());
    await billing.sendTrialNotices(new Date());
    expect(await prisma.platformNotice.count({ where: { schoolId: bystander.schoolId, kind: 'trial.ending' } })).toBe(1);
  });
});
