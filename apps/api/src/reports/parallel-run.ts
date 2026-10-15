import type { InvoiceLineKind, InvoiceStatus } from '@prisma/client';

/**
 * Sums for the pilot's parallel-run reports (SCHOOL-150): the same month kept
 * in SchoolSyncer and in the school's old registers, ticked off line by line.
 * Pure functions so the totals can be checked to the rupee in unit tests.
 */

/** One decimal place, 0 when nothing was counted. */
export const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export interface VoucherLine {
  feeHeadId: string | null;
  feeHeadName: string | null;
  description: string;
  amount: number;
  kind: InvoiceLineKind;
}

export interface Bucket {
  key: string;
  name: string;
  amount: number;
}

export const ARREARS = { key: 'arrears', name: 'Arrears' };
export const LATE_FINE = { key: 'late-fine', name: 'Late fine' };
export const ADJUSTMENTS = { key: 'adjustments', name: 'Adjustments' };
/** Money beyond what the voucher's heads add up to (an overpayment). */
export const UNMATCHED = { key: 'unmatched', name: 'Not matched to a fee head' };

/**
 * What a voucher bills per head, in the order a payment settles them: arrears
 * first, then each fee head in the order it is printed on the voucher (its
 * concessions and sibling discounts net off it), then other charges, then the
 * late fine. A discount with no fee head comes off the last heads, so the
 * buckets add up to what the voucher bills.
 */
export function voucherBuckets(lines: VoucherLine[]): Bucket[] {
  const order: Bucket[] = [];
  const byKey = new Map<string, Bucket>();
  let looseDiscount = 0;
  const add = (key: string, name: string, amount: number) => {
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, name, amount: 0 };
      byKey.set(key, bucket);
      order.push(bucket);
    }
    bucket.amount += amount;
  };
  for (const line of lines) {
    if (line.kind === 'ARREARS') add(ARREARS.key, ARREARS.name, line.amount);
    else if (line.kind === 'LATE_FINE') add(LATE_FINE.key, LATE_FINE.name, line.amount);
    else if (line.feeHeadId) add(`head:${line.feeHeadId}`, line.feeHeadName ?? line.description, line.amount);
    else if (line.amount < 0) looseDiscount -= line.amount;
    else add(line.kind === 'ADJUSTMENT' ? ADJUSTMENTS.key : `line:${line.description}`, line.kind === 'ADJUSTMENT' ? ADJUSTMENTS.name : line.description, line.amount);
  }
  const rank = (b: Bucket) => (b.key === ARREARS.key ? 0 : b.key === LATE_FINE.key ? 3 : b.key.startsWith('head:') ? 1 : 2);
  const sorted = order.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
  // A waived fine or an over-discounted head nets below zero: it bills nothing.
  for (const b of sorted) {
    if (b.amount < 0) {
      looseDiscount -= b.amount;
      b.amount = 0;
    }
  }
  for (let i = sorted.length - 1; i >= 0 && looseDiscount > 0; i--) {
    const off = Math.min(sorted[i].amount, looseDiscount);
    sorted[i].amount -= off;
    looseDiscount -= off;
  }
  return sorted.filter((b) => b.amount > 0);
}

/** How much of `paid` each bucket has received, filling them in order. */
export function fill(buckets: Bucket[], paid: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = Math.max(0, paid);
  for (const b of buckets) {
    const take = Math.min(b.amount, left);
    if (take > 0) out.set(b.key, take);
    left -= take;
  }
  if (left > 0) out.set(UNMATCHED.key, left);
  return out;
}

export interface CountedPayment {
  id: string;
  amount: number;
}

/**
 * Splits each payment on a voucher across its heads. `payments` are the
 * voucher's counted (not reversed) payments in the order they were received;
 * each one takes up where the ones before it left off, so the splits never go
 * negative and a fully paid voucher shows exactly what it billed per head.
 */
