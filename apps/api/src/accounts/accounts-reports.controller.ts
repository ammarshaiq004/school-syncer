import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { campusScopeFor, FEE_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dateRange, nextDay } from '../common/date-range.js';
import { dayStart, localDate, localToday, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readBooks } from './books.js';
import { buildPnl, closingSummary, monthDays, twelveMonths, userwise } from './closing.js';
import { moneyScope } from './money-scope.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Closing sheets and profit and loss, from the same books as the cash book. */
@Controller('accounts')
@Permission('accounts')
@Roles(...FEE_ROLES)
@RequiresFeature('accounts')
export class AccountsReportsController {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser) {
    return campusScopeFor(user, FEE_ROLES);
  }

  /** One day's closing: opening balance, money in and out, closing balance, and every line. */
  @Get('closing/daily')
  async daily(@CurrentUser() user: AuthUser, @Query('date', new ZodValidationPipe(day.optional())) date?: string) {
    const d = date ?? localToday();
    const book = await readBooks(this.prisma, user.schoolId, this.scope(user), d, d);
    return { date: d, ...closingSummary(book), rows: book.rows };
  }

  /** A month's closing, day by day (up to today for the current month). */
  @Get('closing/monthly')
  async monthly(@CurrentUser() user: AuthUser, @Query('month', new ZodValidationPipe(month.optional())) m?: string) {
    const today = localToday();
    const key = m ?? today.slice(0, 7);
    const last = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5), 0)).toISOString().slice(0, 10);
    const from = `${key}-01`;
    const to = last < today ? last : today;
    if (from > to) throw new BadRequestException('That month has not started yet');
    const book = await readBooks(this.prisma, user.schoolId, this.scope(user), from, to);
    return { month: key, ...closingSummary(book), days: monthDays(book, from, to) };
  }

  /** Twelve months of profit and loss from `start` (a YYYY-MM; January of this year by default). */
  @Get('pnl/annual')
  async annual(@CurrentUser() user: AuthUser, @Query('start', new ZodValidationPipe(month.optional())) start?: string) {
    const months = twelveMonths(start ?? `${localToday().slice(0, 4)}-01`);
    const from = `${months[0]}-01`;
    const to = new Date(Date.UTC(+months[11].slice(0, 4), +months[11].slice(5), 0)).toISOString().slice(0, 10);
    const { schoolId } = user;
    const money = moneyScope(schoolId, this.scope(user));
    const [payments, entries, payslips] = await Promise.all([
      this.prisma.payment.findMany({
        where: { schoolId, receivedAt: { gte: startOfLocalDay(from), lt: startOfLocalDay(nextDay(to)) }, reversedAt: null, ...money.payments },
        select: { amount: true, receivedAt: true },
      }),
      this.prisma.accountEntry.findMany({
        where: { schoolId, date: { gte: dayStart(from), lte: dayStart(to) }, ...money.entries },
        select: { kind: true, amount: true, date: true, category: { select: { name: true } } },
      }),
      this.prisma.payslip.findMany({
        where: { run: { schoolId }, paidAt: { gte: startOfLocalDay(from), lt: startOfLocalDay(nextDay(to)) }, ...money.payslips },
        select: { net: true, paidAt: true },
      }),
    ]);
    return buildPnl(
      months,
      payments.map((p) => ({ month: localDate(p.receivedAt).slice(0, 7), amount: p.amount })),
      entries.map((e) => ({ month: e.date.toISOString().slice(0, 7), kind: e.kind, category: e.category.name, amount: e.amount })),
      payslips.map((p) => ({ month: localDate(p.paidAt!).slice(0, 7), amount: p.net })),
    );
  }

  /** Profit and loss per user: what each collected and booked in the period. */
  @Get('pnl/users')
  async users(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const { schoolId } = user;
    const money = moneyScope(schoolId, this.scope(user));
    const range = { gte: startOfLocalDay(r.from), lt: startOfLocalDay(nextDay(r.to)) };
    const [payments, entries, payslips] = await Promise.all([
      this.prisma.payment.findMany({
        where: { schoolId, receivedAt: range, reversedAt: null, ...money.payments },
        select: { amount: true, receivedById: true },
      }),
      this.prisma.accountEntry.findMany({
        where: { schoolId, date: { gte: dayStart(r.from), lte: dayStart(r.to) }, ...money.entries },
        select: { kind: true, amount: true, createdById: true },
      }),
      this.prisma.payslip.findMany({
        where: { run: { schoolId }, paidAt: range, ...money.payslips },
        select: { net: true, paidById: true },
      }),
    ]);
    const rows = userwise(
      payments.map((p) => ({ userId: p.receivedById, amount: p.amount })),
      entries.map((e) => ({ userId: e.createdById, kind: e.kind, amount: e.amount })),
      payslips.map((p) => ({ userId: p.paidById, amount: p.net })),
    );
    const names = new Map(
      (await this.prisma.user.findMany({ where: { schoolId, id: { in: rows.flatMap((x) => (x.userId ? [x.userId] : [])) } }, select: { id: true, name: true } })).map(
        (u) => [u.id, u.name],
      ),
    );
    return {
      ...r,
      users: rows.map((x) => ({ ...x, name: x.userId ? (names.get(x.userId) ?? 'Removed user') : 'Online, system and unrecorded' })),
    };
  }
}
