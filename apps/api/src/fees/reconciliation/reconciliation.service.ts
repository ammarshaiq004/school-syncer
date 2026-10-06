import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CheckoutStatus,
  PaymentMethod,
  Prisma,
  ReconciliationIssueKind as Kind,
  ReconciliationIssueStatus,
  ReconciliationStatus,
  type OnlinePayment,
} from '@prisma/client';
import { dayStart, daysBefore, localDate, localToday, startOfLocalDay } from '../../common/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OnlinePaymentsService, type OnlineProvider } from '../online-payments.service.js';
import { parseStatement } from './statement.js';

/** Days of open checkouts the nightly sweep keeps asking the gateways about. */
const LOOKBACK_DAYS = 7;
/** A wallet checkout this young may still have the parent on the gateway's page. */
const SWEEP_AFTER_MS = 15 * 60_000;
/** After its expiry, how long a checkout gets before the gateway's "not paid" is final. */
const EXPIRY_GRACE_MS = 60 * 60_000;
/** Most days one statement may cover, so one upload can't trigger months of re-runs. */
const MAX_STATEMENT_DAYS = 62;

const nextDay = (iso: string) => daysBefore(iso, -1);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const rupees = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

const PROVIDER_LABEL: Record<OnlineProvider, string> = { JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', ONEBILL: '1Bill' };

interface Finding {
  kind: Kind;
  provider: OnlineProvider;
  reference: string;
  amount?: number;
  detail: string;
  onlinePaymentId?: string;
  statementLineId?: string;
}

type Totals = Partial<
  Record<OnlineProvider, { books: { count: number; amount: number }; statement: { count: number; amount: number } | null }>
>;

type Trigger = 'auto' | 'manual' | 'statement';

/**
 * Daily reconciliation of online fee payments (SCHOOL-78). For one school and
 * one day it:
 *
 * 1. asks the gateways about checkouts still open, so payments whose return
 *    never reached us are recorded and abandoned ones are closed;
 * 2. checks that every paid checkout has the receipt it should, and lists
 *    money held for review;
 * 3. when the fee office has uploaded the gateway's statement for that day,
 *    matches it line by line against the receipts, both ways.
 *
 * Anything a person has to look at becomes a ReconciliationIssue.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly online: OnlinePaymentsService,
  ) {}

  /**
   * The nightly job: reconciles the last three finished days for every school
   * with recent online payments, skipping days that already have a run. A
   * run row is claimed before the work starts, so two servers never both do it.
   */
  async runDue(now = new Date()): Promise<number> {
    const today = localDate(now);
    let ran = 0;
    for (const date of [daysBefore(today, 3), daysBefore(today, 2), daysBefore(today, 1)]) {
      const since = startOfLocalDay(daysBefore(date, LOOKBACK_DAYS));
      const schools = await this.prisma.onlinePayment.findMany({
        where: { OR: [{ createdAt: { gte: since, lt: startOfLocalDay(nextDay(date)) } }, { status: CheckoutStatus.PENDING }] },
        distinct: ['schoolId'],
        select: { schoolId: true },
      });
      for (const { schoolId } of schools) {
        try {
          await this.prisma.paymentReconciliation.create({ data: { schoolId, date: dayStart(date), trigger: 'auto' } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
          throw error;
        }
        await this.reconcile(schoolId, date, { trigger: 'auto' });
        ran++;
      }
    }
    return ran;
  }

  /** Reconciles one school's day (again). Safe to repeat. */
  async reconcile(schoolId: string, date: string, opts: { trigger: Trigger; userId?: string; sweep?: boolean }) {
    if (date >= localToday()) throw new BadRequestException('Only finished days can be reconciled.');
    const run = await this.prisma.paymentReconciliation.upsert({
      where: { schoolId_date: { schoolId, date: dayStart(date) } },
      create: { schoolId, date: dayStart(date), trigger: opts.trigger, ranById: opts.userId ?? null },
      update: {
        status: ReconciliationStatus.RUNNING,
        trigger: opts.trigger,
        ranById: opts.userId ?? null,
        error: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    });
    try {
      const settled = opts.sweep === false ? 0 : await this.sweep(schoolId);
      const { findings, checked, totals } = await this.check(schoolId, date);
      const openIssues = await this.record(schoolId, date, findings);
      return await this.prisma.paymentReconciliation.update({
        where: { id: run.id },
        data: {
          status: openIssues ? ReconciliationStatus.ISSUES : ReconciliationStatus.CLEAN,
          checked,
          settled,
          totals: totals as Prisma.InputJsonValue,
          openIssues,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Reconciliation of ${date} for school ${schoolId} failed: ${(error as Error).message}`);
      await this.prisma.paymentReconciliation.update({
        where: { id: run.id },
        data: { status: ReconciliationStatus.FAILED, error: (error as Error).message.slice(0, 300), finishedAt: new Date() },
      });
      throw error;
    }
  }

  /**
   * Settles open checkouts: asks JazzCash and Easypaisa about each one, and
   * closes those past their expiry that the gateway says were never paid (or
   * that no gateway can be asked about: 1Bill numbers and mock mode). A
   * closed checkout can still be paid by a late gateway answer.
   */
  async sweep(schoolId: string, now = new Date()): Promise<number> {
    const open = await this.prisma.onlinePayment.findMany({
      where: {
        schoolId,
        status: CheckoutStatus.PENDING,
        createdAt: { gte: startOfLocalDay(daysBefore(localDate(now), LOOKBACK_DAYS)), lt: new Date(now.getTime() - SWEEP_AFTER_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const mode = this.online.config.mode;
    let settled = 0;
    for (const checkout of open) {
      const askable = (mode === 'sandbox' || mode === 'live') && checkout.provider !== PaymentMethod.ONEBILL;
      const after = askable ? await this.online.refresh(checkout) : null;
      if (after && after.status !== CheckoutStatus.PENDING) {
        settled++;
        continue;
      }
      const overdue = checkout.expiresAt.getTime() + EXPIRY_GRACE_MS < now.getTime();
      // An unanswered inquiry decides nothing: STILL_PENDING flags it instead.
      if (!overdue || (askable && !after)) continue;
      const closed = await this.prisma.onlinePayment.updateMany({
        where: { id: checkout.id, status: CheckoutStatus.PENDING },
        data: {
          status: CheckoutStatus.FAILED,
          message: askable ? 'Timed out: the gateway reports no payment.' : 'Timed out without a payment.',
        },
      });
      settled += closed.count;
    }
    return settled;
  }

  private async check(schoolId: string, date: string) {
    const from = startOfLocalDay(date);
    const to = startOfLocalDay(nextDay(date));
    const now = Date.now();
    const findings: Finding[] = [];

    const started = await this.prisma.onlinePayment.findMany({
      where: { schoolId, createdAt: { gte: from, lt: to } },
      include: { payment: true },
    });
    for (const c of started) {
      const provider = c.provider as OnlineProvider;
      const base = { provider, reference: c.txnRef, amount: c.amount, onlinePaymentId: c.id };
      if (c.status === CheckoutStatus.REVIEW) {
        findings.push({ ...base, kind: Kind.NEEDS_REVIEW, detail: c.message ?? 'Money was taken but not applied to the voucher.' });
      } else if (c.status === CheckoutStatus.PAID) {
        const p = c.payment;
        if (!p) findings.push({ ...base, kind: Kind.RECEIPT_MISMATCH, detail: 'Marked paid but has no receipt.' });
        else if (p.amount !== c.amount || p.method !== c.provider) {
          findings.push({
            ...base,
            kind: Kind.RECEIPT_MISMATCH,
            detail: `Receipt ${p.receiptNo} is ${rupees(p.amount)} by ${p.method} for a ${PROVIDER_LABEL[provider]} checkout of ${rupees(c.amount)}.`,
          });
        }
      } else if (c.status === CheckoutStatus.PENDING && c.expiresAt.getTime() + EXPIRY_GRACE_MS < now) {
        findings.push({
          ...base,
          kind: Kind.STILL_PENDING,
          detail: `${PROVIDER_LABEL[provider]} has not confirmed whether this was paid. Check it in the merchant portal.`,
        });
      }
    }

    // Receipts issued that day for online checkouts: what the gateways should show.
    const paid = await this.prisma.onlinePayment.findMany({
      where: { schoolId, status: CheckoutStatus.PAID, payment: { receivedAt: { gte: from, lt: to } } },
      include: { payment: true },
    });
    const totals: Totals = {};
    for (const c of paid) {
      const t = (totals[c.provider as OnlineProvider] ??= { books: { count: 0, amount: 0 }, statement: null });
      t.books.count++;
      t.books.amount += c.payment!.amount;
    }

    const statements = await this.prisma.gatewayStatement.findMany({
      where: { schoolId, fromDate: { lte: dayStart(date) }, toDate: { gte: dayStart(date) } },
      select: { provider: true },
    });
    for (const provider of new Set(statements.map((s) => s.provider as OnlineProvider))) {
      findings.push(...(await this.matchStatement(schoolId, provider, date, paid, totals)));
    }
    return { findings, checked: started.length, totals };
  }

  /** Matches the statement lines of one gateway and day against our checkouts, both ways. */
  private async matchStatement(
    schoolId: string,
    provider: OnlineProvider,
    date: string,
    paidThatDay: (OnlinePayment & { payment: { amount: number; receiptNo: string } | null })[],
    totals: Totals,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const lines = await this.prisma.gatewayStatementLine.findMany({ where: { schoolId, provider, date: dayStart(date) } });
    const t = (totals[provider] ??= { books: { count: 0, amount: 0 }, statement: null });
    t.statement = { count: lines.length, amount: lines.reduce((s, l) => s + l.amount, 0) };

    const refs = [...new Set(lines.flatMap((l) => [l.reference, l.providerRef].filter((r): r is string => !!r)))];
    const candidates = refs.length
      ? await this.prisma.onlinePayment.findMany({
          where: {
            schoolId,
            provider,
            OR: [{ txnRef: { in: refs } }, { consumerNumber: { in: refs } }, { providerRef: { in: refs } }],
          },
        })
      : [];
    const byRef = new Map<string, OnlinePayment>();
    for (const c of candidates) for (const r of [c.txnRef, c.consumerNumber, c.providerRef]) if (r) byRef.set(r, c);
    // Online money the counter typed in by hand (e.g. a transfer to the school's wallet) is in the books too.
    const counter = refs.length
      ? await this.prisma.payment.findMany({ where: { schoolId, method: provider, reference: { in: refs }, checkout: null } })
      : [];
    const counterRefs = new Map(counter.map((p) => [p.reference!, p]));

    for (const line of lines) {
      const c = byRef.get(line.reference) ?? (line.providerRef ? byRef.get(line.providerRef) : undefined);
      if (c && c.id !== line.onlinePaymentId) {
        await this.prisma.gatewayStatementLine.update({ where: { id: line.id }, data: { onlinePaymentId: c.id } });
      }
      const base = { provider, reference: line.providerRef ?? line.reference, amount: line.amount, statementLineId: line.id };
      if (!c) {
        const manual = counterRefs.get(line.reference) ?? (line.providerRef ? counterRefs.get(line.providerRef) : undefined);
        if (manual && manual.amount === line.amount) continue;
        findings.push({
          ...base,
          reference: line.reference,
          kind: manual ? Kind.AMOUNT_MISMATCH : Kind.NOT_IN_BOOKS,
          detail: manual
            ? `The statement shows ${rupees(line.amount)}; receipt ${manual.receiptNo} is for ${rupees(manual.amount)}.`
            : `${PROVIDER_LABEL[provider]} collected ${rupees(line.amount)} for reference ${line.reference}, which matches no online checkout or receipt.`,
        });
      } else if (c.status === CheckoutStatus.REVIEW) {
        // Already listed as needing review.
      } else if (c.status !== CheckoutStatus.PAID) {
        findings.push({
          ...base,
          reference: c.txnRef,
          onlinePaymentId: c.id,
          kind: Kind.NOT_IN_BOOKS,
          detail: `${PROVIDER_LABEL[provider]} collected ${rupees(line.amount)} but this checkout is ${c.status === CheckoutStatus.FAILED ? 'marked failed' : 'still waiting'}, so no receipt was issued.`,
        });
      } else if (c.amount !== line.amount) {
        findings.push({
          ...base,
          reference: c.txnRef,
          onlinePaymentId: c.id,
          kind: Kind.AMOUNT_MISMATCH,
          detail: `The statement shows ${rupees(line.amount)}; the receipt is for ${rupees(c.amount)}.`,
        });
      }
    }

    // Each receipt of the day should be somewhere on this gateway's statements (a payment near
    // midnight can land on the next day's line, so any covering statement counts).
    const ours = paidThatDay.filter((c) => c.provider === provider);
    if (ours.length) {
      const near = await this.prisma.gatewayStatementLine.findMany({
        where: { schoolId, provider, date: { gte: dayStart(daysBefore(date, 1)), lte: dayStart(nextDay(date)) } },
      });
      const onLine = (c: OnlinePayment) =>
        near.some(
          (l) =>
            l.onlinePaymentId === c.id ||
            l.reference === c.txnRef ||
            (!!c.consumerNumber && l.reference === c.consumerNumber) ||
            (!!c.providerRef && (l.providerRef === c.providerRef || l.reference === c.providerRef)),
        );
      const listed = new Set(ours.filter(onLine).map((c) => c.id));
      for (const c of ours) {
        if (listed.has(c.id)) continue;
        findings.push({
          kind: Kind.NOT_IN_STATEMENT,
          provider,
          reference: c.txnRef,
          amount: c.amount,
          onlinePaymentId: c.id,
          detail: `Receipt ${c.payment?.receiptNo ?? ''} for ${rupees(c.amount)} is not on the ${PROVIDER_LABEL[provider]} statement. Confirm the money arrived before treating the voucher as paid.`,
        });
      }
    }
    return findings;
  }

  /**
   * Saves a run's findings as issues and clears the day's open ones that no
   * longer apply. Returns how many are open for the day.
   */
  private async record(schoolId: string, date: string, findings: Finding[]): Promise<number> {
    const day = dayStart(date);
    const keys = new Set<string>();
    for (const f of findings) {
      const key = `${f.kind}:${f.provider}:${f.reference}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const data = {
        date: day,
        kind: f.kind,
        provider: f.provider as PaymentMethod,
        reference: f.reference,
        amount: f.amount ?? null,
        detail: f.detail,
        onlinePaymentId: f.onlinePaymentId ?? null,
        statementLineId: f.statementLineId ?? null,
      };
      const existing = await this.prisma.reconciliationIssue.findUnique({ where: { schoolId_key: { schoolId, key } } });
      if (!existing) await this.prisma.reconciliationIssue.create({ data: { ...data, schoolId, key } });
      // A person's "resolved" stands; only an open issue is refreshed.
      else if (existing.status === ReconciliationIssueStatus.OPEN) {
        await this.prisma.reconciliationIssue.update({ where: { id: existing.id }, data });
      }
    }
    await this.prisma.reconciliationIssue.updateMany({
      where: { schoolId, date: day, status: ReconciliationIssueStatus.OPEN, key: { notIn: [...keys] } },
      data: { status: ReconciliationIssueStatus.RESOLVED, resolvedAt: new Date(), note: 'Cleared when reconciliation ran again.' },
    });
    return this.prisma.reconciliationIssue.count({ where: { schoolId, date: day, status: ReconciliationIssueStatus.OPEN } });
  }

  // ----- Statements -----

  /**
   * Imports a gateway statement and reconciles every day it covers. Lines
   * from earlier statements of the same gateway for those days are replaced,
   * so uploading a corrected report twice does not double it.
   */
  async importStatement(schoolId: string, userId: string, input: { provider: OnlineProvider; fileName: string; grid: string[][] }) {
    let parsed;
    try {
      parsed = parseStatement(input.grid);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    if (!parsed.rows.length || !parsed.fromDate || !parsed.toDate) {
      throw new BadRequestException(
        parsed.errors.length
          ? `No transactions could be read. First problem, row ${parsed.errors[0].row}: ${parsed.errors[0].message}.`
          : 'The file has no successful transactions.',
      );
    }
    const today = localToday();
    const toDate = parsed.toDate >= today ? daysBefore(today, 1) : parsed.toDate;
    const rows = parsed.rows.filter((r) => r.date <= toDate);
    if (!rows.length) throw new BadRequestException("The statement only covers today, which can't be reconciled until it is over.");
    const days = Math.round((dayStart(toDate).getTime() - dayStart(parsed.fromDate).getTime()) / 86_400_000) + 1;
    if (days > MAX_STATEMENT_DAYS) {
      throw new BadRequestException(`A statement can cover at most ${MAX_STATEMENT_DAYS} days; this one covers ${days}. Split it by month.`);
    }

    const statement = await this.prisma.$transaction(async (tx) => {
      await tx.gatewayStatementLine.deleteMany({
        where: { schoolId, provider: input.provider, date: { gte: dayStart(parsed.fromDate!), lte: dayStart(toDate) } },
      });
      return tx.gatewayStatement.create({
        data: {
          schoolId,
          provider: input.provider,
          fileName: input.fileName.slice(0, 200),
          fromDate: dayStart(parsed.fromDate!),
          toDate: dayStart(toDate),
          rows: rows.length,
          matched: 0,
          uploadedById: userId,
          lines: {
            create: rows.map((r) => ({
              schoolId,
              provider: input.provider,
              date: dayStart(r.date),
              reference: r.reference.slice(0, 80),
              providerRef: r.providerRef?.slice(0, 80) ?? null,
              amount: r.amount,
            })),
          },
        },
      });
    });

    // The day before is re-checked too when it was reconciled: its late-night receipts may be on this statement.
    const before = daysBefore(parsed.fromDate, 1);
    const hadBefore = await this.prisma.paymentReconciliation.findUnique({ where: { schoolId_date: { schoolId, date: dayStart(before) } } });
    const runs = [];
    for (let d = hadBefore ? before : parsed.fromDate, first = true; d <= toDate; d = nextDay(d), first = false) {
      runs.push(await this.reconcile(schoolId, d, { trigger: 'statement', userId, sweep: first }));
    }
    const matched = await this.prisma.gatewayStatementLine.count({ where: { statementId: statement.id, onlinePaymentId: { not: null } } });
    await this.prisma.gatewayStatement.update({ where: { id: statement.id }, data: { matched } });
    return {
      statementId: statement.id,
      fromDate: parsed.fromDate,
      toDate,
      rows: rows.length,
      matched,
      skipped: parsed.skipped,
      errors: parsed.errors.slice(0, 20),
      errorCount: parsed.errors.length,
      openIssues: runs.reduce((s, r) => s + r.openIssues, 0),
    };
  }

  // ----- Fee office views -----

  async overview(schoolId: string, days = 30) {
    const since = dayStart(daysBefore(localToday(), days));
    const [runs, open, statements] = await Promise.all([
      this.prisma.paymentReconciliation.findMany({ where: { schoolId, date: { gte: since } }, orderBy: { date: 'desc' } }),
      this.prisma.reconciliationIssue.groupBy({
        by: ['kind'],
        where: { schoolId, status: ReconciliationIssueStatus.OPEN },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.gatewayStatement.findMany({ where: { schoolId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return {
      mode: this.online.config.mode,
      openIssues: open.reduce((s, g) => s + g._count._all, 0),
      openByKind: Object.fromEntries(open.map((g) => [g.kind, { count: g._count._all, amount: g._sum.amount ?? 0 }])),
      days: runs.map((r) => ({
        date: isoDay(r.date),
        status: r.status,
        checked: r.checked,
        settled: r.settled,
        openIssues: r.openIssues,
        totals: r.totals as Totals,
        trigger: r.trigger,
        error: r.error,
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      statements: statements.map((s) => ({
        id: s.id,
        provider: s.provider as OnlineProvider,
        fileName: s.fileName,
        fromDate: isoDay(s.fromDate),
        toDate: isoDay(s.toDate),
        rows: s.rows,
        matched: s.matched,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  async issues(schoolId: string, filter: { status?: ReconciliationIssueStatus; date?: string }) {
    const rows = await this.prisma.reconciliationIssue.findMany({
      where: { schoolId, ...(filter.status ? { status: filter.status } : {}), ...(filter.date ? { date: dayStart(filter.date) } : {}) },
      orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
      take: 500,
      include: {
        onlinePayment: {
          select: {
            id: true,
            invoiceId: true,
            status: true,
            invoice: { select: { voucherNo: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } } },
          },
        },
      },
    });
    return rows.map((i) => ({
      id: i.id,
      date: isoDay(i.date),
      kind: i.kind,
      provider: i.provider as OnlineProvider,
      status: i.status,
      reference: i.reference,
      amount: i.amount,
      detail: i.detail,
      note: i.note,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      checkout: i.onlinePayment
        ? {
            id: i.onlinePayment.id,
            invoiceId: i.onlinePayment.invoiceId,
            status: i.onlinePayment.status,
            voucherNo: i.onlinePayment.invoice.voucherNo,
            student: [i.onlinePayment.invoice.student.firstName, i.onlinePayment.invoice.student.lastName].filter(Boolean).join(' '),
            admissionNo: i.onlinePayment.invoice.student.admissionNo,
          }
        : null,
    }));
  }

  /** The fee office closing an issue after checking it, with what they found. */
  async resolve(schoolId: string, id: string, userId: string, note: string) {
    const issue = await this.prisma.reconciliationIssue.findFirst({ where: { id, schoolId } });
    if (!issue) throw new NotFoundException('Issue not found');
    const updated = await this.prisma.reconciliationIssue.update({
      where: { id },
      data: { status: ReconciliationIssueStatus.RESOLVED, note, resolvedAt: new Date(), resolvedById: userId },
    });
    const open = await this.prisma.reconciliationIssue.count({ where: { schoolId, date: issue.date, status: ReconciliationIssueStatus.OPEN } });
    await this.prisma.paymentReconciliation.updateMany({
      where: { schoolId, date: issue.date, status: { in: [ReconciliationStatus.CLEAN, ReconciliationStatus.ISSUES] } },
      data: { openIssues: open, status: open ? ReconciliationStatus.ISSUES : ReconciliationStatus.CLEAN },
    });
    return updated;
  }
}

