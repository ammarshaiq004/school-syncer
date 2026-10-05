import type { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';

/** A student signs in with their admission number, lowercased (e.g. "2026-0042"). */
export const studentUsername = (admissionNo: string) => admissionNo.trim().toLowerCase();

// No 0/O, 1/l/I: temp passwords are read off a printed slip.
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

/**
 * A temporary password a child can type from a printout: four letters and
 * four digits, e.g. "kmtr4827". Cryptographically random.
 */
export function tempPassword(pick: (max: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += LETTERS[pick(LETTERS.length)];
  for (let i = 0; i < 4; i++) out += DIGITS[pick(DIGITS.length)];
  return out;
}

/** Bcrypt cost for single logins (same as staff); bulk temp passwords use a lower one so a section of 40 stays quick. */
export const STUDENT_BCRYPT_ROUNDS = 12;
export const BULK_BCRYPT_ROUNDS = 10;

/** A Prisma client or transaction: enough for disableStudentLogins. */
type LoginDb = Pick<Prisma.TransactionClient, 'student' | 'user'>;

/**
 * Switches off the own logins of students who stopped being current (left,
 * graduated, suspended). Returns the user ids so the caller can call
 * UserStatusService.forget on each once the write has committed.
 */
export async function disableStudentLogins(db: LoginDb, studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const rows = await db.student.findMany({
    where: { id: { in: studentIds }, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
  if (userIds.length) {
    await db.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
  }
  return userIds;
}
