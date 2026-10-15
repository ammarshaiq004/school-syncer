import { ConfigService } from '@nestjs/config';
import { JobStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { openSecrets, sealedWith, sealSecrets, secretKeys } from '../fees/gateways/school-accounts.js';
import { DELIVER_QUEUE } from '../notifications/notifications.service.js';
import { StudentPhotoLinks } from '../students/student-photo.controller.js';

type Env = Record<string, string | undefined>;

export interface TableReport {
  checked: number;
  /** Sealed with an older key (or the unversioned format) and resealed with the current one. */
  resealed: number;
  /** Could not be opened with any key: left as they are. */
  failed: { id: string; error: string }[];
}

export interface RotationReport {
  paymentAccounts: TableReport;
  messagingSenders: TableReport;
  queuedMessages: TableReport;
  /** Saved photo links signed with an older FILE_SIGNING_SECRET (or JWT_SECRET), signed again. */
  studentPhotos: { checked: number; resigned: number };
}

const empty = (): TableReport => ({ checked: 0, resealed: 0, failed: [] });

/**
 * After rotating PAYMENTS_SECRET_KEY (new key in PAYMENTS_SECRET_KEY, old
 * one in PAYMENTS_SECRET_KEY_PREVIOUS), reseals every stored secret with the
 * new key: schools' merchant accounts, their WhatsApp tokens, and the sealed
 * parameters of messages still waiting to be delivered. Also re-signs saved
 * student photo links with the current file signing secret, so they keep
 * working once the previous one is removed. Dry run unless `apply`. Each
 * write only lands if the row still holds what was read, so a school saving
 * its account meanwhile is never overwritten. Safe to run again.
 */
export async function rotateSecrets(prisma: PrismaClient, opts: { apply?: boolean; env?: Env } = {}): Promise<RotationReport> {
  const env = opts.env ?? process.env;
  const { current, all } = secretKeys(env);
  if (!current) throw new Error('PAYMENTS_SECRET_KEY is not set (or not a valid key): set the new key first');
  const apply = Boolean(opts.apply);

  /** Reseals one value; null when it is already current. */
  const reseal = (sealed: string) => (sealedWith(sealed, current) ? null : sealSecrets(openSecrets(sealed, all), current));

  const report: RotationReport = { paymentAccounts: empty(), messagingSenders: empty(), queuedMessages: empty(), studentPhotos: { checked: 0, resigned: 0 } };

  const step = async (table: TableReport, id: string, sealed: string, write: (value: string) => Promise<number>) => {
    table.checked++;
    try {
      const value = reseal(sealed);
      if (value === null) return;
      if (apply && (await write(value)) === 0) return; // Changed meanwhile: it was saved with the current key.
      table.resealed++;
    } catch (error) {
      table.failed.push({ id, error: (error as Error).message });
    }
  };

  for (const row of await prisma.schoolPaymentGateway.findMany({ where: { secrets: { not: '' } }, select: { id: true, secrets: true } })) {
    await step(report.paymentAccounts, row.id, row.secrets, async (secrets) => (await prisma.schoolPaymentGateway.updateMany({ where: { id: row.id, secrets: row.secrets }, data: { secrets } })).count);
  }

  for (const row of await prisma.schoolMessagingSender.findMany({ where: { secrets: { not: '' } }, select: { schoolId: true, secrets: true } })) {
    await step(report.messagingSenders, row.schoolId, row.secrets, async (secrets) => (await prisma.schoolMessagingSender.updateMany({ where: { schoolId: row.schoolId, secrets: row.secrets }, data: { secrets } })).count);
  }

  const queued = await prisma.job.findMany({ where: { queue: DELIVER_QUEUE, status: JobStatus.PENDING }, select: { id: true, payload: true } });
  for (const job of queued) {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.sealed !== 'string') continue;
    await step(report.queuedMessages, job.id, payload.sealed, async (sealed) => {
      const data = { payload: { ...payload, sealed } as Prisma.InputJsonObject };
      return (await prisma.job.updateMany({ where: { id: job.id, status: JobStatus.PENDING }, data })).count;
    });
  }

  const links = new StudentPhotoLinks(new ConfigService(env));
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.student.findMany({
      where: { photoFileId: { not: null } },
      select: { id: true, photoFileId: true, photoUrl: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (!page.length) break;
    for (const s of page) {
      report.studentPhotos.checked++;
      const url = links.url(s.photoFileId!);
      if (url === s.photoUrl) continue;
      if (apply) {
        const { count } = await prisma.student.updateMany({ where: { id: s.id, photoFileId: s.photoFileId }, data: { photoUrl: url } });
        if (!count) continue;
      }
      report.studentPhotos.resigned++;
    }
    cursor = page[page.length - 1].id;
  }
  return report;
}
