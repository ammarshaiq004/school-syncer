import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FeeFrequency,
  FineStatus,
  InvoiceKind,
  InvoiceLineKind,
  InvoiceStatus,
  Prisma,
  VoucherRunStatus,
} from '@prisma/client';
import { campusScopeFor, FEE_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthBounds, riderFee } from '../transport/transport-rules.js';
import { fineRule, invoiceLines, type InvoiceLineDraft, type StructureRow } from './fee-calculator.js';
import { bookLateFine } from './fine-booking.js';
import { voucherNo } from './invoice-codes.js';
import { OPEN_INVOICE } from './outstanding.js';
import { schoolSiblings } from './siblings.js';

/** Students billed per transaction: a crash loses at most one batch, and a re-run fills it in. */
export const RUN_BATCH = 25;
/** A run that has held its lock this long is taken to have died, and a new run may start. */
const STALE_RUN_MS = 15 * 60_000;

export interface GenerateInput {
  period: string;
  classId?: string;
  sendWhatsApp: boolean;
  /** Move earlier vouchers' unpaid balances onto this month's; defaults to the school's fee rule. */
  carryForward?: boolean;
}

/** Something else changed a voucher this batch was working on; the batch is retried. */
class RunRace extends Error {}

const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Monthly voucher runs (SCHOOL-138). A run bills every active student in the
 * current year who has no voucher for the month yet, in batches that each
 * commit whole, so a crash leaves complete vouchers and running it again
 * fills in the rest. A student's monthly voucher is unique per month in the
 * database, and only one run per school and month can be going at a time,
 * so a double click never bills anyone twice.
 */
