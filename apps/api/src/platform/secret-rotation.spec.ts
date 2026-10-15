import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { openSecrets, sealedWith, sealSecrets, secretKey } from '../fees/gateways/school-accounts.js';
import { StudentPhotoLinks } from '../students/student-photo.controller.js';
import { ConfigService } from '@nestjs/config';
import { rotateSecrets } from './secret-rotation.js';

const oldKey = randomBytes(32).toString('hex');
const newKey = randomBytes(32).toString('hex');
const stranger = randomBytes(32).toString('hex');
const OLD_FILES = 'old-file-secret-0123456789abcdef01234';
const NEW_FILES = 'new-file-secret-fedcba9876543210fedcb';
const env = {
  PAYMENTS_SECRET_KEY: newKey,
  PAYMENTS_SECRET_KEY_PREVIOUS: oldKey,
  JWT_SECRET: 'jwt-secret-for-tests-aaaaaaaaaaaaaaaaaaaa',
  FILE_SIGNING_SECRET: NEW_FILES,
  FILE_SIGNING_SECRET_PREVIOUS: OLD_FILES,
};
const seal = (secrets: Record<string, string>, hex: string) => sealSecrets(secrets, secretKey(hex)!);
const oldPhotoUrl = (id: string) => new StudentPhotoLinks(new ConfigService({ ...env, FILE_SIGNING_SECRET: OLD_FILES })).url(id);

/** The tables rotateSecrets reads and writes, in memory, with its compare-and-set updates. */
function fakeDb() {
  const db = {
    gateways: [
      { id: 'g-old', secrets: seal({ hashKey: 'h1' }, oldKey) },
      { id: 'g-new', secrets: seal({ hashKey: 'h2' }, newKey) },
      { id: 'g-lost', secrets: seal({ hashKey: 'h3' }, stranger) },
    ],
    senders: [{ schoolId: 's1', secrets: seal({ token: 'wa' }, oldKey) }],
    jobs: [
      { id: 'j1', status: 'PENDING', payload: { logId: 'l1', sealed: seal({ code: '123456' }, oldKey) } as Record<string, unknown> },
      { id: 'j2', status: 'PENDING', payload: { logId: 'l2' } as Record<string, unknown> },
    ],
    students: [
      { id: 'st1', photoFileId: 'f1', photoUrl: oldPhotoUrl('f1') },
      { id: 'st2', photoFileId: 'f2', photoUrl: '' },
    ],
  };
  const casUpdate = <T extends Record<string, unknown>>(rows: T[], idKey: keyof T, field: keyof T) =>
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r[idKey] === where[idKey as string] && (where[field as string] === undefined || r[field] === where[field as string]));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    };
  const prisma = {
    schoolPaymentGateway: { findMany: async () => db.gateways.map((g) => ({ ...g })), updateMany: casUpdate(db.gateways, 'id', 'secrets') },
    schoolMessagingSender: { findMany: async () => db.senders.map((s) => ({ ...s })), updateMany: casUpdate(db.senders, 'schoolId', 'secrets') },
    job: { findMany: async () => db.jobs.map((j) => ({ ...j })), updateMany: casUpdate(db.jobs, 'id', 'status') },
    student: {
      findMany: async ({ cursor }: { cursor?: { id: string } }) => (cursor ? [] : db.students.map((s) => ({ ...s }))),
      updateMany: casUpdate(db.students, 'id', 'photoFileId'),
    },
  };
  return { db, prisma: prisma as unknown as PrismaClient };
}

describe('rotateSecrets', () => {
  it('reports without changing anything by default', async () => {
    const { db, prisma } = fakeDb();
    const before = JSON.stringify(db);
    const report = await rotateSecrets(prisma, { env });
    expect(report.paymentAccounts).toEqual({ checked: 3, resealed: 1, failed: [{ id: 'g-lost', error: expect.stringContaining('No key') }] });
    expect(report.messagingSenders).toMatchObject({ checked: 1, resealed: 1 });
    expect(report.queuedMessages).toMatchObject({ checked: 1, resealed: 1 });
    expect(report.studentPhotos).toEqual({ checked: 2, resigned: 2 });
    expect(JSON.stringify(db)).toBe(before);
  });

  it('reseals every readable value with the new key when applied, and is safe to run again', async () => {
    const { db, prisma } = fakeDb();
    await rotateSecrets(prisma, { env, apply: true });
    const current = secretKey(newKey)!;
    expect(sealedWith(db.gateways[0].secrets, current)).toBe(true);
    expect(openSecrets(db.gateways[0].secrets, current)).toEqual({ hashKey: 'h1' });
    expect(openSecrets(db.senders[0].secrets, current)).toEqual({ token: 'wa' });
    expect(openSecrets(db.jobs[0].payload.sealed as string, current)).toEqual({ code: '123456' });
    expect(db.jobs[0].payload.logId).toBe('l1');
    // The unreadable one is left alone for a person to deal with.
    expect(sealedWith(db.gateways[2].secrets, current)).toBe(false);
    // Photo links now verify without the previous file secret.
    const after = new StudentPhotoLinks(new ConfigService({ ...env, FILE_SIGNING_SECRET_PREVIOUS: '' }));
    expect(after.verify('f1', new URL(db.students[0].photoUrl).searchParams.get('sig') ?? '')).toBe(true);

    const again = await rotateSecrets(prisma, { env, apply: true });
    expect(again.paymentAccounts.resealed + again.messagingSenders.resealed + again.queuedMessages.resealed + again.studentPhotos.resigned).toBe(0);
  });

  it('needs the new key', async () => {
    const { prisma } = fakeDb();
    await expect(rotateSecrets(prisma, { env: { ...env, PAYMENTS_SECRET_KEY: '' } })).rejects.toThrow(/PAYMENTS_SECRET_KEY is not set/);
  });
});
