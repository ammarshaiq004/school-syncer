import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { API_DIR, SEED_FILE } from './env';

// The Prisma client is generated for the API package, so load it (and the
// API's bcrypt) from there rather than adding a second copy here.
const requireFromApi = createRequire(path.join(API_DIR, 'package.json'));

interface Delegate {
  deleteMany(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<{ id: string }[]>;
  update(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<{ id: string }>;
}
/** The handful of Prisma calls the seed and cleanup make. */
export type Db = Record<
  | 'school'
  | 'user'
  | 'guardian'
  | 'roleAssignment'
  | 'payment'
  | 'exam'
  | 'payrollRun'
  | 'accountEntry'
  | 'application'
  | 'student'
  | 'platformAdmin',
  Delegate
> & { $disconnect(): Promise<void> };

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { PrismaClient } = requireFromApi('@prisma/client') as { PrismaClient: new () => Db };
  const db = new PrismaClient();
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

export const hashPassword = (password: string): Promise<string> =>
  (requireFromApi('bcryptjs') as { hash(p: string, rounds: number): Promise<string> }).hash(password, 10);

/**
 * Deletes the e2e schools. Same order as apps/api/test/cleanup.ts: money and
 * enrollment history refuse to cascade, so they go first.
 */
export async function deleteSchools(db: Db, slugs: string[]) {
  const schools = await db.school.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  const schoolId = { in: schools.map((s) => s.id) };
  await db.roleAssignment.deleteMany({ where: { customRoleId: { not: null }, user: { schoolId } } });
  await db.payment.deleteMany({ where: { schoolId } });
  await db.exam.deleteMany({ where: { schoolId } });
  await db.payrollRun.deleteMany({ where: { schoolId } });
  await db.accountEntry.deleteMany({ where: { schoolId } });
  await db.application.deleteMany({ where: { schoolId } });
  await db.student.deleteMany({ where: { schoolId } });
  await db.school.deleteMany({ where: { id: schoolId } });
}

/** Removes what a seed run created (also a leftover one from an interrupted run). */
export async function cleanupSeed() {
  if (!existsSync(SEED_FILE)) return;
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as { slugs?: string[]; consoleAdmin?: { id?: string } };
  await withDb(async (db) => {
    await deleteSchools(db, seed.slugs ?? []);
    if (seed.consoleAdmin?.id) await db.platformAdmin.deleteMany({ where: { id: seed.consoleAdmin.id } });
  });
  rmSync(SEED_FILE);
}
