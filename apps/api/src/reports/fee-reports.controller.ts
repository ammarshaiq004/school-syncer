import { Controller, Get, Query } from '@nestjs/common';
import { InvoiceKind, InvoiceLineKind, InvoiceStatus } from '@prisma/client';
import { z } from 'zod';
import { totalsBy } from '../accounts/cashbook.js';
import { moneyScope } from '../accounts/money-scope.js';
import { campusScopeFor, FEE_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dateRange, nextDay } from '../common/date-range.js';
import { dayStart, localDate, localToday, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { familyTotals, fullName, loadFamilies } from '../fees/families.js';
import { allocate } from '../fees/installments.js';
import { OPEN_INVOICE } from '../fees/outstanding.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { discountKind, isAdvance, multiMonth, pct } from './fee-analysis.js';

const ROW_LIMIT = 500;
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** Fee reports beyond collections and outstanding: discounts, advance fees, families, months owed, structure and instalments. */
@Controller('reports/fees')
@Permission('reports')
@RequiresFeature('reports')
@Roles(...FEE_ROLES)
export class FeeReportsController {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser) {
    return campusScopeFor(user, FEE_ROLES);
  }

  private money(user: AuthUser) {
    return moneyScope(user.schoolId, this.scope(user));
  }

  /** Discounts given on vouchers issued in the period: concessions, sibling discounts, fee office discounts and waived fines. */
  @Get('discounts')
  async discounts(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        amount: { lt: 0 },
        kind: { in: [InvoiceLineKind.FEE, InvoiceLineKind.SIBLING_DISCOUNT, InvoiceLineKind.ADJUSTMENT, InvoiceLineKind.LATE_FINE] },
        invoice: {
          schoolId: user.schoolId,
          status: { not: InvoiceStatus.CANCELLED },
          issueDate: { gte: dayStart(r.from), lte: dayStart(r.to) },
          ...this.money(user).invoices,
        },
      },
      orderBy: { amount: 'asc' },
      select: {
        description: true,
        amount: true,
        kind: true,
        reason: true,
        invoice: { select: { voucherNo: true, period: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } } },
      },
    });
    const given = lines.map((l) => ({ ...l, name: discountKind(l)!, off: -l.amount }));
    return {
      ...r,
      total: given.reduce((s, l) => s + l.off, 0),
      count: given.length,
      byKind: totalsBy(given, (l) => l.name, (l) => l.off),
      rows: given.slice(0, ROW_LIMIT).map((l) => ({
        voucherNo: l.invoice.voucherNo,
        period: l.invoice.period,
        student: fullName(l.invoice.student),
        admissionNo: l.invoice.student.admissionNo,
        kind: l.name,
        description: l.description,
        reason: l.reason,
        amount: l.off,
      })),
      truncated: given.length > ROW_LIMIT,
    };
  }

  /** Fees paid ahead: money received in the period for a voucher of a later month. */
  @Get('advance')
  async advance(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const payments = await this.prisma.payment.findMany({
      where: {
        schoolId: user.schoolId,
        reversedAt: null,
        receivedAt: { gte: startOfLocalDay(r.from), lt: startOfLocalDay(nextDay(r.to)) },
        invoice: { period: { gt: r.from.slice(0, 7) } },
        ...this.money(user).payments,
      },
      orderBy: { receivedAt: 'desc' },
      select: {
        amount: true,
        receiptNo: true,
        receivedAt: true,
        invoice: { select: { voucherNo: true, period: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } } },
      },
    });
    const early = payments.filter((p) => isAdvance(p.invoice.period, localDate(p.receivedAt).slice(0, 7)));
    return {
      ...r,
      total: early.reduce((s, p) => s + p.amount, 0),
      count: early.length,
      rows: early.slice(0, ROW_LIMIT).map((p) => ({
        receiptNo: p.receiptNo,
        receivedOn: localDate(p.receivedAt),
        voucherNo: p.invoice.voucherNo,
        period: p.invoice.period,
        student: fullName(p.invoice.student),
        admissionNo: p.invoice.student.admissionNo,
        amount: p.amount,
      })),
      truncated: early.length > ROW_LIMIT,
    };
  }

  /** Students who owe several months at once. */
  @Get('multi-month')
  async multiMonth(@CurrentUser() user: AuthUser, @Query('min', new ZodValidationPipe(z.coerce.number().int().min(2).max(12).default(2))) min: number) {
    const open = await this.prisma.invoice.findMany({
      where: { schoolId: user.schoolId, kind: InvoiceKind.MONTHLY, ...OPEN_INVOICE, ...this.money(user).invoices },
      select: {
        studentId: true,
        period: true,
        total: true,
        paid: true,
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
      },
    });
    const rows = multiMonth(
      open.map((i) => ({ studentId: i.studentId, period: i.period, balance: i.total - i.paid })),
      min,
    );
    const who = new Map(open.map((i) => [i.studentId, i.student]));
    return {
      min,
      students: rows.length,
      total: rows.reduce((s, x) => s + x.balance, 0),
      rows: rows.map((x) => ({
        studentId: x.studentId,
        student: fullName(who.get(x.studentId)!),
        admissionNo: who.get(x.studentId)!.admissionNo,
        months: x.periods.length,
        periods: x.periods,
        balance: x.balance,
      })),
    };
  }

  /** What each family was billed, paid and still owes, for vouchers of the months given (all of them by default). */
  @Get('families')
  async families(
    @CurrentUser() user: AuthUser,
    @Query('from', new ZodValidationPipe(month.optional())) from?: string,
    @Query('to', new ZodValidationPipe(month.optional())) to?: string,
    @Query('owing') owing?: string,
  ) {
    const families = await loadFamilies(this.prisma, user.schoolId, this.scope(user));
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId: user.schoolId,
        ...(from || to ? { period: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...this.money(user).invoices,
      },
      select: { studentId: true, status: true, total: true, paid: true, arrears: true },
    });
    const familyOfStudent = new Map<string, string>();
    for (const f of families.values()) for (const c of f.children) familyOfStudent.set(c.id, f.id);
    const grouped = new Map<string, typeof invoices>();
    for (const i of invoices) {
      const id = familyOfStudent.get(i.studentId);
      if (id) grouped.set(id, [...(grouped.get(id) ?? []), i]);
    }
    const rows = [...grouped.entries()]
      .map(([id, list]) => {
        const f = families.get(id)!;
        return {
          familyId: id,
          guardians: f.guardians.map((g) => g.name).join(', '),
          phone: f.guardians[0]?.phone ?? '',
          children: f.children.map((c) => c.name),
          ...familyTotals(list),
        };
      })
      .filter((r) => (owing === 'true' ? r.balance > 0 : true))
      .sort((a, b) => b.balance - a.balance || a.guardians.localeCompare(b.guardians));
    return {
      families: rows.length,
      billed: rows.reduce((s, r) => s + r.billed, 0),
      paid: rows.reduce((s, r) => s + r.paid, 0),
      balance: rows.reduce((s, r) => s + r.balance, 0),
      rows,
    };
  }

  /** Each class's fee structure against what was billed and collected in an academic year. */
  @Get('structure')
  async structure(@CurrentUser() user: AuthUser, @Query('academicYearId') academicYearId?: string) {
    const { schoolId } = user;
    const scope = this.scope(user);
    const year = await this.prisma.academicYear.findFirst({
      where: { schoolId, ...(academicYearId ? { id: academicYearId } : { isCurrent: true }) },
    });
    if (!year) return { year: null, classes: [], heads: [] };
    const [structures, enrollments, invoices] = await Promise.all([
      this.prisma.feeStructure.findMany({
        where: { schoolId, academicYearId: year.id, class: scope ? { campusId: { in: scope } } : {} },
        include: { feeHead: true, class: { select: { id: true, name: true, campus: { select: { name: true } } } } },
      }),
      this.prisma.enrollment.findMany({
        where: { schoolId, academicYearId: year.id, status: 'ACTIVE', ...(scope ? { student: { campusId: { in: scope } } } : {}) },
        select: { studentId: true, section: { select: { classId: true } } },
      }),
      this.prisma.invoice.findMany({
        where: {
          schoolId,
          kind: InvoiceKind.MONTHLY,
          status: { not: InvoiceStatus.CANCELLED },
          period: { gte: year.startsOn.toISOString().slice(0, 7), lte: year.endsOn.toISOString().slice(0, 7) },
          ...this.money(user).invoices,
        },
        select: { studentId: true, total: true, arrears: true, paid: true },
      }),
    ]);
    const classOf = new Map(enrollments.map((e) => [e.studentId, e.section.classId]));
    const students = new Map<string, number>();
    for (const e of enrollments) students.set(e.section.classId, (students.get(e.section.classId) ?? 0) + 1);
    const money = new Map<string, { billed: number; collected: number }>();
    for (const i of invoices) {
      const c = classOf.get(i.studentId);
      if (!c) continue;
      const row = money.get(c) ?? { billed: 0, collected: 0 };
      row.billed += i.total - i.arrears;
      row.collected += i.paid;
      money.set(c, row);
    }
    const byClass = new Map<string, typeof structures>();
    for (const s of structures) byClass.set(s.classId, [...(byClass.get(s.classId) ?? []), s]);
    const classes = [...byClass.entries()]
      .map(([classId, list]) => {
        const perMonth = list.filter((s) => s.feeHead.frequency === 'MONTHLY').reduce((s, x) => s + x.amount, 0);
        const perYear = perMonth * 12 + list.filter((s) => s.feeHead.frequency === 'ANNUAL').reduce((s, x) => s + x.amount, 0);
        const m = money.get(classId) ?? { billed: 0, collected: 0 };
        const n = students.get(classId) ?? 0;
        return {
          classId,
          name: list[0].class.name,
          campus: list[0].class.campus.name,
          students: n,
          heads: list.map((s) => ({ name: s.feeHead.name, frequency: s.feeHead.frequency, amount: s.amount })),
          perMonth,
          perYear,
          potentialYear: perYear * n,
          billed: m.billed,
          collected: m.collected,
          collectedPct: pct(m.collected, m.billed),
        };
      })
      .sort((a, b) => a.campus.localeCompare(b.campus) || a.name.localeCompare(b.name, 'en', { numeric: true }));
    const heads = totalsBy(
      structures,
      (s) => s.feeHead.name,
      (s) => s.amount * (students.get(s.classId) ?? 0) * (s.feeHead.frequency === 'MONTHLY' ? 12 : 1),
    );
    return { year: { id: year.id, name: year.name }, classes, heads };
  }

  /** Instalments falling due in the period, with how much of each is paid. */
  @Get('installments')
  async installments(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const rows = await this.prisma.installment.findMany({
      where: {
        invoice: { schoolId: user.schoolId, status: { not: InvoiceStatus.CANCELLED }, ...this.money(user).invoices },
        dueDate: { gte: dayStart(r.from), lte: dayStart(r.to) },
      },
      select: { invoiceId: true },
    });
    const plans = await this.prisma.invoice.findMany({
      where: { id: { in: [...new Set(rows.map((x) => x.invoiceId))] } },
      select: {
        id: true,
        voucherNo: true,
        total: true,
        paid: true,
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        installments: { orderBy: { seq: 'asc' } },
      },
    });
    const today = localToday();
    const out = plans.flatMap((p) =>
      allocate(
        p.installments.map((i) => ({ seq: i.seq, dueDate: i.dueDate.toISOString().slice(0, 10), amount: i.amount })),
        p.total,
        p.paid,
        today,
      )
        .filter((a) => a.item.dueDate >= r.from && a.item.dueDate <= r.to)
        .map((a) => ({
          invoiceId: p.id,
          voucherNo: p.voucherNo,
          student: fullName(p.student),
          admissionNo: p.student.admissionNo,
          seq: a.item.seq,
          of: p.installments.length,
          dueDate: a.item.dueDate,
          amount: a.amount,
          paid: a.paid,
          balance: a.balance,
          status: a.status,
        })),
    );
    out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.student.localeCompare(b.student));
    return {
      ...r,
      count: out.length,
      due: out.reduce((s, x) => s + x.amount, 0),
      collected: out.reduce((s, x) => s + x.paid, 0),
      overdue: out.filter((x) => x.status === 'OVERDUE').reduce((s, x) => s + x.balance, 0),
      rows: out,
    };
  }
}
