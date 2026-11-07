import { ConflictException, Inject, Injectable, Logger, NotFoundException, BadRequestException, type OnModuleInit } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { PlatformUser } from '../../common/auth-user.js';
import { SCHOOL_TIMEZONE } from '../../common/dates.js';
import { STORAGE_DRIVER, type StorageDriver } from '../../elearning/files/storage/storage-driver.js';
import { reconcileAt, reconcileSlot } from '../../fees/reconciliation/reconciliation.scheduler.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { logPlatform, logToSchool } from '../platform-audit.js';
import { SubscriptionService } from '../subscription.service.js';
import {
  BLOCKER_TEXT,
  DELETION_GRACE_DAYS,
  EXPORT_KEEP_DAYS,
  addDays,
  deletionBlockers,
  normaliseName,
  trialExtensionError,
} from './deletion.js';
import { writeSchoolExport } from './school-data-export.js';

export const DELETION_QUEUE = 'platform.school-deletion';

/**
 * Deleting unpaid trial schools (SCHOOL-156), the way ShopSyncer does it: the
 * school is suspended at once, can be let off for 14 days, and then a nightly
 * job saves a copy of its data (kept 90 days), removes it and records it.
 * Only a school on a free trial that never had a bill, payment or payment
 * claim is ever eligible, and that is checked again at the moment of purging.
 */
