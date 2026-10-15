import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { EntryKind } from '@prisma/client';
import { z } from 'zod';
import { totalsBy } from '../accounts/cashbook.js';
import { moneyScope } from '../accounts/money-scope.js';
import { adminScope, campusScopeFor, FEE_ROLES, SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dateRange, nextDay } from '../common/date-range.js';
import { dayStart, localDate, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { feeOutstanding, OPEN_INVOICE } from '../fees/outstanding.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ADJUSTMENTS,
  ARREARS,
  attendanceGrid,
  feeTotals,
  LATE_FINE,
  splitPayments,
  UNMATCHED,
  voucherBuckets,
  voucherTotals,
  type FeeRow,
} from './parallel-run.js';

/** The parallel-run reports cover a pilot month; a quarter is the most one page shows. */
const MAX_PARALLEL_DAYS = 93;

function parallelRange(from?: string, to?: string) {
  const r = dateRange(from, to);
  if ((dayStart(r.to).getTime() - dayStart(r.from).getTime()) / 86_400_000 >= MAX_PARALLEL_DAYS) {
    throw new BadRequestException(`Choose at most ${MAX_PARALLEL_DAYS} days`);
  }
  return r;
}

interface SectionWithCampus {
  name: string;
  class: { name: string; campus: { name: string } };
}

/** "Grade 3 A", or "Grade 3 A, Johar Town campus" when campuses share class names. */
const sectionName = (section: SectionWithCampus, withCampus: boolean) =>
  `${section.class.name} ${section.name}${withCampus ? `, ${section.class.campus.name}` : ''}`;

const className = (withCampus: boolean, e?: { section: SectionWithCampus }) =>
  e ? sectionName(e.section, withCampus) : 'Not enrolled';

const sectionSelect = {
  select: { name: true, class: { select: { name: true, campus: { select: { name: true } } } } },
} as const;