export function splitPayments(buckets: Bucket[], payments: CountedPayment[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  let before = 0;
  let filledBefore = fill(buckets, 0);
  for (const p of payments) {
    const after = before + p.amount;
    const filledAfter = fill(buckets, after);
    const split = new Map<string, number>();
    for (const [key, amount] of filledAfter) {
      const share = amount - (filledBefore.get(key) ?? 0);
      if (share > 0) split.set(key, share);
    }
    out.set(p.id, split);
    before = after;
    filledBefore = filledAfter;
  }
  return out;
}

export interface FeeRow {
  /** Local YYYY-MM-DD the payment was received. */
  date: string;
  method: string;
  amount: number;
  /** Head key -> rupees, adding up to `amount`. */
  heads: Map<string, number>;
}

export interface FeeTotals {
  total: number;
  receipts: number;
  methods: string[];
  byDay: { date: string; total: number; receipts: number; byMethod: Record<string, number> }[];
  byMethod: { name: string; total: number; receipts: number }[];
  byHead: { key: string; name: string; total: number }[];
}

/** Fees collected per day (split by method), per method and per fee head. */
export function feeTotals(rows: FeeRow[], headNames: Map<string, string>): FeeTotals {
  const days = new Map<string, FeeTotals['byDay'][number]>();
  const methods = new Map<string, { name: string; total: number; receipts: number }>();
  const heads = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    total += r.amount;
    const d = days.get(r.date) ?? { date: r.date, total: 0, receipts: 0, byMethod: {} };
    d.total += r.amount;
    d.receipts += 1;
    d.byMethod[r.method] = (d.byMethod[r.method] ?? 0) + r.amount;
    days.set(r.date, d);
    const m = methods.get(r.method) ?? { name: r.method, total: 0, receipts: 0 };
    m.total += r.amount;
    m.receipts += 1;
    methods.set(r.method, m);
    for (const [key, amount] of r.heads) heads.set(key, (heads.get(key) ?? 0) + amount);
  }
  const byMethod = [...methods.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return {
    total,
    receipts: rows.length,
    methods: byMethod.map((m) => m.name),
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byMethod,
    byHead: [...heads.entries()]
      .map(([key, amount]) => ({ key, name: headNames.get(key) ?? key, total: amount }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

export interface VoucherRow {
  status: InvoiceStatus;
  total: number;
  paid: number;
  className: string;
  period: string;
}

export interface VoucherTally {
  name: string;
  issued: number;
  billed: number;
  paid: number;
  partial: number;
  unpaid: number;
  carried: number;
  collected: number;
  outstanding: number;
}

const emptyTally = (name: string): VoucherTally => ({
  name,
  issued: 0,
  billed: 0,
  paid: 0,
  partial: 0,
  unpaid: 0,
  carried: 0,
  collected: 0,
  outstanding: 0,
});

/**
 * Vouchers issued against vouchers paid: in total, by class and by billing
 * month. Voided vouchers are only counted as voided. A voucher carried
 * forward owes nothing itself (its balance is on a later voucher).
 */
export function voucherTotals(rows: VoucherRow[]) {
  const totals = emptyTally('All vouchers');
  const byClass = new Map<string, VoucherTally>();
  const byPeriod = new Map<string, VoucherTally>();
  let voided = 0;
  for (const v of rows) {
    if (v.status === 'CANCELLED') {
      voided += 1;
      continue;
    }
    for (const t of [
      totals,
      byClass.get(v.className) ?? byClass.set(v.className, emptyTally(v.className)).get(v.className)!,
      byPeriod.get(v.period) ?? byPeriod.set(v.period, emptyTally(v.period)).get(v.period)!,
    ]) {
      t.issued += 1;
      t.billed += v.total;
      t.collected += v.paid;
      if (v.status === 'PAID') t.paid += 1;
      else if (v.status === 'PARTIAL') t.partial += 1;
      else if (v.status === 'CARRIED_FORWARD') t.carried += 1;
      else t.unpaid += 1;
      if (v.status !== 'CARRIED_FORWARD') t.outstanding += Math.max(0, v.total - v.paid);
    }
  }
  return {
    totals,
    voided,
    byClass: [...byClass.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    byPeriod: [...byPeriod.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface SessionRow {
  sectionId: string;
  name: string;
  sort: number;
  /** YYYY-MM-DD */
  date: string;
  present: number;
  marked: number;
}

export interface Cell {
  present: number;
  marked: number;
  percent: number;
}

/**
 * Attendance marked per section per day, with the share present (present or
 * late) for each cell, each section, each day and overall.
 */
export function attendanceGrid(rows: SessionRow[]) {
  const sections = new Map<
    string,
    { sectionId: string; name: string; sort: number; cells: Record<string, Cell>; days: number; present: number; marked: number }
  >();
  const days = new Map<string, { date: string; sections: number; present: number; marked: number }>();
  let present = 0;
  let marked = 0;
  for (const r of rows) {
    const s = sections.get(r.sectionId) ?? { sectionId: r.sectionId, name: r.name, sort: r.sort, cells: {}, days: 0, present: 0, marked: 0 };
    s.cells[r.date] = { present: r.present, marked: r.marked, percent: percent(r.present, r.marked) };
    s.days += 1;
    s.present += r.present;
    s.marked += r.marked;
    sections.set(r.sectionId, s);
    const d = days.get(r.date) ?? { date: r.date, sections: 0, present: 0, marked: 0 };
    d.sections += 1;
    d.present += r.present;
    d.marked += r.marked;
    days.set(r.date, d);
    present += r.present;
    marked += r.marked;
  }
  return {
    dates: [...days.keys()].sort(),
    sections: [...sections.values()]
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(({ sort: _sort, ...s }) => ({ ...s, percent: percent(s.present, s.marked) })),
    byDate: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, percent: percent(d.present, d.marked) })),
    present,
    marked,
    percent: percent(present, marked),
  };
}
