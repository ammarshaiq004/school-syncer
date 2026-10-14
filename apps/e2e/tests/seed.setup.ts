import { test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { call, schoolLogin } from '../support/api';
import { cleanupSeed, hashPassword, withDb } from '../support/db';
import { API_URL, SEED_FILE, WEB_URL } from '../support/env';
import { today, type Seed } from '../support/seed';

const PASSWORD = 'E2e-pass-123';

/** Last month, so the vouchers test can still generate this month's. */
function previousPeriod(day: string) {
  const [y, m] = day.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Written as soon as something exists, so cleanup finds it even if seeding fails half way. */
function save(seed: Partial<Seed>) {
  mkdirSync(path.dirname(SEED_FILE), { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
}

setup('seed a school through the API', async () => {
  // The web bundle has the API address baked in at build time; the CSP header carries it too.
  const csp = (await fetch(`${WEB_URL}/login`)).headers.get('content-security-policy') ?? '';
  if (!csp.includes(new URL(API_URL).origin)) {
    throw new Error(`The web app was built for another API. Run \`pnpm --filter e2e e2e:build\` first. (CSP: ${csp})`);
  }
  // A run that was interrupted before its teardown left its schools behind.
  await cleanupSeed();
  const run = `${Date.now()}`.slice(-9);
  const phone = (n: number) => `0399${run.slice(-6)}${n}`;
  const day = today();
  const year = day.slice(0, 4);
  const period = previousPeriod(day);

  // A console owner, made directly like `platform:create-admin` does.
  const consoleAdmin = { email: `e2e-console+${run}@test.pk`, password: PASSWORD, id: '' };
  consoleAdmin.id = await withDb(async (db) => {
    const admin = await db.platformAdmin.create({
      data: {
        email: consoleAdmin.email,
        name: 'E2E Console',
        passwordHash: await hashPassword(PASSWORD),
        role: 'OWNER',
      },
    });
    return admin.id;
  });
  const slugs: string[] = [];
  save({ consoleAdmin, slugs });
  const consoleToken = (
    await call('POST', '/platform/auth/login', { body: { email: consoleAdmin.email, password: PASSWORD } })
  ).accessToken;
  const fresh = await call('POST', '/platform/schools', {
    token: consoleToken,
    body: { schoolName: `Fresh School ${run}`, ownerName: 'Fresh Owner', email: `e2e-fresh+${run}@test.pk`, planCode: 'starter' },
  });
  slugs.push(fresh.schoolSlug);
  save({ consoleAdmin, slugs });

  // The school the tests work in, registered by its owner.
  const schoolName = `E2E Grammar ${run}`;
  const ownerEmail = `e2e-owner+${run}@test.pk`;
  const reg = await call('POST', '/auth/register-school', {
    body: { schoolName, ownerName: 'Owner E2E', email: ownerEmail, password: PASSWORD },
  });
  slugs.push(reg.schoolSlug);
  save({ consoleAdmin, slugs });
  const token = reg.accessToken as string;
  const post = (p: string, body: unknown) => call('POST', p, { token, body });
  const put = (p: string, body: unknown) => call('PUT', p, { token, body });

  const campusId = (await call('GET', '/campuses', { token }))[0].id;
  const yearId = (
    await post('/academic-years', { name: year, startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, isCurrent: true })
  ).id;
  const teacher = { name: 'Tahira Teacher', phone: phone(1), password: PASSWORD };
  const teacherId = (
    await post('/users', { name: teacher.name, phone: teacher.phone, password: PASSWORD, roles: [{ role: 'TEACHER', campusId }] })
  ).id;
  const grade5 = (await post('/classes', { campusId, name: 'Grade 5' })).id;
  const grade6 = (await post('/classes', { campusId, name: 'Grade 6' })).id;
  const taught = (await post(`/classes/${grade5}/sections`, { academicYearId: yearId, name: 'A', classTeacherId: teacherId })).id;
  const other = (await post(`/classes/${grade6}/sections`, { academicYearId: yearId, name: 'A' })).id;
  const maths = (await post('/subjects', { name: 'Mathematics' })).id;
  await put(`/classes/sections/${taught}/subjects`, { subjects: [{ subjectId: maths, teacherId }] });

  const admit = async (sectionId: string, firstName: string, lastName: string, guardianPhone: string) =>
    (
      await post('/students', {
        sectionId,
        firstName,
        lastName,
        gender: 'FEMALE',
        guardians: [{ name: `Parent of ${firstName}`, phone: guardianPhone, relation: 'Mother' }],
      })
    ).id as string;
  const taughtStudents = [await admit(taught, 'Hira', 'Khan', phone(2)), await admit(taught, 'Sana', 'Malik', phone(3))];
  const child = { id: await admit(other, 'Zara', 'Ahmed', phone(4)), name: 'Zara Ahmed' };

  // The child's parent gets a login; seed its password so the parent test signs straight in.
  const guardianId = (await call('GET', `/students/${child.id}`, { token })).guardians[0].guardianId;
  await post(`/students/${child.id}/guardians/${guardianId}/invite`, {});
  const parent = { name: 'Parent of Zara', phone: phone(4), password: PASSWORD };
  await withDb(async (db) => {
    const [guardian] = (await db.guardian.findMany({ where: { id: guardianId }, select: { id: true, userId: true } })) as {
      id: string;
      userId: string;
    }[];
    await db.user.update({
      where: { id: guardian.userId },
      data: { passwordHash: await hashPassword(PASSWORD), mustChangePassword: false },
    });
    // The teacher's issued password is kept too (the forced change has its own test).
    await db.user.update({ where: { id: teacherId }, data: { mustChangePassword: false } });
  });

  // Fees: a monthly tuition fee and last month's vouchers.
  const head = (await post('/fees/heads', { name: 'Tuition' })).id;
  for (const classId of [grade5, grade6]) {
    await put('/fees/structures', { classId, feeHeadId: head, academicYearId: yearId, amount: 4500 });
  }
  await post('/fees/invoices/generate', { period });

  // Today's register for the child's section.
  await put('/attendance/sheet', { sectionId: other, date: day, records: [{ studentId: child.id, status: 'PRESENT' }] });

  // An exam with a Mathematics paper for Grade 5, for the teacher's marks.
  const exam = { id: '', name: 'Midterm' };
  exam.id = (await post('/exams', { name: exam.name, academicYearId: yearId, startsOn: day })).id;
  await put(`/exams/${exam.id}/papers`, { papers: [{ classId: grade5, subjectId: maths, maxMarks: 50, passMarks: 17 }] });

  // Sanity check: the logins work before any browser test relies on them.
  await schoolLogin(reg.schoolSlug, teacher.phone, PASSWORD);
  await schoolLogin(reg.schoolSlug, parent.phone, PASSWORD);

  save({
    run,
    slugs,
    consoleAdmin,
    school: { slug: reg.schoolSlug, name: schoolName, ownerEmail, password: PASSWORD },
    fresh: { slug: fresh.schoolSlug, ownerEmail: `e2e-fresh+${run}@test.pk`, temporaryPassword: fresh.temporaryPassword },
    teacher,
    parent,
    sections: { taught: 'Grade 5 A', other: 'Grade 6 A' },
    child,
    taughtStudents,
    exam,
    period,
  } satisfies Seed);
});