@Injectable()
export class SchoolDeletionService implements OnModuleInit {
  private readonly logger = new Logger(SchoolDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  onModuleInit() {
    this.jobs.register(DELETION_QUEUE, {
      run: async () => {
        const r = await this.runNightly(new Date());
        this.logger.log(`School deletion: ${r.purged} schools removed, ${r.failed} failed, ${r.exportsExpired} old exports removed.`);
      },
      backoffMs: 30 * 60_000,
    });
    const at = reconcileAt(process.env.DELETION_PURGE_AT ?? '03:00');
    if (!at) return;
    this.jobs.schedule({ name: 'school-deletion', queue: DELETION_QUEUE, slot: (now) => reconcileSlot(at, now), maxAttempts: 3 });
    if (process.env.NODE_ENV !== 'test') this.logger.log(`Scheduled school deletions are carried out daily at ${at} (${SCHOOL_TIMEZONE}).`);
  }

  /** What the console's delete dialog shows. */
  async info(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, slug: true, subscription: { select: { status: true, trialEndsAt: true } } },
    });
    if (!school?.subscription) throw new NotFoundException('School not found');
    const [facts, students, staff, pending] = await Promise.all([
      this.facts(schoolId),
      this.prisma.student.count({ where: { schoolId } }),
      this.prisma.user.count({ where: { schoolId } }),
      this.pending(schoolId),
    ]);
    const blockers = deletionBlockers({ status: school.subscription.status, ...facts, pending: !!pending });
    return {
      schoolId,
      name: school.name,
      status: school.subscription.status,
      trialEndsAt: school.subscription.trialEndsAt,
      eligible: blockers.length === 0,
      blockers: blockers.map((code) => ({ code, text: BLOCKER_TEXT[code] })),
      data: { students, users: staff },
      graceDays: DELETION_GRACE_DAYS,
      pending,
    };
  }

  /** Suspends an eligible trial school at once and sets the day it will be removed. */
  async schedule(admin: PlatformUser, schoolId: string, confirmName: string, reason: string) {
    const info = await this.info(schoolId);
    if (normaliseName(confirmName) !== normaliseName(info.name)) {
      throw new BadRequestException("The school name does not match. Type the school's name exactly as shown.");
    }
    if (!info.eligible) throw new ConflictException(info.blockers.map((b) => b.text).join(' '));
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } });
    const now = new Date();
    const dueAt = addDays(now, DELETION_GRACE_DAYS);
    await this.prisma.$transaction(async (tx) => {
      // Only moves a school still on its trial, so a school that just started paying is never suspended for deletion.
      const { count } = await tx.subscription.updateMany({
        where: { schoolId, status: SubscriptionStatus.TRIAL },
        data: { status: SubscriptionStatus.SUSPENDED },
      });
      if (!count) throw new ConflictException('This school changed while you were working. Reload and try again.');
      await tx.schoolDeletion.create({
        data: { schoolId, schoolName: school.name, schoolSlug: school.slug, reason, requestedBy: admin.name, requestedAt: now, dueAt, priorStatus: SubscriptionStatus.TRIAL },
      });
      await logPlatform(tx, admin, 'school.deletion_schedule', schoolId, { reason, dueAt, students: info.data.students });
      await logToSchool(tx, admin, schoolId, 'platform.deletion_schedule', 'School', schoolId, { after: { dueAt } });
    });
    this.subscriptions.forget(schoolId);
    return this.info(schoolId);
  }

  /** Lets a school off: it goes back to its trial. */
  async restore(admin: PlatformUser, schoolId: string) {
    const pending = await this.pending(schoolId);
    if (!pending) throw new ConflictException('This school is not waiting to be deleted');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.schoolDeletion.updateMany({
        where: { id: pending.id, restoredAt: null, purgedAt: null },
        data: { restoredAt: new Date(), restoredBy: admin.name },
      });
      if (!count) throw new ConflictException('This school is no longer waiting to be deleted');
      await tx.subscription.updateMany({ where: { schoolId, status: SubscriptionStatus.SUSPENDED }, data: { status: pending.priorStatus } });
      await logPlatform(tx, admin, 'school.deletion_cancel', schoolId, { requestedBy: pending.requestedBy });
      await logToSchool(tx, admin, schoolId, 'platform.deletion_cancel', 'School', schoolId);
    });
    this.subscriptions.forget(schoolId);
    return this.info(schoolId);
  }

  /** Sets a new end for a school's free trial. */
  async extendTrial(admin: PlatformUser, schoolId: string, endsAt: Date, reason: string) {
    const error = trialExtensionError(endsAt, new Date());
    if (error) throw new BadRequestException(error);
    const sub = await this.prisma.subscription.findUnique({ where: { schoolId } });
    if (!sub) throw new NotFoundException('School not found');
    if (sub.status !== SubscriptionStatus.TRIAL) throw new ConflictException('Only a school on a free trial can have its trial changed');
    if (await this.pending(schoolId)) throw new ConflictException('This school is waiting to be deleted');
    await this.prisma.subscription.update({ where: { schoolId }, data: { trialEndsAt: endsAt } });
    this.subscriptions.forget(schoolId);
    await logPlatform(this.prisma, admin, 'school.trial_extend', schoolId, { reason, before: sub.trialEndsAt, after: endsAt });
    return { trialEndsAt: endsAt };
  }

  /** Streams a zip of the school's records to the response and records the download. */
  async exportTo(admin: PlatformUser, schoolId: string, out: Writable) {
    const exists = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!exists) throw new NotFoundException('School not found');
    const rows = await writeSchoolExport(this.prisma, schoolId, out);
    await logPlatform(this.prisma, admin, 'school.data_export', schoolId, { rows });
  }

  /** Schools removed, with the copy of their data that is still kept. */
  deleted() {
    return this.prisma.schoolDeletion.findMany({
      where: { purgedAt: { not: null } },
      orderBy: { purgedAt: 'desc' },
      take: 200,
      select: { id: true, schoolName: true, schoolSlug: true, reason: true, requestedBy: true, requestedAt: true, purgedAt: true, exportKey: true, exportSize: true, exportExpiresAt: true },
    });
  }

  /** The kept copy of a removed school's data, to stream to a download. */
  async keptExport(admin: PlatformUser, id: string) {
    const d = await this.prisma.schoolDeletion.findUnique({ where: { id } });
    if (!d?.exportKey) throw new NotFoundException('There is no saved copy of this school any more');
    const stream = await this.storage.read(d.exportKey);
    await logPlatform(this.prisma, admin, 'school.data_export', d.schoolId, { kept: true, name: d.schoolName });
    return { stream, name: d.schoolSlug };
  }

  async runNightly(now: Date) {
    const due = await this.prisma.schoolDeletion.findMany({ where: { restoredAt: null, purgedAt: null, dueAt: { lte: now } }, orderBy: { dueAt: 'asc' } });
    let purged = 0;
    let failed = 0;
    for (const d of due) {
      try {
        if (await this.purge(d)) purged += 1;
        else failed += 1;
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Could not remove school ${d.schoolId}: ${message}`);
        await this.prisma.schoolDeletion.update({ where: { id: d.id }, data: { purgeError: message.slice(0, 500) } });
      }
    }
    return { purged, failed, exportsExpired: await this.expireExports(now) };
  }

  /**
   * Saves a copy of the school's data, then removes the school. False when the
   * school is no longer eligible: it is left suspended with the reason recorded.
   */
  private async purge(d: { id: string; schoolId: string }) {
    const sub = await this.prisma.subscription.findUnique({ where: { schoolId: d.schoolId } });
    const facts = await this.facts(d.schoolId);
    const blockers = deletionBlockers({ status: sub?.status === SubscriptionStatus.SUSPENDED ? SubscriptionStatus.TRIAL : (sub?.status ?? SubscriptionStatus.CANCELLED), ...facts, pending: false });
    if (blockers.length) {
      await this.prisma.schoolDeletion.update({ where: { id: d.id }, data: { purgeError: blockers.map((b) => BLOCKER_TEXT[b]).join(' ') } });
      return false;
    }
    const dir = await mkdtemp(join(tmpdir(), 'school-export-'));
    try {
      const file = join(dir, 'export.zip');
      const out = createWriteStream(file);
      const rows = await writeSchoolExport(this.prisma, d.schoolId, out);
      await finished(out);
      const key = `school-exports/${d.schoolId}-${Date.now()}.zip`;
      await this.storage.put(key, file, 'application/zip');
      const size = (await stat(file)).size;
      const files = await this.prisma.storedFile.findMany({ where: { schoolId: d.schoolId }, select: { key: true } });
      const schoolId = d.schoolId;
      const now = new Date();
      await this.prisma.$transaction([
        // Money and enrollment history is not cascade-deleted by the schema, so it goes first.
        this.prisma.roleAssignment.deleteMany({ where: { customRoleId: { not: null }, user: { schoolId } } }),
        this.prisma.payment.deleteMany({ where: { schoolId } }),
        this.prisma.exam.deleteMany({ where: { schoolId } }),
        this.prisma.payrollRun.deleteMany({ where: { schoolId } }),
        this.prisma.accountEntry.deleteMany({ where: { schoolId } }),
        this.prisma.application.deleteMany({ where: { schoolId } }),
        this.prisma.student.deleteMany({ where: { schoolId } }),
        this.prisma.school.deleteMany({ where: { id: schoolId } }),
        this.prisma.schoolDeletion.update({
          where: { id: d.id },
          data: { purgedAt: now, purgeError: null, exportKey: key, exportSize: size, exportExpiresAt: addDays(now, EXPORT_KEEP_DAYS) },
        }),
        this.prisma.platformAuditLog.create({
          data: { adminId: null, action: 'school.deleted', schoolId, details: { rows, exportBytes: size } as Prisma.InputJsonValue },
        }),
      ]);
      this.subscriptions.forget(schoolId);
      for (const f of files) await this.storage.delete(f.key).catch(() => undefined);
      return true;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Removes saved copies that are past their keep-until date. */
  private async expireExports(now: Date) {
    const old = await this.prisma.schoolDeletion.findMany({ where: { exportKey: { not: null }, exportExpiresAt: { lte: now } } });
    for (const d of old) {
      await this.storage.delete(d.exportKey!);
      await this.prisma.schoolDeletion.update({ where: { id: d.id }, data: { exportKey: null } });
    }
    return old.length;
  }

  private pending(schoolId: string) {
    return this.prisma.schoolDeletion.findFirst({ where: { schoolId, restoredAt: null, purgedAt: null }, orderBy: { requestedAt: 'desc' } });
  }

  private async facts(schoolId: string) {
    const [invoices, payments, claims] = await Promise.all([
      this.prisma.platformInvoice.count({ where: { schoolId } }),
      this.prisma.platformPayment.count({ where: { schoolId } }),
      this.prisma.paymentClaim.count({ where: { schoolId } }),
    ]);
    return { invoices, payments, claims };
  }
}
