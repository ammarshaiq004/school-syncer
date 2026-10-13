import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { EntryKind, EntryMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import { adminScope, campusScopeFor, FEE_ROLES, inScope, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dateRange, nextDay } from '../common/date-range.js';
import { dayStart, localDate, localToday, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cashbook, type CashMovement } from './cashbook.js';
import { moneyScope } from './money-scope.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const categorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(EntryKind),
});
const entrySchema = z.object({
  categoryId: z.string().min(1),
  amount: z.number().int().positive().max(100_000_000),
  date: isoDate,
  party: z.string().trim().max(100).optional(),
  method: z.enum(EntryMethod).default(EntryMethod.CASH),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
  /** The campus the money is for; left out, a school-wide entry (or the only campus of a campus-limited user). */
  campusId: z.string().min(1).optional(),
});

/** Campus-limited fee staff keep the books of their own campuses only. */
const booksScope = (user: AuthUser) => campusScopeFor(user, FEE_ROLES);

@Controller('accounts')
@Permission('accounts')
@Roles(...FEE_ROLES)
@RequiresFeature('accounts')
export class AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  categories(@CurrentUser() user: AuthUser) {
    return this.prisma.accountCategory.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  @Post('categories')
  async addCategory(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(categorySchema)) body: z.infer<typeof categorySchema>,
  ) {
    try {
      return await this.prisma.accountCategory.create({ data: { ...body, schoolId: user.schoolId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This category already exists');
      }
      throw e;
    }
  }

  @Get('entries')
  async entries(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('kind') kind?: string,
  ) {
    const r = dateRange(from, to);
    const k = z.enum(EntryKind).optional().safeParse(kind || undefined);
    return this.prisma.accountEntry.findMany({
      where: {
        schoolId: user.schoolId,
        date: { gte: dayStart(r.from), lte: dayStart(r.to) },
        ...moneyScope(user.schoolId, booksScope(user)).entries,
        ...(k.success && k.data ? { kind: k.data } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { category: { select: { name: true } } },
    });
  }

  @Post('entries')
  async addEntry(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(entrySchema)) body: z.infer<typeof entrySchema>,
  ) {
    const category = await this.prisma.accountCategory.findFirst({
      where: { id: body.categoryId, schoolId: user.schoolId },
    });
    if (!category) throw new NotFoundException('Category not found');
    if (body.date > localToday()) throw new ConflictException('An entry cannot be dated in the future');
    const scope = booksScope(user);
    const campusId = body.campusId ?? (scope?.length === 1 ? scope[0] : undefined);
    if (scope && !campusId) throw new BadRequestException('Choose the campus this entry is for');
    if (campusId) {
      const campus = await this.prisma.campus.count({ where: { id: campusId, schoolId: user.schoolId } });
      if (!campus) throw new NotFoundException('Campus not found');
      if (!inScope(scope, campusId)) throw new ForbiddenException('That campus is not yours to manage');
    }
    const entry = await this.prisma.accountEntry.create({
      data: {
        ...body,
        campusId: campusId ?? null,
        schoolId: user.schoolId,
        kind: category.kind,
        date: dayStart(body.date),
        createdById: user.sub,
      },
      include: { category: { select: { name: true } } },
    });
    await this.audit.record(user, 'create', 'AccountEntry', entry.id, { after: entry });
    return entry;
  }

  /** Only administrators can remove an entry; the audit log keeps what it was. */
  @Delete('entries/:id')
  @Roles(...SETUP_ROLES)
  async removeEntry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const entry = await this.prisma.accountEntry.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (!inScope(adminScope(user), entry.campusId)) {
      throw new ForbiddenException('Only school-wide administrators can remove this entry');
    }
    await this.prisma.accountEntry.delete({ where: { id } });
    await this.audit.record(user, 'delete', 'AccountEntry', id, { before: entry });
    return { deleted: true };
  }

  /**
   * Every rupee in and out: fee collections (one line per day and method),
   * salaries paid, and other income and expenses, with a running balance.
   */
  @Get('cashbook')
  async cashbook(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const r = dateRange(from, to);
    const start = startOfLocalDay(r.from);
    const end = startOfLocalDay(nextDay(r.to));
    const schoolId = user.schoolId;
    const money = moneyScope(schoolId, booksScope(user));

    const [feesBefore, entriesBefore, salariesBefore, payments, entries, payslips] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { schoolId, receivedAt: { lt: start }, reversedAt: null, ...money.payments },
        _sum: { amount: true },
      }),
      this.prisma.accountEntry.groupBy({
        by: ['kind'],
        where: { schoolId, date: { lt: dayStart(r.from) }, ...money.entries },
        _sum: { amount: true },
      }),
      this.prisma.payslip.aggregate({
        where: { run: { schoolId }, paidAt: { lt: start }, ...money.payslips },
        _sum: { net: true },
      }),
      this.prisma.payment.findMany({
        where: { schoolId, receivedAt: { gte: start, lt: end }, reversedAt: null, ...money.payments },
        select: { amount: true, method: true, receivedAt: true },
      }),
      this.prisma.accountEntry.findMany({
        where: { schoolId, date: { gte: dayStart(r.from), lte: dayStart(r.to) }, ...money.entries },
        include: { category: { select: { name: true } } },
      }),
      this.prisma.payslip.findMany({
        where: { run: { schoolId }, paidAt: { gte: start, lt: end }, ...money.payslips },
        include: { user: { select: { name: true } }, run: { select: { period: true } } },
      }),
    ]);

    const sumKind = (kind: EntryKind) => entriesBefore.find((e) => e.kind === kind)?._sum.amount ?? 0;
    const opening =
      (feesBefore._sum.amount ?? 0) +
      sumKind(EntryKind.INCOME) -
      sumKind(EntryKind.EXPENSE) -
      (salariesBefore._sum.net ?? 0);

    // Fee receipts are many and small, so the book shows one line per day and method.
    const feeDays = new Map<string, { date: string; method: string; amount: number; count: number }>();
    for (const p of payments) {
      const date = localDate(p.receivedAt);
      const key = `${date}|${p.method}`;
      const row = feeDays.get(key) ?? { date, method: p.method, amount: 0, count: 0 };
      row.amount += p.amount;
      row.count += 1;
      feeDays.set(key, row);
    }

    const movements: CashMovement[] = [
      ...[...feeDays.values()].map((f) => ({
        date: f.date,
        flow: 'IN' as const,
        amount: f.amount,
        source: 'FEES' as const,
        description: `Fee collections (${f.count} receipt${f.count === 1 ? '' : 's'})`,
        method: f.method,
      })),
      ...entries.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        flow: e.kind === EntryKind.INCOME ? ('IN' as const) : ('OUT' as const),
        amount: e.amount,
        source: 'ENTRY' as const,
        description: [e.category.name, e.party].filter(Boolean).join(': '),
        method: e.method,
        reference: e.reference,
      })),
      ...payslips.map((p) => ({
        date: localDate(p.paidAt!),
        flow: 'OUT' as const,
        amount: p.net,
        source: 'SALARY' as const,
        description: `Salary ${p.run.period}: ${p.user.name}`,
        method: p.paymentMethod ?? 'BANK',
      })),
    ];
    return { from: r.from, to: r.to, ...cashbook(opening, movements) };
  }
}