@Controller('reports')
@Permission('reports')
@RequiresFeature('reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  private async hasCampuses(schoolId: string) {
    return (await this.prisma.campus.count({ where: { schoolId } })) > 1;
  }

  /** The money reports cover only the campuses of campus-limited fee staff. */
  private money(user: AuthUser) {
    return moneyScope(user.schoolId, campusScopeFor(user, FEE_ROLES));
  }

  /** Income and expenditure for a period: fees, other income, expenses by category and salaries. */
  @Get('income-expense')
  @Roles(...FEE_ROLES)
  async incomeExpense(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const start = startOfLocalDay(r.from);
    const end = startOfLocalDay(nextDay(r.to));
    const money = this.money(user);
    const [fees, entries, salaries] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { schoolId: user.schoolId, receivedAt: { gte: start, lt: end }, reversedAt: null, ...money.payments },
        _sum: { amount: true },
      }),
      this.prisma.accountEntry.findMany({
        where: { schoolId: user.schoolId, date: { gte: dayStart(r.from), lte: dayStart(r.to) }, ...money.entries },
        include: { category: { select: { name: true } } },
      }),
      this.prisma.payslip.aggregate({
        where: { run: { schoolId: user.schoolId }, paidAt: { gte: start, lt: end }, ...money.payslips },
        _sum: { net: true },
      }),
    ]);
    const income = [
      { name: 'Fees', total: fees._sum.amount ?? 0 },
      ...totalsBy(
        entries.filter((e) => e.kind === EntryKind.INCOME),
        (e) => e.category.name,
        (e) => e.amount,
      ),
    ];
    const expenses = [
      { name: 'Salaries', total: salaries._sum.net ?? 0 },
      ...totalsBy(
        entries.filter((e) => e.kind === EntryKind.EXPENSE),
        (e) => e.category.name,
        (e) => e.amount,
      ),
    ]
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total);
    const totalIncome = income.reduce((s, i) => s + i.total, 0);
    const totalExpenses = expenses.reduce((s, i) => s + i.total, 0);
    return { ...r, income, expenses, totalIncome, totalExpenses, surplus: totalIncome - totalExpenses };
  }

  /** Fee collections for a period by day, by payment method and by class. */
  @Get('fee-collection')
  @Roles(...FEE_ROLES)
  async feeCollection(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const withCampus = await this.hasCampuses(user.schoolId);
    const payments = await this.prisma.payment.findMany({
      where: {
        schoolId: user.schoolId,
        receivedAt: { gte: startOfLocalDay(r.from), lt: startOfLocalDay(nextDay(r.to)) },
        // A reversed payment is not money received.
        reversedAt: null,
        ...this.money(user).payments,
      },
      include: {
        invoice: {
          select: {
            student: {
              select: {
                enrollments: {
                  where: { status: 'ACTIVE' },
                  select: { section: sectionSelect },
                },
              },
            },
          },
        },
      },
    });
    return {
      ...r,
      total: payments.reduce((s, p) => s + p.amount, 0),
      receipts: payments.length,
      byDay: totalsBy(payments, (p) => localDate(p.receivedAt), (p) => p.amount).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      byMethod: totalsBy(payments, (p) => p.method, (p) => p.amount),
      byClass: totalsBy(payments, (p) => className(withCampus, p.invoice.student.enrollments[0]), (p) => p.amount),
    };
  }

  /** Unpaid and part-paid fees by class, with the families who owe the most. */
  @Get('outstanding')
  @Roles(...FEE_ROLES)
  async outstanding(@CurrentUser() user: AuthUser) {
    const withCampus = await this.hasCampuses(user.schoolId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId: user.schoolId,
        ...OPEN_INVOICE,
        ...this.money(user).invoices,
      },
      select: {
        total: true,
        paid: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              select: { section: sectionSelect },
            },
          },
        },
      },
    });
    const balance = (i: { total: number; paid: number }) => i.total - i.paid;
    const byStudent = new Map<string, { id: string; name: string; admissionNo: string; class: string; balance: number; invoices: number }>();
    for (const i of invoices) {
      const s = i.student;
      const row = byStudent.get(s.id) ?? {
        id: s.id,
        name: [s.firstName, s.lastName].filter(Boolean).join(' '),
        admissionNo: s.admissionNo,
        class: className(withCampus, s.enrollments[0]),
        balance: 0,
        invoices: 0,
      };
      row.balance += balance(i);
      row.invoices += 1;
      byStudent.set(s.id, row);
    }
    const students = [...byStudent.values()].sort((a, b) => b.balance - a.balance);
    // The same figure as /fees/outstanding and the dashboard.
    const owed = await feeOutstanding(this.prisma, { schoolId: user.schoolId, ...this.money(user).invoices });
    return {
      total: owed.outstanding.amount,
      byClass: totalsBy(students, (s) => s.class, (s) => s.balance),
      students,
    };
  }

  /** Each section's attendance for a month, and the students below the threshold. */
  @Get('attendance')
  @Roles(...SETUP_ROLES)
  async attendance(
    @CurrentUser() user: AuthUser,
    @Query('month', new ZodValidationPipe(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'))) month: string,
    @Query('threshold') threshold?: string,
  ) {
    const limit = Math.min(100, Math.max(0, Number(threshold) || 75));
    const start = dayStart(`${month}-01`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const scope = adminScope(user);
    const withCampus = (scope?.length ?? 2) > 1 && (await this.hasCampuses(user.schoolId));
    const sessions = await this.prisma.attendanceSession.findMany({
      where: {
        schoolId: user.schoolId,
        date: { gte: start, lt: end },
        ...(scope ? { section: { class: { campusId: { in: scope } } } } : {}),
      },
      include: {
        section: {
          select: {
            id: true,
            name: true,
            class: { select: { name: true, sortOrder: true, campus: { select: { name: true } } } },
          },
        },
        records: {
          select: {
            status: true,
            student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
          },
        },
      },
    });

    const present = (s: string) => s === 'PRESENT' || s === 'LATE';
    const sections = new Map<string, { sectionId: string; name: string; sort: number; days: number; marks: number; present: number }>();
    const students = new Map<string, { id: string; name: string; admissionNo: string; class: string; days: number; present: number }>();
    for (const session of sessions) {
      const name = sectionName(session.section, withCampus);
      const sec = sections.get(session.section.id) ?? {
        sectionId: session.section.id,
        name,
        sort: session.section.class.sortOrder,
        days: 0,
        marks: 0,
        present: 0,
      };
      sec.days += 1;
      for (const r of session.records) {
        sec.marks += 1;
        if (present(r.status)) sec.present += 1;
        const st = students.get(r.student.id) ?? {
          id: r.student.id,
          name: [r.student.firstName, r.student.lastName].filter(Boolean).join(' '),
          admissionNo: r.student.admissionNo,
          class: name,
          days: 0,
          present: 0,
        };
        st.days += 1;
        if (present(r.status)) st.present += 1;
        students.set(r.student.id, st);
      }
      sections.set(session.section.id, sec);
    }
    const pct = (p: number, of: number) => (of ? Math.round((p / of) * 1000) / 10 : 0);
    return {
      month,
      threshold: limit,
      sections: [...sections.values()]
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
        .map(({ sort: _sort, ...s }) => ({ ...s, percent: pct(s.present, s.marks) })),
      lowAttendance: [...students.values()]
        .map((s) => ({ ...s, percent: pct(s.present, s.days) }))
        .filter((s) => s.percent < limit)
        .sort((a, b) => a.percent - b.percent),
    };
  }

  /**
   * Parallel run (SCHOOL-150): fees collected per day and payment method, per
   * method and per fee head, to tick off against the old fee register.
   * Reversed payments are left out. Each payment is split across its
   * voucher's heads in the order they are settled (see voucherBuckets).
   */
  @Get('parallel-run/fees')
  @Roles(...FEE_ROLES)
  async parallelFees(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = parallelRange(from, to);
    const payments = await this.prisma.payment.findMany({
      where: {
        schoolId: user.schoolId,
        receivedAt: { gte: startOfLocalDay(r.from), lt: startOfLocalDay(nextDay(r.to)) },
        reversedAt: null,
        ...this.money(user).payments,
      },
      select: { id: true, amount: true, method: true, receivedAt: true, invoiceId: true },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    const invoices = await this.prisma.invoice.findMany({
      where: { schoolId: user.schoolId, id: { in: [...new Set(payments.map((p) => p.invoiceId))] } },
      select: {
        id: true,
        lines: {
          select: { feeHeadId: true, description: true, amount: true, kind: true, feeHead: { select: { name: true } } },
          orderBy: { id: 'asc' },
        },
        // Every counted payment on the voucher, also those before the range: a
        // payment's split depends on what was paid before it.
        payments: {
          where: { reversedAt: null },
          select: { id: true, amount: true },
          orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const names = new Map<string, string>(
      [ARREARS, LATE_FINE, ADJUSTMENTS, UNMATCHED].map((b) => [b.key, b.name]),
    );
    const splits = new Map<string, Map<string, number>>();
    for (const inv of invoices) {
      const buckets = voucherBuckets(
        inv.lines.map((l) => ({ ...l, feeHeadName: l.feeHead?.name ?? null })),
      );
      for (const b of buckets) names.set(b.key, b.name);
      for (const [paymentId, split] of splitPayments(buckets, inv.payments)) splits.set(paymentId, split);
    }
    const rows: FeeRow[] = payments.map((p) => ({
      date: localDate(p.receivedAt),
      method: p.method,
      amount: p.amount,
      heads: splits.get(p.id) ?? new Map([[UNMATCHED.key, p.amount]]),
    }));
    return { ...r, ...feeTotals(rows, names) };
  }

  /** Parallel run: vouchers issued in the dates (by issue date) against how many are paid. */
  @Get('parallel-run/vouchers')
  @Roles(...FEE_ROLES)
  async parallelVouchers(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = parallelRange(from, to);
    const withCampus = await this.hasCampuses(user.schoolId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId: user.schoolId,
        issueDate: { gte: dayStart(r.from), lte: dayStart(r.to) },
        ...this.money(user).invoices,
      },
      select: {
        status: true,
        total: true,
        paid: true,
        period: true,
        student: {
          select: { enrollments: { where: { status: 'ACTIVE' }, select: { section: sectionSelect } } },
        },
      },
    });
    return {
      ...r,
      ...voucherTotals(
        invoices.map((i) => ({ ...i, className: className(withCampus, i.student.enrollments[0]) })),
      ),
    };
  }

  /**
   * Parallel run: attendance marked per section per day, with the share
   * present, to compare with the class registers. Admins limited to some
   * campuses see only those.
   */
  @Get('parallel-run/attendance')
  @Roles(...SETUP_ROLES)
  async parallelAttendance(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = parallelRange(from, to);
    const scope = adminScope(user);
    const withCampus = (scope?.length ?? 2) > 1 && (await this.hasCampuses(user.schoolId));
    const where = {
      schoolId: user.schoolId,
      date: { gte: dayStart(r.from), lte: dayStart(r.to) },
      ...(scope ? { section: { class: { campusId: { in: scope } } } } : {}),
    };
    const [sessions, counts] = await Promise.all([
      this.prisma.attendanceSession.findMany({
        where,
        select: {
          id: true,
          date: true,
          section: {
            select: {
              id: true,
              name: true,
              class: { select: { name: true, sortOrder: true, campus: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.attendanceRecord.groupBy({ by: ['sessionId', 'status'], where: { session: where }, _count: true }),
    ]);
    const tally = new Map<string, { present: number; marked: number }>();
    for (const c of counts) {
      const t = tally.get(c.sessionId) ?? { present: 0, marked: 0 };
      t.marked += c._count;
      if (c.status === 'PRESENT' || c.status === 'LATE') t.present += c._count;
      tally.set(c.sessionId, t);
    }
    return {
      ...r,
      ...attendanceGrid(
        sessions.map((s) => ({
          sectionId: s.section.id,
          name: sectionName(s.section, withCampus),
          sort: s.section.class.sortOrder,
          date: s.date.toISOString().slice(0, 10),
          ...(tally.get(s.id) ?? { present: 0, marked: 0 }),
        })),
      ),
    };
  }
}