@Injectable()
export class VoucherRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async generate(user: AuthUser, body: GenerateInput) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
    const year = await this.prisma.academicYear.findFirst({ where: { schoolId: user.schoolId, isCurrent: true } });
    if (!year) throw new NotFoundException('Set a current academic year first');
    const scope = campusScopeFor(user, FEE_ROLES);
    const studentScope = scope ? { campusId: { in: scope } } : {};
    const carryForward = body.carryForward ?? school.carryForwardArrears;

    const run = await this.lock(user, body);
    try {
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          schoolId: user.schoolId,
          academicYearId: year.id,
          status: 'ACTIVE',
          student: { status: 'ACTIVE', ...studentScope },
          ...(body.classId ? { section: { classId: body.classId } } : {}),
        },
        include: {
          student: { include: { concessions: true } },
          section: { select: { classId: true } },
        },
        orderBy: { student: { admissionNo: 'asc' } },
      });
      // A student enrolled twice (moved section mid-year) is billed once.
      const seen = new Set<string>();
      const students = enrollments.filter((e) => !seen.has(e.studentId) && seen.add(e.studentId));
      const billed = new Set(
        (
          await this.prisma.invoice.findMany({
            where: { monthlyPeriod: body.period, studentId: { in: students.map((e) => e.studentId) } },
            select: { studentId: true },
          })
        ).map((i) => i.studentId),
      );
      const todo = students.filter((e) => !billed.has(e.studentId));

      const structures = await this.prisma.feeStructure.findMany({
        where: { schoolId: user.schoolId, academicYearId: year.id },
        include: { feeHead: true },
      });
      const riders = await this.transportRiders(user.schoolId, todo.map((e) => e.studentId), body.period);
      const siblings = await schoolSiblings(this.prisma, user.schoolId, year.id);
      const firstMonth = year.startsOn.toISOString().slice(0, 7) === body.period;
      const [y, m] = body.period.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const dueDate = new Date(Date.UTC(y, m - 1, Math.min(school.feeDueDay, lastDay)));
      const today = dayStart(localToday());
      const rule = fineRule(school);

      const draft = (e: (typeof todo)[number]): InvoiceLineDraft[] => {
        const place = siblings.get(e.studentId);
        return invoiceLines(
          structures
            .filter((s) => s.classId === e.section.classId)
            .map((s) => ({ feeHeadId: s.feeHeadId, feeHeadName: s.feeHead.name, frequency: s.feeHead.frequency, amount: s.amount }))
            .concat(riders.get(e.studentId) ?? []),
          e.student.concessions,
          firstMonth,
          body.period,
          place
            ? {
                rank: place.rank,
                secondPercent: school.siblingSecondPercent,
                thirdPercent: school.siblingThirdPercent,
                feeHeadIds: school.siblingFeeHeadIds,
              }
            : undefined,
        );
      };

      const created: { id: string; studentId: string; total: number; voucherNo: string; name: string }[] = [];
      let carried = 0;
      let alreadyBilled = billed.size;
      for (let i = 0; i < todo.length; i += RUN_BATCH) {
        const batch = todo.slice(i, i + RUN_BATCH);
        const result = await this.batch(body.period, batch, async (tx, e) => {
          // Library fines not paid at the desk go on the voucher.
          const fines = await tx.bookLoan.findMany({
            where: { schoolId: user.schoolId, studentId: e.studentId, fineStatus: FineStatus.DUE },
            include: { copy: { select: { book: { select: { title: true } } } } },
          });
          const lines = draft(e);
          for (const f of fines) {
            lines.push({ feeHeadId: null, description: `Library fine: ${f.copy.book.title}${f.lost ? ' (lost)' : ''}`, amount: f.fine });
          }
          // Earlier vouchers still owing, already past due, move onto this one.
          const arrears = carryForward
            ? await tx.invoice.findMany({
                where: { studentId: e.studentId, period: { lt: body.period }, dueDate: { lt: today }, ...OPEN_INVOICE },
                orderBy: { period: 'asc' },
              })
            : [];
          const carriedLines: { from: string; amount: number; paid: number }[] = [];
          for (const old of arrears) {
            // The fine so far is booked onto the old voucher first, so it travels with the balance.
            const { invoice } = await bookLateFine(tx, old, today, rule);
            const balance = invoice.total - invoice.paid;
            if (balance <= 0) continue;
            carriedLines.push({ from: invoice.id, amount: balance, paid: invoice.paid });
            lines.push({
              feeHeadId: null,
              description: `Arrears: ${monthName(invoice.period)} (voucher ${invoice.voucherNo})`,
              amount: balance,
              kind: InvoiceLineKind.ARREARS,
            });
          }
          if (!lines.length) return null;
          const total = lines.reduce((sum, l) => sum + l.amount, 0);
          const invoice = await tx.invoice.create({
            data: {
              schoolId: user.schoolId,
              studentId: e.studentId,
              voucherNo: voucherNo(body.period),
              period: body.period,
              monthlyPeriod: body.period,
              kind: InvoiceKind.MONTHLY,
              runId: run.id,
              dueDate,
              total,
              arrears: carriedLines.reduce((s, c) => s + c.amount, 0),
              status: total <= 0 ? InvoiceStatus.PAID : InvoiceStatus.UNPAID,
              lines: { create: lines },
            },
          });
          if (fines.length) {
            await tx.bookLoan.updateMany({
              where: { id: { in: fines.map((f) => f.id) }, fineStatus: FineStatus.DUE },
              data: { fineStatus: FineStatus.BILLED, invoiceId: invoice.id },
            });
          }
          for (const c of carriedLines) {
            // Only if no payment landed on it meanwhile; otherwise the batch starts again.
            const moved = await tx.invoice.updateMany({
              where: { id: c.from, paid: c.paid, ...OPEN_INVOICE },
              data: { status: InvoiceStatus.CARRIED_FORWARD, carriedToId: invoice.id },
            });
            if (moved.count !== 1) throw new RunRace();
          }
          return {
            invoice: { id: invoice.id, studentId: e.studentId, total, voucherNo: invoice.voucherNo, name: fullName(e.student) },
            carried: carriedLines.length,
          };
        });
        for (const r of result.done) {
          created.push(r.invoice);
          carried += r.carried;
        }
        alreadyBilled += result.alreadyBilled;
        await this.prisma.voucherRun.update({
          where: { id: run.id },
          data: { created: created.length, carried, totalBilled: created.reduce((s, c) => s + c.total, 0) },
        });
      }

      let messages = 0;
      if (body.sendWhatsApp && created.length) {
        const phones = await guardianPhones(this.prisma, created.map((c) => c.studentId));
        messages = await this.notifications.send(
          user.schoolId,
          created
            .filter((c) => c.total > 0)
            .flatMap((c) =>
              (phones.get(c.studentId) ?? []).map((to) => ({
                to,
                template: 'fees.voucher' as const,
                params: {
                  studentName: c.name,
                  period: body.period,
                  amount: c.total.toLocaleString('en-PK'),
                  dueDate: dueDate.toISOString().slice(0, 10),
                  voucherNo: c.voucherNo,
                  schoolName: school.name,
                },
              })),
            ),
        );
      }

      const summary = {
        runId: run.id,
        period: body.period,
        students: students.length,
        created: created.length,
        alreadyBilled,
        // Students with nothing to bill this month (no fee set for their class).
        skipped: students.length - created.length - alreadyBilled,
        carriedForward: carried,
        totalBilled: created.reduce((s, c) => s + c.total, 0),
        messages,
      };
      await this.prisma.voucherRun.update({
        where: { id: run.id },
        data: {
          status: VoucherRunStatus.DONE,
          lockKey: null,
          finishedAt: new Date(),
          students: summary.students,
          created: summary.created,
          skipped: summary.alreadyBilled + summary.skipped,
          carried,
          totalBilled: summary.totalBilled,
          messages,
        },
      });
      await this.audit.record(user, 'invoices.generate', 'VoucherRun', run.id, { after: summary });
      return summary;
    } catch (error) {
      // Batches already committed stay; the run is marked so the next one can start and fill the gap.
      await this.prisma.voucherRun.update({
        where: { id: run.id },
        data: {
          status: VoucherRunStatus.FAILED,
          lockKey: null,
          finishedAt: new Date(),
          error: error instanceof Error ? error.message.slice(0, 500) : 'Failed',
        },
      });
      throw error;
    }
  }

  /** Recent runs: the whole school's for school-wide fee staff, a campus accountant's own otherwise. */
  runs(user: AuthUser) {
    const scope = campusScopeFor(user, FEE_ROLES);
    return this.prisma.voucherRun.findMany({
      where: { schoolId: user.schoolId, ...(scope ? { startedById: user.sub } : {}) },
      orderBy: { startedAt: 'desc' },
      take: 20,
      omit: { lockKey: true },
    });
  }

  /** Starts a run, or refuses while another run for the same month is still going. */
  private async lock(user: AuthUser, body: GenerateInput) {
    const lockKey = `${user.schoolId}:${body.period}`;
    const start = () =>
      this.prisma.voucherRun.create({
        data: { schoolId: user.schoolId, period: body.period, classId: body.classId, lockKey, startedById: user.sub },
      });
    try {
      return await start();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
    // A run whose server died never released its lock; after a while it is taken over.
    const stale = await this.prisma.voucherRun.updateMany({
      where: { lockKey, startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
      data: { lockKey: null, status: VoucherRunStatus.FAILED, finishedAt: new Date(), error: 'Interrupted' },
    });
    if (stale.count) {
      try {
        return await start();
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new ConflictException('Vouchers for this month are already being generated. Wait for that run to finish, then run it again if needed.');
  }

  /**
   * Bills one batch in a single transaction. A student billed meanwhile by
   * another path trips the unique voucher-per-month rule; the batch is then
   * retried without them.
   */
  private async batch<E extends { studentId: string }, R>(
    period: string,
    batch: E[],
    bill: (tx: Prisma.TransactionClient, e: E) => Promise<R | null>,
  ): Promise<{ done: R[]; alreadyBilled: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const taken = new Set(
              (
                await tx.invoice.findMany({
                  where: { monthlyPeriod: period, studentId: { in: batch.map((e) => e.studentId) } },
                  select: { studentId: true },
                })
              ).map((i) => i.studentId),
            );
            const done: R[] = [];
            for (const e of batch) {
              if (taken.has(e.studentId)) continue;
              const r = await bill(tx, e);
              if (r) done.push(r);
            }
            return { done, alreadyBilled: taken.size };
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
      } catch (error) {
        const raced =
          error instanceof RunRace || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002');
        if (!raced || attempt >= 3) throw error;
      }
    }
  }

  /**
   * A Transport line for each student who rode a school van during the
   * month, at their stop's fee. Concessions on the Transport head apply.
   */
  private async transportRiders(schoolId: string, studentIds: string[], period: string) {
    const { first, last } = monthBounds(period);
    const rides = await this.prisma.transportAssignment.findMany({
      where: {
        schoolId,
        studentId: { in: studentIds },
        startsOn: { lte: dayStart(last) },
        OR: [{ endsOn: null }, { endsOn: { gte: dayStart(first) } }],
      },
      include: { route: true, stop: true },
      orderBy: { startsOn: 'desc' },
    });
    const rows = new Map<string, StructureRow[]>();
    if (!rides.length) return rows;
    const head = await this.prisma.feeHead.upsert({
      where: { schoolId_name: { schoolId, name: 'Transport' } },
      create: { schoolId, name: 'Transport', frequency: FeeFrequency.MONTHLY },
      update: {},
    });
    // A student who changed routes mid-month pays the latest route's fee once.
    for (const r of rides) {
      if (rows.has(r.studentId)) continue;
      rows.set(r.studentId, [
        { feeHeadId: head.id, feeHeadName: 'Transport', frequency: FeeFrequency.MONTHLY, amount: riderFee(r.route, r.stop) },
      ]);
    }
    return rows;
  }
}
