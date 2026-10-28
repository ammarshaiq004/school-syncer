import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Role, StudentStatus, SubscriptionStatus } from '@prisma/client';
import { SCHOOL_TIMEZONE, dayStart, daysBefore, localToday, startOfLocalDay } from '../common/dates.js';
import { reconcileAt, reconcileSlot } from '../fees/reconciliation/reconciliation.scheduler.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthlyAmount } from './plans.js';

export const USAGE_QUEUE = 'platform.usage-snapshots';

/**
 * Takes each school's usage snapshot at the end of every day (SNAPSHOT_AT,
 * school-local time, "23:30" by default, or "off"). One run per day across all
 * servers; a failed run is retried, and a night the servers were down is a gap
 * in the history, not filled in later.
 */
@Injectable()
export class UsageSnapshotsService implements OnModuleInit {
  private readonly logger = new Logger(UsageSnapshotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(USAGE_QUEUE, {
      // shortcut: a retry that lands after midnight snapshots the new day, leaving a one-day gap; fine for trends.
      run: async () => {
        const day = localToday();
        this.logger.log(`Usage snapshots for ${day}: ${await this.take(day)} schools.`);
      },
      backoffMs: 10 * 60_000,
    });
    const at = reconcileAt(process.env.SNAPSHOT_AT ?? '23:30');
    if (!at) return;
    this.jobs.schedule({
      name: 'usage-snapshots',
      queue: USAGE_QUEUE,
      slot: (now) => reconcileSlot(at, now),
      maxAttempts: 3,
    });
    if (process.env.NODE_ENV !== 'test') this.logger.log(`Usage snapshots are taken daily at ${at} (${SCHOOL_TIMEZONE}).`);
  }

  /** Records (or re-records) the snapshot of every school that is not cancelled for a local day; returns how many. */
  async take(day: string): Promise<number> {
    const from = startOfLocalDay(day);
    const to = startOfLocalDay(daysBefore(day, -1));
    const signedIn = { isActive: true, lastLoginAt: { gte: new Date(to.getTime() - 7 * 86_400_000) } };
    const [subs, students, staff, parents, registers, fees, messages, storage] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: { not: SubscriptionStatus.CANCELLED } },
        select: { schoolId: true, status: true, plan: { select: { pricePerStudent: true, minimumMonthly: true } } },
      }),
      this.prisma.student.groupBy({ by: ['schoolId'], where: { status: StudentStatus.ACTIVE }, _count: true }),
      this.prisma.user.groupBy({
        by: ['schoolId'],
        where: { ...signedIn, roles: { some: { role: { notIn: [Role.PARENT, Role.STUDENT] } } } },
        _count: true,
      }),
      this.prisma.user.groupBy({ by: ['schoolId'], where: { ...signedIn, roles: { some: { role: Role.PARENT } } }, _count: true }),
      this.prisma.attendanceSession.groupBy({ by: ['schoolId'], where: { date: dayStart(day) }, _count: true }),
      this.prisma.payment.groupBy({
        by: ['schoolId'],
        where: { receivedAt: { gte: from, lt: to }, reversedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.notificationLog.groupBy({ by: ['schoolId'], where: { createdAt: { gte: from, lt: to } }, _count: true }),
      this.prisma.storedFile.groupBy({ by: ['schoolId'], _sum: { size: true } }),
    ]);
    const count = (rows: { schoolId: string; _count: number }[]) => new Map(rows.map((r) => [r.schoolId, r._count]));
    const [studentsBy, staffBy, parentsBy, registersBy, messagesBy] = [students, staff, parents, registers, messages].map(count);
    const feesBy = new Map(fees.map((r) => [r.schoolId, r._sum.amount ?? 0]));
    const storageBy = new Map(storage.map((r) => [r.schoolId, r._sum.size ?? 0]));

    const rows = subs.map((s) => {
      const n = studentsBy.get(s.schoolId) ?? 0;
      const paying = s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.PAST_DUE;
      return {
        schoolId: s.schoolId,
        day: dayStart(day),
        students: n,
        staffActive7d: staffBy.get(s.schoolId) ?? 0,
        parentsActive7d: parentsBy.get(s.schoolId) ?? 0,
        attendanceSessions: registersBy.get(s.schoolId) ?? 0,
        feesCollected: feesBy.get(s.schoolId) ?? 0,
        messagesSent: messagesBy.get(s.schoolId) ?? 0,
        storageBytes: BigInt(storageBy.get(s.schoolId) ?? 0),
        mrr: paying ? monthlyAmount(s.plan, n) : 0,
      };
    });
    // Re-running a day replaces its rows.
    await this.prisma.$transaction([
      this.prisma.schoolUsageSnapshot.deleteMany({ where: { day: dayStart(day), schoolId: { in: rows.map((r) => r.schoolId) } } }),
      this.prisma.schoolUsageSnapshot.createMany({ data: rows }),
    ]);
    return rows.length;
  }
}
